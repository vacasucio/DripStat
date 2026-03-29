/**
 * build_database.js
 * Builds drugs_database.json by querying DailyMed + OpenFDA for each drug.
 * Saves progress after every batch. Safe to re-run — skips already-completed drugs.
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const RAW_LIST    = require("./drug_list.js");
const DRUGS       = [...new Set(RAW_LIST)];          // deduplicate
const DB_PATH     = path.join(__dirname, "drugs_database.json");
const BATCH_SIZE  = 10;
const DELAY_MS    = 400;                             // polite delay between requests

// ── Helpers ──────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "QuickDrip-DBBuilder/1.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadDB() {
  if (fs.existsSync(DB_PATH)) {
    try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch {}
  }
  return {};
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── DailyMed ─────────────────────────────────────────────────────────────────

async function fetchDailyMed(drug) {
  const routes = ["intravenous", "injection"];
  for (const route of routes) {
    const searchUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(drug)}&route=${encodeURIComponent(route)}&pagesize=1`;
    try {
      const { statusCode, body } = await httpsGet(searchUrl);
      if (statusCode !== 200) continue;
      const data = JSON.parse(body);
      const setid = data?.data?.[0]?.setid;
      if (!setid) continue;

      await sleep(DELAY_MS);
      const splUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setid}.json`;
      const { statusCode: s2, body: splBody } = await httpsGet(splUrl);
      if (s2 !== 200) continue;

      const splData = JSON.parse(splBody);
      const sections = splData?.data?.sections || [];
      const piUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`;
      return { sections, setid, piUrl, route };
    } catch { continue; }
  }
  return null;
}

function extractSection(sections, ...keywords) {
  const matches = sections.filter(s => {
    const t = (s.title || "").toLowerCase();
    return keywords.some(k => t.includes(k));
  });
  return matches.map(s => s.text || "").join("\n").trim() || null;
}

// ── OpenFDA ───────────────────────────────────────────────────────────────────

async function fetchOpenFDA(drug) {
  const routes = [
    `openfda.generic_name:%22${encodeURIComponent(drug)}%22+AND+openfda.route:%22intravenous%22`,
    `openfda.generic_name:%22${encodeURIComponent(drug)}%22+AND+openfda.route:%22injection%22`,
    `openfda.generic_name:%22${encodeURIComponent(drug)}%22`,
    `openfda.substance_name:%22${encodeURIComponent(drug)}%22`,
  ];
  for (const q of routes) {
    try {
      const url = `https://api.fda.gov/drug/label.json?search=${q}&limit=1`;
      const { statusCode, body } = await httpsGet(url);
      if (statusCode !== 200) continue;
      const data = JSON.parse(body);
      if ((data?.meta?.results?.total ?? 0) > 0) return data.results[0];
    } catch { continue; }
    await sleep(DELAY_MS);
  }
  return null;
}

// ── Parse structured fields ───────────────────────────────────────────────────

function parseRecord(drug, dailymed, fda) {
  const sections  = dailymed?.sections || [];
  const fdaLabel  = fda || {};

  // Brand names
  const brandNames = fdaLabel?.openfda?.brand_name || [];

  // Drug class
  const drugClass = (fdaLabel?.openfda?.pharm_class_epc || [])[0] || null;

  // Reconstitution — from DailyMed dosage section or FDA recon section
  const reconRaw = extractSection(sections, "reconstitut", "preparation")
    || (Array.isArray(fdaLabel.dosage_and_administration)
        ? fdaLabel.dosage_and_administration.join("\n")
        : fdaLabel.dosage_and_administration || null);
  const reconstitution = reconRaw ? reconRaw.slice(0, 800) : null;

  // Dosage & administration text
  const adminRaw = extractSection(sections, "dosage and administration")
    || reconRaw;
  const administration = adminRaw ? adminRaw.slice(0, 1200) : null;

  // Compatible diluents — look for keywords in D&A or description
  const diluentRaw = extractSection(sections, "dilut", "diluent", "compatible", "dosage and administration")
    || administration || "";
  const diluentMatch = diluentRaw.match(/(NS|0\.9%|D5W|dextrose|lactated|sterile water|D5NS|saline|LR)[^.;]*/gi) || [];
  const compatibleDiluents = [...new Set(diluentMatch.map(s => s.trim()))].slice(0, 8);

  // Infusion time
  const adminText = administration || "";
  const timeMatch = adminText.match(/(?:infus(?:e|ed|ion)|administer(?:ed)?|over)\s+(?:a period of\s+)?(\d+(?:\.\d+)?(?:\s*(?:to|-)\s*\d+(?:\.\d+)?)?)\s*(hour|hr|minute|min)/i);
  const infusionTime = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : null;

  // Rate
  const rateMatch = adminText.match(/(\d+(?:\.\d+)?(?:\s*(?:to|-)\s*\d+(?:\.\d+)?)?)\s*mL\/h(?:our|r)?/i);
  const rate = rateMatch ? `${rateMatch[1]} mL/hr` : null;

  // Filter
  const filterMatch = adminText.match(/(0\.2[02]?\s*micron|in-line filter|filter[^.]{0,60})/i);
  const filterRequired = filterMatch ? filterMatch[0].trim() : "Not required per PI";

  // Stability
  const stabilityRaw = extractSection(sections, "stability", "storage", "how supplied");
  const stability = stabilityRaw ? stabilityRaw.slice(0, 400) : null;

  // Black box warnings
  const bbwRaw = fdaLabel.boxed_warning
    || (Array.isArray(fdaLabel.warnings) ? fdaLabel.warnings.join("\n") : fdaLabel.warnings)
    || extractSection(sections, "boxed warning", "black box");
  const blackBoxWarnings = bbwRaw ? [bbwRaw.slice(0, 600)] : [];

  // Clinical alerts
  const alertsRaw = fdaLabel.warnings_and_cautions
    || (Array.isArray(fdaLabel.warnings_and_precautions) ? fdaLabel.warnings_and_precautions.join("\n") : null)
    || extractSection(sections, "warning", "precaution");
  const clinicalAlerts = alertsRaw ? [alertsRaw.slice(0, 600)] : [];

  // PI source URL
  const piUrl = dailymed?.piUrl
    || (fdaLabel?.openfda?.spl_set_id?.[0]
        ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${fdaLabel.openfda.spl_set_id[0]}`
        : "https://dailymed.nlm.nih.gov/dailymed/");

  return {
    drugName:         drug,
    brandNames:       brandNames.slice(0, 4),
    drugClass,
    reconstitution,
    compatibleDiluents,
    administration,
    infusionTime,
    rate,
    filterRequired,
    stability,
    blackBoxWarnings,
    clinicalAlerts,
    piUrl,
    sources: {
      dailymed: !!dailymed,
      openFDA:  !!fda,
      route:    dailymed?.route || null,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processDrug(drug) {
  const [dailymed, fda] = await Promise.allSettled([
    fetchDailyMed(drug),
    fetchOpenFDA(drug),
  ]);
  const dmResult  = dailymed.status  === "fulfilled" ? dailymed.value  : null;
  const fdaResult = fda.status       === "fulfilled" ? fda.value       : null;
  if (!dmResult && !fdaResult) return null;
  return parseRecord(drug, dmResult, fdaResult);
}

async function main() {
  const db       = loadDB();
  const todo     = DRUGS.filter(d => !db[d]);
  const total    = DRUGS.length;
  const done0    = total - todo.length;
  const failed   = [];

  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  IV Drug Database Builder                ║`);
  console.log(`  ╚══════════════════════════════════════════╝`);
  console.log(`  Total drugs: ${total} | Already done: ${done0} | Remaining: ${todo.length}\n`);

  if (!todo.length) {
    console.log("  ✓ All drugs already processed. Database is up to date.");
    printSummary(db, []);
    return;
  }

  let processed = done0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    console.log(`\n  ── Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(todo.length / BATCH_SIZE)} ─────────────────────`);

    for (const drug of batch) {
      processed++;
      process.stdout.write(`  [${processed}/${total}] ${drug} ... `);
      try {
        const record = await processDrug(drug);
        if (record) {
          db[drug] = record;
          const srcFlags = [
            record.sources.dailymed ? "DailyMed" : "",
            record.sources.openFDA  ? "OpenFDA"  : "",
          ].filter(Boolean).join("+");
          console.log(`✓ (${srcFlags}, route: ${record.sources.route || "n/a"})`);
        } else {
          db[drug] = { drugName: drug, error: "No data found", sources: { dailymed: false, openFDA: false } };
          failed.push(drug);
          console.log("✗ No data found");
        }
      } catch (e) {
        db[drug] = { drugName: drug, error: e.message, sources: { dailymed: false, openFDA: false } };
        failed.push(drug);
        console.log(`✗ Error: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }

    saveDB(db);
    console.log(`  ── Batch saved to drugs_database.json (${Object.keys(db).length} total records)`);
  }

  printSummary(db, failed);
}

function printSummary(db, failed) {
  const all     = Object.values(db);
  const success = all.filter(r => !r.error).length;
  const errors  = all.filter(r =>  r.error).length;

  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  Build Complete — Summary                ║`);
  console.log(`  ╚══════════════════════════════════════════╝`);
  console.log(`  Total records : ${all.length}`);
  console.log(`  Succeeded     : ${success}`);
  console.log(`  Failed        : ${errors}`);

  if (errors > 0) {
    console.log(`\n  Failed drugs:`);
    all.filter(r => r.error).forEach(r => console.log(`    - ${r.drugName}  (${r.error})`));
  }

  console.log(`\n  Database saved to: drugs_database.json\n`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
