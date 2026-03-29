/**
 * fetch_fda_pdfs.js
 * Downloads FDA label PDFs from accessdata.fda.gov for all drugs in drug_list.js.
 * Reads set_id from existing labels/ JSON files; falls back to a live OpenFDA query.
 * Saves PDFs to labels_pdf/. Safe to re-run — skips already-downloaded files.
 *
 * Usage: node fetch_fda_pdfs.js
 */

const https  = require("https");
const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const urlMod = require("url");

const RAW_LIST   = require("./drug_list.js");
const DRUGS      = [...new Set(RAW_LIST)];
const LABELS_DIR = path.join(__dirname, "labels");
const PDF_DIR    = path.join(__dirname, "labels_pdf");
const DELAY_MS   = 500;   // ms between requests — be polite to FDA servers
const BATCH_SIZE = 10;

if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function drugFileName(drug) {
  return drug.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function labelPath(drug) {
  return path.join(LABELS_DIR, drugFileName(drug) + ".json");
}

function pdfPath(drug) {
  return path.join(PDF_DIR, drugFileName(drug) + ".pdf");
}

/**
 * HTTP/HTTPS GET with redirect following (up to 5 hops) and optional binary mode.
 */
function fetchUrl(rawUrl, binary = false, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error("too many redirects"));
    let parsed;
    try { parsed = new urlMod.URL(rawUrl); }
    catch (e) { return reject(new Error(`bad URL: ${rawUrl}`)); }

    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.get(rawUrl, {
      headers: {
        "User-Agent": "DripStat-PDFFetch/1.0 (clinical pharmacology research)",
        "Accept": binary ? "application/pdf,*/*" : "application/json",
      }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new urlMod.URL(res.headers.location, rawUrl).href;
        res.resume();
        fetchUrl(next, binary, hops + 1).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8"),
        contentType: res.headers["content-type"] || "",
      }));
    });
    req.on("error", reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ── set_id resolution ─────────────────────────────────────────────────────────

/**
 * Returns the FDA set_id (UUID) for a drug.
 * Reads from labels/<drug>.json first; queries OpenFDA API as fallback.
 */
async function getSetId(drug) {
  // 1. Try existing label JSON (already downloaded by fetch_labels.js)
  const lp = labelPath(drug);
  if (fs.existsSync(lp)) {
    try {
      const { label } = JSON.parse(fs.readFileSync(lp, "utf8"));
      // set_id is a UUID at the top level of the label object
      const setId = label?.set_id;
      if (setId && /^[0-9a-f-]{30,}$/i.test(setId)) return setId;
    } catch { /* fall through */ }
  }

  // 2. Fetch fresh from OpenFDA
  const enc = encodeURIComponent(`"${drug}"`);
  const queries = [
    `openfda.generic_name:${enc}+AND+openfda.route:%22intravenous%22`,
    `openfda.generic_name:${enc}+AND+openfda.route:%22injection%22`,
    `openfda.generic_name:${enc}`,
    `openfda.substance_name:${enc}`,
  ];
  for (const q of queries) {
    try {
      const apiUrl = `https://api.fda.gov/drug/label.json?search=${q}&limit=1`;
      const { statusCode, body } = await fetchUrl(apiUrl);
      if (statusCode !== 200) continue;
      const data = JSON.parse(body);
      if ((data?.meta?.results?.total ?? 0) > 0) {
        const setId = data.results[0]?.set_id;
        if (setId) return setId;
      }
    } catch { /* try next query */ }
    await sleep(150);
  }
  return null;
}

// ── PDF download ──────────────────────────────────────────────────────────────

/**
 * Downloads the label PDF for a given set_id.
 * Tries accessdata.fda.gov first (official source), falls back to DailyMed.
 * Validates that the response is actually a PDF (magic bytes %PDF-).
 * Returns a Buffer on success, null on failure.
 */
async function downloadPdf(setId) {
  const candidates = [
    `https://www.accessdata.fda.gov/spl/data/${setId}/${setId}.pdf`,
    `https://dailymed.nlm.nih.gov/dailymed/downloadpdffile.cfm?setId=${setId}`,
  ];

  for (const candidate of candidates) {
    try {
      const { statusCode, body } = await fetchUrl(candidate, /* binary= */ true);
      if (statusCode !== 200) { await sleep(300); continue; }
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      // Confirm it's really a PDF (not an HTML error page)
      if (buf.length > 2048 && buf.slice(0, 5).toString("ascii") === "%PDF-") {
        return buf;
      }
    } catch { /* try fallback */ }
    await sleep(300);
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const todo    = DRUGS.filter(d => !fs.existsSync(pdfPath(d)));
  const already = DRUGS.length - todo.length;

  console.log(`\n  FDA Label PDF Downloader`);
  console.log(`  Total drugs         : ${DRUGS.length}`);
  console.log(`  Already downloaded  : ${already}`);
  console.log(`  Remaining           : ${todo.length}`);
  console.log(`  Output              : labels_pdf/\n`);

  if (!todo.length) {
    console.log("  All PDFs already downloaded.\n");
    return;
  }

  // Load or initialise manifest (drug → { setId, size, downloaded })
  const manifestPath = path.join(PDF_DIR, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};

  let succeeded = 0, noSetId = 0, noPdf = 0;

  for (let i = 0; i < todo.length; i++) {
    const drug = todo[i];
    process.stdout.write(`  [${i + already + 1}/${DRUGS.length}] ${drug} ... `);

    try {
      const setId = await getSetId(drug);
      if (!setId) {
        noSetId++;
        console.log("✗  no set_id found");
        await sleep(DELAY_MS);
        continue;
      }

      const buf = await downloadPdf(setId);
      if (!buf) {
        noPdf++;
        console.log(`✗  PDF unavailable  (set_id: ${setId})`);
        await sleep(DELAY_MS);
        continue;
      }

      fs.writeFileSync(pdfPath(drug), buf);
      manifest[drug] = { setId, sizeKb: Math.round(buf.length / 1024), downloaded: new Date().toISOString() };
      succeeded++;
      console.log(`✓  ${Math.round(buf.length / 1024)} KB  (set_id: ${setId})`);
    } catch (e) {
      noPdf++;
      console.log(`✗  ${e.message}`);
    }

    await sleep(DELAY_MS);

    if ((i + 1) % BATCH_SIZE === 0) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const done = i + 1;
      console.log(`\n  ── batch ${Math.floor(done / BATCH_SIZE)}: ${succeeded} ok, ${noSetId} no set_id, ${noPdf} no pdf (${todo.length - done} remaining)\n`);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const totalInDir = fs.readdirSync(PDF_DIR).filter(f => f.endsWith(".pdf")).length;

  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  PDF Download Complete                   ║`);
  console.log(`  ╚══════════════════════════════════════════╝`);
  console.log(`  Downloaded this run  : ${succeeded}`);
  console.log(`  Total PDFs on disk   : ${totalInDir}`);
  console.log(`  No set_id            : ${noSetId}`);
  console.log(`  PDF unavailable      : ${noPdf}`);
  console.log(`  Manifest             : labels_pdf/manifest.json\n`);
  console.log(`  Next step: node embed_pdf_labels.js\n`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
