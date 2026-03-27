/**
 * build_quickdrip_cache.js
 * Batch-processes all 443 FDA label JSON files through Claude Sonnet to produce
 * quickdrip_cache.json — pre-computed structured drug data for instant serving.
 *
 * Usage:  node build_quickdrip_cache.js
 *         node build_quickdrip_cache.js --force vancomycin   (rebuild specific drug)
 *
 * Safe to re-run — skips drugs already cached with dataComplete: true.
 * Checkpoints after every batch. Ctrl-C safe.
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const { LOOKUP_PROMPT } = require("./prompts");

const LABELS_DIR  = path.join(__dirname, "labels");
const CACHE_PATH  = path.join(__dirname, "quickdrip_cache.json");
const FAIL_LOG    = path.join(__dirname, "cache_failures.log");
const BATCH_SIZE  = 5;
const DELAY_MS    = 400;   // between requests (stay under rate limits)
const MAX_TOKENS  = 2500;
const MODEL       = "claude-haiku-4-5-20251001";  // Haiku: 12x cheaper than Sonnet, sufficient for structured extraction

// Load .env
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const [key, ...rest] = line.trim().split("=");
    if (key && rest.length) process.env[key] = rest.join("=").trim();
  });
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("ERROR: ANTHROPIC_API_KEY not found in .env"); process.exit(1); }

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadCache() {
  if (fs.existsSync(CACHE_PATH)) {
    try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")); } catch {}
  }
  return {};
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function logFailure(drug, error) {
  const entry = `${new Date().toISOString()} | ${drug} | ${error}\n`;
  fs.appendFileSync(FAIL_LOG, entry);
}

// ── PI Text Assembly ─────────────────────────────────────────────────────────
// Reads a label JSON and assembles the PI text the same way server.js does

const PI_SECTIONS = [
  ["description",               "DESCRIPTION"],
  ["clinical_pharmacology",     "CLINICAL PHARMACOLOGY"],
  ["dosage_and_administration", "DOSAGE AND ADMINISTRATION"],
  ["warnings_and_precautions",  "WARNINGS AND PRECAUTIONS"],
  ["warnings",                  "WARNINGS"],
  ["boxed_warning",             "BOXED WARNING"],
  ["contraindications",         "CONTRAINDICATIONS"],
  ["adverse_reactions",         "ADVERSE REACTIONS"],
  ["precautions",               "PRECAUTIONS"],
  ["drug_interactions",         "DRUG INTERACTIONS"],
  ["how_supplied",              "HOW SUPPLIED"],
];

function assemblePIText(label) {
  const parts = [];
  for (const [key, title] of PI_SECTIONS) {
    const val = label[key];
    if (val) {
      const text = Array.isArray(val) ? val.join("\n") : val;
      if (text.trim()) parts.push(`[${title}]\n${text.trim()}`);
    }
  }
  return parts.join("\n\n");
}

function getSetId(label) {
  return label.set_id || label.id || null;
}

function dailymedUrl(setId, drugName) {
  if (setId && setId !== "unknown") {
    return `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`;
  }
  return `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(drugName)}`;
}

// ── ASHP PubMed Query ────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "QuickDrip-CacheBuilder/1.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function queryASHP(drug) {
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(drug)}+AND+%22Am+J+Health+Syst+Pharm%22%5Bjour%5D+AND+(intravenous+OR+monitoring+OR+%22IV+push%22+OR+administration)&retmax=3&sort=relevance&retmode=json`;
    const { statusCode, body } = await httpsGet(searchUrl);
    if (statusCode !== 200) return null;
    const ids = JSON.parse(body)?.esearchresult?.idlist || [];
    if (!ids.length) return null;
    await sleep(350); // PubMed rate limit
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`;
    const { statusCode: sc2, body: abstracts } = await httpsGet(fetchUrl);
    if (sc2 !== 200 || !abstracts.trim()) return null;
    return abstracts.slice(0, 2500);
  } catch { return null; }
}

// ── Claude API Call ──────────────────────────────────────────────────────────

function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const apiReq = https.request(options, apiRes => {
      let data = "";
      apiRes.on("data", chunk => data += chunk);
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const raw = parsed.content.filter(b => b.type === "text").map(b => b.text).join("");
          const stopReason = parsed.stop_reason || "unknown";
          const tokens = parsed.usage || {};
          if (stopReason === "max_tokens") console.warn(`    ⚠ TRUNCATED (${tokens.output_tokens}/${MAX_TOKENS})`);
          resolve(raw);
        } catch (e) { reject(e); }
      });
    });
    apiReq.on("error", reject);
    apiReq.setTimeout(120000, () => { apiReq.destroy(); reject(new Error("API timeout")); });
    apiReq.write(payload);
    apiReq.end();
  });
}

// ── Process Single Drug ──────────────────────────────────────────────────────

async function processDrug(drugName, labelPath) {
  // Read label file
  let labelData;
  try {
    labelData = JSON.parse(fs.readFileSync(labelPath, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read label: ${e.message}`);
  }

  const label = labelData.label || labelData;
  const piText = assemblePIText(label);

  if (!piText || piText.length < 100) {
    throw new Error("PI text too short or empty");
  }

  const setId = getSetId(label);
  const citationUrl = dailymedUrl(setId, drugName);

  // Query ASHP in parallel with nothing (just await it)
  const ashpData = await queryASHP(drugName);

  // Build user message (same structure as server.js)
  const userMsg = [
    `IV reference data for: ${drugName}`,
    `\nCITATION URL (use this exact URL in the citation.url field): ${citationUrl}`,
    `\n\nFDA PACKAGE INSERT TEXT:\n---\n${piText.slice(0, 14000)}\n---`,
    ashpData ? `\n\nASHP GUIDELINES (Am J Health Syst Pharm):\n---\n${ashpData}\n---` : "",
  ].join("");

  // Call Claude
  const raw = await callClaude(LOOKUP_PROMPT, userMsg);

  // Parse JSON from response
  let parsed = null;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }

  if (!parsed) throw new Error("Could not parse Claude response as JSON");
  if (parsed.sourceUsed === "Not sourced") throw new Error("Claude returned 'Not sourced'");

  return parsed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const forceIdx = args.indexOf("--force");
  const forceDrug = forceIdx !== -1 ? args[forceIdx + 1]?.toLowerCase() : null;

  // Discover all label files
  const labelFiles = fs.readdirSync(LABELS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => ({
      file: f,
      drug: f.replace(".json", "").replace(/_/g, " "),
      path: path.join(LABELS_DIR, f)
    }));

  console.log(`\n  QuickDrip Cache Builder`);
  console.log(`  ──────────────────────`);
  console.log(`  Label files found: ${labelFiles.length}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Max tokens: ${MAX_TOKENS}`);

  const cache = loadCache();
  console.log(`  Existing cache entries: ${Object.keys(cache).length}`);

  // Filter to drugs that need processing
  let toProcess;
  if (forceDrug) {
    toProcess = labelFiles.filter(l => l.drug === forceDrug);
    if (!toProcess.length) {
      console.error(`  Drug "${forceDrug}" not found in labels/`);
      process.exit(1);
    }
    console.log(`  Force rebuilding: ${forceDrug}`);
  } else {
    toProcess = labelFiles.filter(l => {
      const existing = cache[l.drug];
      return !existing || !existing.dataComplete;
    });
    console.log(`  Drugs to process: ${toProcess.length}`);
  }

  if (!toProcess.length) {
    console.log("\n  All drugs already cached. Use --force <drug> to rebuild.\n");
    return;
  }

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    for (const entry of batch) {
      const t0 = Date.now();
      process.stdout.write(`  [${processed + failed + 1}/${toProcess.length}] ${entry.drug.padEnd(35)}`);

      try {
        const result = await processDrug(entry.drug, entry.path);
        cache[entry.drug] = result;
        processed++;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`✓ (${elapsed}s)`);
      } catch (e) {
        failed++;
        console.log(`✗ ${e.message}`);
        logFailure(entry.drug, e.message);
        cache[entry.drug] = { error: e.message, dataComplete: false };
      }

      await sleep(DELAY_MS);
    }

    // Checkpoint after each batch
    saveCache(cache);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = (processed + failed) / (elapsed || 1);
    const remaining = ((toProcess.length - processed - failed) / rate).toFixed(1);
    console.log(`  ── Batch saved. ${processed} ok, ${failed} fail. ${elapsed}min elapsed, ~${remaining}min remaining ──\n`);
  }

  saveCache(cache);

  const totalEntries = Object.keys(cache).filter(k => cache[k].dataComplete).length;
  const totalErrors = Object.keys(cache).filter(k => cache[k].error).length;

  console.log(`\n  ══════════════════════════════`);
  console.log(`  Cache build complete!`);
  console.log(`  Total cached: ${totalEntries} drugs`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  File: ${CACHE_PATH}`);
  console.log(`  Size: ${(fs.statSync(CACHE_PATH).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  ══════════════════════════════\n`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
