/**
 * search.js
 * Full-text search against the PI chunks in SQLite FTS5.
 *
 * Usage (as module):
 *   const { searchPI, formatAsContext } = require("./search");
 *   const results = await searchPI("doxycycline", "drip", 4);
 *
 * Each result: { drug, section, text, score, source }
 *
 * CLI: node search.js doxycycline drip 4
 */

const fs       = require("fs");
const path     = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "pi_embeddings.db");

// Minimum normalized similarity thresholds (BM25 scores normalized to 0–1)
const MIN_SIMILARITY_PRIMARY  = 0.70;
const MIN_SIMILARITY_FALLBACK = 0.60;

// Priority sections per query mode (used to boost ranking)
const DRIP_PRIORITY = [
  "dosage_and_administration",
  "clinical_pharmacology",
  "reconstitution",
  "description",
];

const LOOKUP_PRIORITY = [
  "dosage_and_administration",   // highest
  "reconstitution",              // highest (section-aware chunks may tag this)
  "clinical_pharmacology",       // high
  "warnings",                    // medium
  "warnings_and_cautions",       // medium
  "warnings_and_precautions",    // medium
  "adverse_reactions",           // medium
  "description",
  "indications_and_usage",
];

// Strip dose from query for DB drug-name lookup
function extractDrugName(query) {
  return query
    .replace(/\b\d+(\.\d+)?\s*(mcg|mg|g|mEq|units?|ml|mL)(\s*\/\s*\S+)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Build an FTS5 query from the drug name and mode
function buildFtsQuery(drug, mode) {
  const priority = mode === "drip" ? DRIP_PRIORITY : LOOKUP_PRIORITY;

  // Core clinical terms always searched
  const coreTerms = [
    "infusion", "administer", "dilut", "reconstitut",
    "concentration", "rate", "dose",
  ];

  // Section-specific boost terms
  const sectionTerms = {
    drip:   ["intravenous", "IV", "infusion time", "over", "minutes", "hours"],
    lookup: ["indication", "warning", "precaution", "contraindication"],
  };

  const terms = [...coreTerms, ...(sectionTerms[mode] || [])];
  // FTS5 OR query — any of these terms scores a hit
  return terms.map(t => `"${t}"`).join(" OR ");
}

/**
 * Search the PI database for relevant chunks for a given drug and mode.
 * @param {string} query  - drug name (with or without dose)
 * @param {string} mode   - "drip" | "lookup"
 * @param {number} topK   - max results to return
 */
async function searchPI(query, mode = "drip", topK = 4, focusSections = null) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error("pi_embeddings.db not found — run embed_labels.js first");
  }

  const db = new Database(DB_PATH, { readonly: true });
  const drugName = extractDrugName(query);
  const priority = mode === "drip" ? DRIP_PRIORITY : LOOKUP_PRIORITY;

  console.log(`  [search] drug="${drugName}" mode=${mode}`);

  // Step 1: find exact drug match in the index
  let drugKey = db.prepare(
    "SELECT DISTINCT drug FROM pi_chunks WHERE LOWER(drug) = LOWER(?)"
  ).get(drugName)?.drug;

  // Step 2: fuzzy match on first word if exact fails
  if (!drugKey) {
    const firstWord = drugName.split(" ")[0];
    drugKey = db.prepare(
      "SELECT DISTINCT drug FROM pi_chunks WHERE LOWER(drug) LIKE LOWER(?) LIMIT 1"
    ).get(`%${firstWord}%`)?.drug;
  }

  if (!drugKey) {
    console.log(`  [search] "${drugName}" not found in index`);
    db.close();
    return [];
  }

  console.log(`  [search] matched drug key: "${drugKey}"`);

  // Step 3: FTS5 search scoped to this drug, ranked by bm25
  const ftsQuery = buildFtsQuery(drugName, mode);
  let rows;
  try {
    rows = db.prepare(`
      SELECT c.drug, c.section, c.text,
             bm25(pi_fts) AS score
      FROM pi_fts
      JOIN pi_chunks c ON c.id = pi_fts.rowid
      WHERE pi_fts MATCH ?
        AND c.drug = ?
      ORDER BY score
      LIMIT 40
    `).all(ftsQuery, drugKey);
  } catch (e) {
    // FTS syntax error fallback: fetch all sections for this drug
    console.warn(`  [search] FTS query failed (${e.message}), falling back to direct fetch`);
    rows = db.prepare(
      "SELECT drug, section, text, 0 AS score FROM pi_chunks WHERE drug = ? LIMIT 40"
    ).all(drugKey);
  }

  db.close();

  if (!rows.length) {
    // Final fallback: return all chunks for this drug
    const db2 = new Database(DB_PATH, { readonly: true });
    rows = db2.prepare(
      "SELECT drug, section, text, 0 AS score FROM pi_chunks WHERE drug = ?"
    ).all(drugKey);
    db2.close();
  }

  // Deduplicate: keep best chunk per section by boosted BM25 score
  const best = new Map();
  for (const row of rows) {
    const score   = typeof row.score === "number" ? -row.score : 0; // negate: higher = better
    const boost   = priority.includes(row.section) ? 2.0 : 1.0;
    const boosted = score * boost;
    const existing = best.get(row.section);
    if (!existing || boosted > existing.boosted) {
      best.set(row.section, { drug: row.drug, section: row.section, text: row.text, rawScore: row.score, score: boosted, boosted });
    }
  }

  const dedupedRows = [...best.values()];

  // Normalize boosted scores to 0–1 similarity (1.0 = best match in result set)
  const boostVals  = dedupedRows.map(r => r.boosted);
  const maxBoost   = boostVals.length ? Math.max(...boostVals) : 1;
  const minBoost   = boostVals.length ? Math.min(...boostVals) : 0;
  const boostRange = maxBoost - minBoost;
  const rowsWithSim = dedupedRows.map(r => ({
    ...r,
    similarity: boostRange > 0 ? (r.boosted - minBoost) / boostRange : 1.0
  }));

  // Log similarity scores so retrieval quality can be monitored
  console.log("  [search] Similarity scores:");
  rowsWithSim.forEach(r => {
    console.log(`    section=${r.section.padEnd(35)} bm25=${(r.rawScore ?? 0).toFixed(3).padStart(8)}  sim=${r.similarity.toFixed(3)}`);
  });

  // Apply similarity threshold — primary 0.70, fall back to 0.60 if < 3 chunks qualify
  let filtered = rowsWithSim.filter(r => r.similarity >= MIN_SIMILARITY_PRIMARY);
  if (filtered.length < 3) {
    console.log(`  [search] < 3 chunks above ${MIN_SIMILARITY_PRIMARY} — lowering threshold to ${MIN_SIMILARITY_FALLBACK}`);
    filtered = rowsWithSim.filter(r => r.similarity >= MIN_SIMILARITY_FALLBACK);
  }
  if (!filtered.length) {
    console.log("  [search] No chunks above fallback threshold — returning all available");
    filtered = rowsWithSim;
  }

  // Apply section focus filter when tab routing is active
  if (focusSections && focusSections.length) {
    const sectionFiltered = filtered.filter(r => focusSections.includes(r.section));
    if (sectionFiltered.length > 0) {
      filtered = sectionFiltered;
      console.log(`  [search] Section focus (${focusSections.join(", ")}) → ${filtered.length} chunk(s) retained`);
    } else {
      console.log(`  [search] Section focus found no matches — ignoring filter`);
    }
  }

  // Sort: priority sections first, then by score
  const results = filtered
    .sort((a, b) => {
      const ap = priority.indexOf(a.section);
      const bp = priority.indexOf(b.section);
      if (ap !== -1 && bp === -1) return -1;
      if (ap === -1 && bp !== -1) return 1;
      if (ap !== -1 && bp !== -1) return ap - bp;
      return b.score - a.score;
    })
    .slice(0, topK);

  console.log(`  [search] returning ${results.length} chunks: ${results.map(r => r.section).join(", ")}`);
  return results;
}

/**
 * Format search results as PI context string for the Anthropic prompt.
 * Sections sourced from the full FDA label PDF are annotated [FDA PDF].
 */
function formatAsContext(results) {
  if (!results.length) return null;
  return results
    .map(r => `[${r.section.toUpperCase().replace(/_/g, " ")}]\n${r.text}`)
    .join("\n\n");
}

module.exports = { searchPI, formatAsContext };

// ── CLI test ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const drug = process.argv[2] || "doxycycline";
  const mode = process.argv[3] || "drip";
  const k    = parseInt(process.argv[4] || "4", 10);

  searchPI(drug, mode, k).then(results => {
    if (!results.length) { console.log("No results."); return; }
    results.forEach((r, i) => {
      console.log(`\n── Result ${i+1}: [${r.section}] ──`);
      console.log(r.text.slice(0, 500));
    });
  }).catch(e => { console.error(e.message); process.exit(1); });
}
