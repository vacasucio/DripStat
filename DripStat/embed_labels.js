/**
 * embed_labels.js
 * Reads label JSON files from labels/, chunks them into PI sections using
 * section-aware splitting (whole sections as chunks, split at paragraph
 * boundaries only when a section exceeds MAX_CHUNK_SIZE characters).
 *
 * Usage: node embed_labels.js
 */

const fs       = require("fs");
const path     = require("path");
const Database = require("better-sqlite3");

const LABELS_DIR    = path.join(__dirname, "labels");
const DB_PATH       = path.join(__dirname, "pi_embeddings.db");
const MAX_CHUNK     = 1500;  // max chars per chunk — split at paragraph boundary
const BATCH_SIZE    = 20;

// Priority sections — in search order of importance
const SECTION_FIELDS = [
  "dosage_and_administration",
  "clinical_pharmacology",
  "warnings",
  "warnings_and_cautions",
  "warnings_and_precautions",
  "adverse_reactions",
  "description",
  "contraindications",
  "precautions",
  "indications_and_usage",
  "boxed_warning",
  "how_supplied",
  "storage_and_handling",
];

// ── SQLite setup ──────────────────────────────────────────────────────────────

function openDB() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pi_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      drug        TEXT NOT NULL,
      section     TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text        TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS pi_fts USING fts5(
      drug,
      section,
      text,
      content='pi_chunks',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE INDEX IF NOT EXISTS idx_drug ON pi_chunks(drug);
  `);
  return db;
}

// ── Section-aware chunking ────────────────────────────────────────────────────

/**
 * Split text at paragraph boundaries to stay within MAX_CHUNK.
 * Paragraph = double newline or sentence-ending punctuation followed by newline.
 * Never splits mid-sentence.
 */
function splitAtParagraphs(text, maxSize) {
  if (text.length <= maxSize) return [text.trim()].filter(Boolean);

  const chunks = [];
  // Split on double-newlines first, then single newlines
  const paragraphs = text.split(/\n{2,}/).flatMap(p => {
    if (p.length <= maxSize) return [p];
    // Single-newline split for long paragraphs
    return p.split(/\n/).filter(Boolean);
  });

  let current = "";
  for (const para of paragraphs) {
    const candidate = current ? current + "\n\n" + para : para;
    if (candidate.length <= maxSize) {
      current = candidate;
    } else {
      if (current.trim()) chunks.push(current.trim());
      // If a single paragraph still exceeds max, split at sentence boundaries
      if (para.length > maxSize) {
        const sentences = para.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
        let sentBuf = "";
        for (const sent of sentences) {
          const sc = sentBuf ? sentBuf + " " + sent : sent;
          if (sc.length <= maxSize) {
            sentBuf = sc;
          } else {
            if (sentBuf.trim()) chunks.push(sentBuf.trim());
            sentBuf = sent;
          }
        }
        if (sentBuf.trim()) current = sentBuf.trim();
        else current = "";
      } else {
        current = para;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 40);
}

/**
 * Extract section-aware chunks from a label object.
 * Each section becomes its own chunk (or multiple chunks if long).
 */
function extractChunks(drug, label) {
  const chunks = [];
  for (const field of SECTION_FIELDS) {
    const raw = label[field];
    if (!raw) continue;
    const text = (Array.isArray(raw) ? raw.join("\n") : raw).trim();
    if (!text) continue;

    const parts = splitAtParagraphs(text, MAX_CHUNK);
    parts.forEach((chunk, i) => {
      chunks.push({ drug, section: field, chunk_index: i, text: chunk });
    });
  }
  return chunks;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Fresh build — delete existing DB
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log("  Deleted existing pi_embeddings.db");
  }

  const db = openDB();

  const insertChunk = db.prepare(
    `INSERT INTO pi_chunks (drug, section, chunk_index, text) VALUES (@drug, @section, @chunk_index, @text)`
  );
  const insertFts = db.prepare(
    `INSERT INTO pi_fts (rowid, drug, section, text) VALUES (last_insert_rowid(), @drug, @section, @text)`
  );

  const labelFiles = fs.readdirSync(LABELS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort();

  console.log(`\n  PI Full-Text Index Builder (section-aware chunking)`);
  console.log(`  Max chunk size    : ${MAX_CHUNK} chars`);
  console.log(`  Total label files : ${labelFiles.length}\n`);

  let processed = 0, totalChunks = 0, failed = 0;

  const indexBatch = db.transaction((rows) => {
    for (const row of rows) {
      insertChunk.run(row);
      insertFts.run({ drug: row.drug, section: row.section, text: row.text });
    }
  });

  for (let i = 0; i < labelFiles.length; i++) {
    const filePath = path.join(LABELS_DIR, labelFiles[i]);
    let drug = labelFiles[i];
    try {
      const { drug: drugName, label } = JSON.parse(fs.readFileSync(filePath, "utf8"));
      drug = drugName;
      process.stdout.write(`  [${i+1}/${labelFiles.length}] ${drug} ... `);

      const chunks = extractChunks(drug, label);
      if (!chunks.length) { console.log("skip (no text)"); continue; }

      indexBatch(chunks);
      processed++;
      totalChunks += chunks.length;
      console.log(`✓ (${chunks.length} chunks)`);
    } catch (e) {
      failed++;
      console.log(`✗ ${e.message}`);
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      console.log(`  ── checkpoint: ${processed} indexed, ${failed} failed, ${totalChunks} chunks total\n`);
    }
  }

  console.log("\n  Optimizing FTS index...");
  db.exec("INSERT INTO pi_fts(pi_fts) VALUES('optimize')");

  const totalRows  = db.prepare("SELECT COUNT(*) as n FROM pi_chunks").get().n;
  const totalDrugs = db.prepare("SELECT COUNT(DISTINCT drug) as n FROM pi_chunks").get().n;

  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  Indexing Complete                       ║`);
  console.log(`  ╚══════════════════════════════════════════╝`);
  console.log(`  Drugs indexed  : ${totalDrugs}`);
  console.log(`  Total chunks   : ${totalRows}`);
  console.log(`  Failed         : ${failed}`);
  console.log(`  DB             : pi_embeddings.db\n`);

  db.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
