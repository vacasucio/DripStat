/**
 * fetch_labels.js
 * Downloads IV drug label text from OpenFDA for all drugs in drug_list.js.
 * Saves raw label JSON to labels/ directory, one file per drug.
 * Safe to re-run — skips already-downloaded drugs.
 *
 * Usage: node fetch_labels.js
 */

const https  = require("https");
const fs     = require("fs");
const path   = require("path");

const RAW_LIST   = require("./drug_list.js");
const DRUGS      = [...new Set(RAW_LIST)];
const LABELS_DIR = path.join(__dirname, "labels");
const DELAY_MS   = 300;
const BATCH_SIZE = 10;

if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "QuickDrip-Fetch/1.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function labelPath(drug) {
  return path.join(LABELS_DIR, drug.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".json");
}

// Try multiple OpenFDA queries in order, return first hit
async function fetchLabel(drug) {
  const enc = encodeURIComponent(`"${drug}"`);
  const queries = [
    `openfda.generic_name:${enc}+AND+openfda.route:%22intravenous%22`,
    `openfda.generic_name:${enc}+AND+openfda.route:%22injection%22`,
    `openfda.generic_name:${enc}`,
    `openfda.substance_name:${enc}`,
  ];
  for (const q of queries) {
    try {
      const url = `https://api.fda.gov/drug/label.json?search=${q}&limit=1`;
      const { statusCode, body } = await httpsGet(url);
      if (statusCode !== 200) continue;
      const data = JSON.parse(body);
      if ((data?.meta?.results?.total ?? 0) > 0) {
        return { drug, query: q, label: data.results[0] };
      }
    } catch { /* try next */ }
    await sleep(100);
  }
  return null;
}

async function main() {
  const todo = DRUGS.filter(d => !fs.existsSync(labelPath(d)));
  console.log(`\n  Fetching labels — ${todo.length} remaining of ${DRUGS.length} total\n`);

  let succeeded = 0, failed = 0;
  const failedList = [];

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    for (const drug of batch) {
      const n = DRUGS.indexOf(drug) + 1;
      process.stdout.write(`  [${n}/${DRUGS.length}] ${drug} ... `);
      try {
        const result = await fetchLabel(drug);
        if (result) {
          fs.writeFileSync(labelPath(drug), JSON.stringify(result, null, 2));
          succeeded++;
          console.log("✓");
        } else {
          failedList.push(drug);
          failed++;
          console.log("✗ not found");
        }
      } catch (e) {
        failedList.push(drug);
        failed++;
        console.log(`✗ ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log(`  [batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(todo.length/BATCH_SIZE)} done — ${succeeded} ok, ${failed} failed so far]\n`);
  }

  console.log(`\n  Done. Succeeded: ${succeeded}  Failed: ${failed}`);
  if (failedList.length) {
    console.log(`  Failed drugs:`);
    failedList.forEach(d => console.log(`    - ${d}`));
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
