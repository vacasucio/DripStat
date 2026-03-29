/**
 * embed_pdf_labels.js
 * Parses FDA label PDFs from labels_pdf/ and indexes the full extracted text
 * into pi_embeddings.db with source='FDA_PDF'.
 *
 * Automatically migrates the schema to add the 'source' column if absent.
 * Existing OpenFDA JSON rows are tagged 'OpenFDA_JSON' via the column default.
 * PDF chunks are tagged 'FDA_PDF' — the complete, unabridged PI text.
 *
 * Usage: node embed_pdf_labels.js
 * Requires: npm install pdf-parse
 */

const fs       = require("fs");
const path     = require("path");
const Database = require("better-sqlite3");
const pdfParse = require("pdf-parse");

const RAW_LIST   = require("./drug_list.js");
const DRUGS      = [...new Set(RAW_LIST)];
const PDF_DIR    = path.join(__dirname, "labels_pdf");
const DB_PATH    = path.join(__dirname, "pi_embeddings.db");
const CHUNK_SIZE = 800;
const BATCH_SIZE = 20;
const SOURCE     = "FDA_PDF";

// ── Section detection ─────────────────────────────────────────────────────────
//
// FDA labels use numbered and unnumbered all-caps section headers.
// Numbered form (modern):  "1 INDICATIONS AND USAGE"
// Unnumbered form (older): "INDICATIONS AND USAGE"
// We detect both and map to canonical section names.

const SECTION_PATTERNS = [
  [/^\s*\d*\s*(BOXED )?WARNING\s*$/i,                          "boxed_warning"],
  [/INDICATIONS AND USAGE/i,                                   "indications_and_usage"],
  [/DOSAGE AND ADMINISTRATION/i,                               "dosage_and_administration"],
  [/DOSAGE FORMS AND STRENGTHS/i,                              "how_supplied"],
  [/CONTRAINDICATIONS/i,                                       "contraindications"],
  [/WARNINGS AND PRECAUTIONS/i,                                "warnings_and_precautions"],
  [/^\s*\d*\s*WARNINGS\s*$/i,                                  "warnings_and_precautions"],
  [/^\s*\d*\s*PRECAUTIONS\s*$/i,                               "warnings_and_precautions"],
  [/ADVERSE REACTIONS/i,                                       "adverse_reactions"],
  [/DRUG INTERACTIONS/i,                                       "drug_interactions"],
  [/USE IN SPECIFIC POPULATIONS/i,                             "use_in_specific_populations"],
  [/^\s*\d*\s*DESCRIPTION\s*$/i,                               "description"],
  [/CLINICAL PHARMACOLOGY/i,                                   "clinical_pharmacology"],
  [/CLINICAL STUDIES/i,                                        "clinical_studies"],
  [/HOW SUPPLIED\b|STORAGE AND HANDLING/i,                     "how_supplied"],
  [/NONCLINICAL TOXICOLOGY/i,                                  "nonclinical_toxicology"],
  [/PATIENT COUNSELING/i,                                      "patient_counseling"],
  [/REFERENCES/i,                                              "references"],
];

// Only these sections are indexed (mirrors embed_labels.js priority + clinical extras)
const KEEP_SECTIONS = new Set([
  "boxed_warning",
  "indications_and_usage",
  "dosage_and_administration",
  "description",
  "clinical_pharmacology",
  "warnings_and_precautions",
  "contraindications",
  "adverse_reactions",
  "how_supplied",
  "drug_interactions",
]);

/**
 * Detect whether a line looks like a section header.
 * Returns the canonical section name, or null.
 */
function detectHeader(line) {
  const t = line.trim();
  // Must be 4–90 chars and contain at least 3 consecutive uppercase letters.
  // Allow digits, spaces, slashes, hyphens, parentheses alongside uppercase.
  if (t.length < 4 || t.length > 90) return null;
  if (!/[A-Z]{3,}/.test(t)) return null;
  // Strip leading section numbers (e.g. "12.3 ") for pattern matching
  const stripped = t.replace(/^\d+(\.\d+)?\s+/, "");
  for (const [rx, name] of SECTION_PATTERNS) {
    if (rx.test(stripped)) return name;
  }
  return null;
}

/**
 * Split raw PDF text into a map of sectionName → text content.
 */
function parseSections(rawText) {
  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const sections = {};
  let current = "description";
  let buffer  = [];

  function flush() {
    if (!buffer.length) return;
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length > 40) {
      sections[current] = ((sections[current] || "") + " " + joined).trim();
    }
    buffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = detectHeader(line);
    if (header) {
      flush();
      current = header;
      // Don't include the header text itself in the content
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkText(text, size = CHUNK_SIZE) {
  const chunks = [];
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).length > size && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 40);
}

// ── SQLite setup + migration ──────────────────────────────────────────────────

function openDB() {
  const db = new Database(DB_PATH);

  // Add 'source' column if this is an older database without it
  const cols = db.prepare("PRAGMA table_info(pi_chunks)").all().map(c => c.name);
  if (!cols.includes("source")) {
    console.log("  Schema migration: adding 'source' column to pi_chunks ...");
    db.exec("ALTER TABLE pi_chunks ADD COLUMN source TEXT NOT NULL DEFAULT 'OpenFDA_JSON'");
    console.log("  Done — existing rows are now tagged 'OpenFDA_JSON'.\n");
  }

  return db;
}

function pdfPath(drug) {
  return path.join(PDF_DIR, drug.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".pdf");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(PDF_DIR)) {
    console.error("\n  Error: labels_pdf/ not found. Run fetch_fda_pdfs.js first.\n");
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error("\n  Error: pi_embeddings.db not found. Run embed_labels.js first.\n");
    process.exit(1);
  }

  const db = openDB();

  const insertChunk = db.prepare(`
    INSERT INTO pi_chunks (drug, section, chunk_index, text, source)
    VALUES (@drug, @section, @chunk_index, @text, @source)
  `);
  const insertFts = db.prepare(`
    INSERT INTO pi_fts (rowid, drug, section, text)
    VALUES (last_insert_rowid(), @drug, @section, @text)
  `);

  const alreadyDone = new Set(
    db.prepare("SELECT DISTINCT drug FROM pi_chunks WHERE source = ?")
      .all(SOURCE).map(r => r.drug)
  );

  const hasPdf = DRUGS.filter(d => fs.existsSync(pdfPath(d)));
  const todo   = hasPdf.filter(d => !alreadyDone.has(d));

  console.log(`\n  FDA PDF Label Indexer`);
  console.log(`  Drugs in drug_list.js  : ${DRUGS.length}`);
  console.log(`  PDFs on disk           : ${hasPdf.length}`);
  console.log(`  Already indexed (PDF)  : ${alreadyDone.size}`);
  console.log(`  To index this run      : ${todo.length}\n`);

  if (!todo.length) {
    console.log("  Nothing to index — all available PDFs are already in the DB.\n");
    db.close();
    return;
  }

  let processed = 0, totalChunks = 0, failed = 0;

  const indexBatch = db.transaction((rows) => {
    for (const row of rows) {
      insertChunk.run(row);
      insertFts.run({ drug: row.drug, section: row.section, text: row.text });
    }
  });

  for (let i = 0; i < todo.length; i++) {
    const drug = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${drug} ... `);

    try {
      const pdfBuffer       = fs.readFileSync(pdfPath(drug));
      const { text, numpages } = await pdfParse(pdfBuffer, { max: 0 });

      const sections = parseSections(text);
      const chunks   = [];

      for (const [section, content] of Object.entries(sections)) {
        if (!KEEP_SECTIONS.has(section)) continue;
        chunkText(content).forEach((chunk, idx) => {
          chunks.push({ drug, section, chunk_index: idx, text: chunk, source: SOURCE });
        });
      }

      if (!chunks.length) {
        console.log(`skip (0 useful chunks extracted from ${numpages}p PDF)`);
        continue;
      }

      indexBatch(chunks);
      processed++;
      totalChunks += chunks.length;

      const sectionList = [...new Set(chunks.map(c => c.section))].join(", ");
      console.log(`✓  ${chunks.length} chunks / ${numpages}p  [${sectionList}]`);
    } catch (e) {
      failed++;
      console.log(`✗  ${e.message}`);
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      console.log(`\n  ── checkpoint: ${processed} indexed, ${failed} failed, ${totalChunks} chunks so far\n`);
    }
  }

  console.log("\n  Optimizing FTS index...");
  db.exec("INSERT INTO pi_fts(pi_fts) VALUES('optimize')");

  const totalRows  = db.prepare("SELECT COUNT(*) AS n FROM pi_chunks").get().n;
  const pdfRows    = db.prepare("SELECT COUNT(*) AS n FROM pi_chunks WHERE source = ?").get(SOURCE).n;
  const jsonRows   = db.prepare("SELECT COUNT(*) AS n FROM pi_chunks WHERE source = 'OpenFDA_JSON'").get().n;
  const totalDrugs = db.prepare("SELECT COUNT(DISTINCT drug) AS n FROM pi_chunks").get().n;
  const pdfDrugs   = db.prepare("SELECT COUNT(DISTINCT drug) AS n FROM pi_chunks WHERE source = ?").get(SOURCE).n;

  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  PDF Indexing Complete                       ║`);
  console.log(`  ╚══════════════════════════════════════════════╝`);
  console.log(`  Drugs with PDF chunks  : ${pdfDrugs}`);
  console.log(`  FDA_PDF chunks added   : ${pdfRows}`);
  console.log(`  OpenFDA_JSON chunks    : ${jsonRows}`);
  console.log(`  Total chunks in DB     : ${totalRows}`);
  console.log(`  Unique drugs in DB     : ${totalDrugs}`);
  console.log(`  Failed                 : ${failed}`);
  console.log(`  DB                     : pi_embeddings.db\n`);

  db.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
