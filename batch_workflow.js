#!/usr/bin/env node
/**
 * batch_workflow.js
 * Smart workflow tool for processing incomplete drugs in quickdrip_cache.json
 * across multiple Claude Code sessions.
 *
 * Usage:
 *   node batch_workflow.js status                  — summary of complete vs incomplete drugs
 *   node batch_workflow.js next 10                 — prompt for next 10 incomplete drugs
 *   node batch_workflow.js next 10 --offset 20     — skip first 20 incomplete, show next 10
 *   node batch_workflow.js write dopamine '{...}'   — write a single drug entry to cache
 */

const fs   = require("fs");
const path = require("path");

// ── Paths ────────────────────────────────────────────────────────────────────

const CACHE_PATH = path.join(__dirname, "quickdrip_cache.json");
const LABELS_DIR = path.join(__dirname, "labels");

// ── PI Sections to Extract ───────────────────────────────────────────────────
// Same order and keys as build_quickdrip_cache.js for consistency.

const PI_SECTIONS = [
  ["description",               "DESCRIPTION",                 800],
  ["dosage_and_administration", "DOSAGE AND ADMINISTRATION",  1200],
  ["warnings_and_precautions",  "WARNINGS AND PRECAUTIONS",    600],
  ["warnings",                  "WARNINGS",                    600],
  ["warnings_and_cautions",     "WARNINGS AND CAUTIONS",       600],
  ["boxed_warning",             "BOXED WARNING",               500],
  ["adverse_reactions",         "ADVERSE REACTIONS",            600],
  ["how_supplied",              "HOW SUPPLIED",                 400],
  ["clinical_pharmacology",     "CLINICAL PHARMACOLOGY",       600],
  ["drug_interactions",         "DRUG INTERACTIONS",            400],
  ["contraindications",         "CONTRAINDICATIONS",           300],
  ["precautions",               "PRECAUTIONS",                 500],
];

// Target max chars per drug after assembling all sections.
const MAX_PI_CHARS = 3000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`ERROR: Cache file not found at ${CACHE_PATH}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch (e) {
    console.error(`ERROR: Failed to parse cache file: ${e.message}`);
    process.exit(1);
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function labelFileName(drugName) {
  return drugName.replace(/ /g, "_") + ".json";
}

function loadLabel(drugName) {
  const filePath = path.join(LABELS_DIR, labelFileName(drugName));
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return raw.label || raw;
  } catch {
    return null;
  }
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

/**
 * Assemble PI text from a label, truncating each section to its budget and
 * the total to MAX_PI_CHARS.
 */
function assembleTruncatedPI(label) {
  const parts = [];
  let totalLen = 0;

  for (const [key, title, budget] of PI_SECTIONS) {
    const val = label[key];
    if (!val) continue;

    let text = Array.isArray(val) ? val.join("\n") : String(val);
    text = text.trim();
    if (!text) continue;

    // Strip HTML tags for cleaner output.
    text = text.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

    // Truncate this section to its budget.
    if (text.length > budget) {
      text = text.slice(0, budget) + " [...]";
    }

    const section = `[${title}]\n${text}`;
    totalLen += section.length + 2; // +2 for separator newlines

    if (totalLen > MAX_PI_CHARS) {
      // Add what fits and stop.
      const remaining = MAX_PI_CHARS - (totalLen - section.length - 2);
      if (remaining > 100) {
        parts.push(section.slice(0, remaining) + " [...]");
      }
      break;
    }

    parts.push(section);
  }

  return parts.join("\n\n");
}

/**
 * Get all incomplete drug names from the cache, sorted alphabetically.
 */
function getIncompleteDrugs(cache) {
  return Object.keys(cache)
    .filter(drug => !cache[drug].dataComplete)
    .sort();
}

/**
 * Get all complete drug names from the cache.
 */
function getCompleteDrugs(cache) {
  return Object.keys(cache)
    .filter(drug => cache[drug].dataComplete === true)
    .sort();
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdStatus() {
  const cache = loadCache();
  const allDrugs = Object.keys(cache);
  const complete = getCompleteDrugs(cache);
  const incomplete = getIncompleteDrugs(cache);

  // Categorize incomplete drugs.
  const withError = incomplete.filter(d => cache[d].error);
  const withPartialData = incomplete.filter(d => !cache[d].error && cache[d].drugName);
  const errorOnly = incomplete.filter(d => cache[d].error && !cache[d].drugName);

  console.log("");
  console.log("  QuickDrip Cache Status");
  console.log("  ══════════════════════");
  console.log(`  Total entries:       ${allDrugs.length}`);
  console.log(`  Complete:            ${complete.length}`);
  console.log(`  Incomplete:          ${incomplete.length}`);
  console.log(`  Progress:            ${((complete.length / allDrugs.length) * 100).toFixed(1)}%`);
  console.log("");

  if (withPartialData.length > 0) {
    console.log(`  Partial data (have fields but dataComplete=false): ${withPartialData.length}`);
    for (const d of withPartialData) {
      const entry = cache[d];
      const fields = Object.keys(entry).filter(k => k !== "dataComplete" && entry[k] !== null && entry[k] !== "" && !(Array.isArray(entry[k]) && entry[k].length === 0));
      console.log(`    - ${d} (${fields.length} fields populated)`);
    }
    console.log("");
  }

  if (errorOnly.length > 0) {
    console.log(`  Error-only entries: ${errorOnly.length}`);
    for (const d of errorOnly) {
      console.log(`    - ${d}: ${cache[d].error}`);
    }
    console.log("");
  }

  if (withError.length > 0 && withError.length !== errorOnly.length) {
    const mixed = withError.filter(d => cache[d].drugName);
    if (mixed.length > 0) {
      console.log(`  Entries with errors AND partial data: ${mixed.length}`);
      for (const d of mixed) {
        console.log(`    - ${d}: ${cache[d].error}`);
      }
      console.log("");
    }
  }

  // Show all incomplete drugs grouped for quick scanning.
  if (incomplete.length > 0) {
    console.log("  All incomplete drugs:");
    const cols = 3;
    const colWidth = 35;
    for (let i = 0; i < incomplete.length; i += cols) {
      const row = incomplete.slice(i, i + cols);
      console.log("    " + row.map(d => d.padEnd(colWidth)).join(""));
    }
    console.log("");
  }

  // Check label availability for incomplete drugs.
  let labelsAvailable = 0;
  let labelsMissing = 0;
  const missingLabels = [];
  for (const drug of incomplete) {
    const labelPath = path.join(LABELS_DIR, labelFileName(drug));
    if (fs.existsSync(labelPath)) {
      labelsAvailable++;
    } else {
      labelsMissing++;
      missingLabels.push(drug);
    }
  }

  console.log(`  Labels available for incomplete drugs: ${labelsAvailable}`);
  console.log(`  Labels missing for incomplete drugs:   ${labelsMissing}`);
  if (missingLabels.length > 0 && missingLabels.length <= 20) {
    console.log("  Missing labels:");
    for (const d of missingLabels) {
      console.log(`    - ${d}`);
    }
  }
  console.log("");
}

function cmdNext(count, offset) {
  const cache = loadCache();
  const incomplete = getIncompleteDrugs(cache);

  if (incomplete.length === 0) {
    console.log("All drugs in the cache are complete. Nothing to process.");
    return;
  }

  // Filter to only drugs that have a label file available.
  const processable = incomplete.filter(drug => {
    const labelPath = path.join(LABELS_DIR, labelFileName(drug));
    return fs.existsSync(labelPath);
  });

  if (processable.length === 0) {
    console.log("No incomplete drugs have label files available.");
    return;
  }

  const sliced = processable.slice(offset, offset + count);

  if (sliced.length === 0) {
    console.log(`Offset ${offset} exceeds the ${processable.length} processable incomplete drugs.`);
    return;
  }

  // Build the prompt output.
  const lines = [];

  lines.push("═══════════════════════════════════════════════════════════════════════════════");
  lines.push("BATCH PROMPT — Paste everything below into a new Claude Code session");
  lines.push("═══════════════════════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Process the following ${sliced.length} drug(s) from their FDA package insert text.`);
  lines.push(`For each drug, produce a JSON object matching the QuickDrip cache schema.`);
  lines.push("");
  lines.push("IMPORTANT RULES:");
  lines.push("- Extract ONLY adult IV dosing information. Skip pediatric, neonatal, and oral dosing entirely.");
  lines.push("- Every field must come from the provided PI text. If not documented, return null (or [] for arrays).");
  lines.push("- Do NOT use training knowledge to fill gaps. A null is correct; a guess is dangerous.");
  lines.push("- Set dataComplete: true only if meaningful data was extracted.");
  lines.push("- If the drug has NO IV formulation or the PI text is insufficient, still return the JSON skeleton with");
  lines.push("  sourceNotes explaining why, and set dataComplete: true so it is not reprocessed.");
  lines.push("");
  lines.push("REQUIRED JSON SCHEMA for each drug:");
  lines.push("```json");
  lines.push("{");
  lines.push('  "drugName": "string — proper name from PI",');
  lines.push('  "brandName": "string or null",');
  lines.push('  "drugClass": "string — pharmacologic class",');
  lines.push('  "sourceUsed": "DailyMed",');
  lines.push('  "labelDate": "string or null",');
  lines.push('  "sourceNotes": "string — cite the PI setid",');
  lines.push('  "reconstitution": [{"label": "string", "value": "string"}],');
  lines.push('  "dilution": [{"label": "string", "value": "string"}],');
  lines.push('  "administration": [{"label": "string", "value": "string"}],');
  lines.push('  "ivCompatibility": [{"label": "string", "value": "string", "status": "compatible|incompatible|caution|unknown"}],');
  lines.push('  "ivPush": null,');
  lines.push('  "monitoring": {');
  lines.push('    "labs": "string or null", "labsSrc": "PI or null",');
  lines.push('    "drugLevels": "string or null", "drugLevelsSrc": "PI or null",');
  lines.push('    "vitals": "string or null", "duringInfusion": "string or null"');
  lines.push('  },');
  lines.push('  "dosageAndTitration": [{"label": "string", "value": "string"}],');
  lines.push('  "sideEffects": ["string — 4-8 common side effects relevant to IV administration"],');
  lines.push('  "blackBoxWarnings": ["string"],');
  lines.push('  "clinicalAlerts": ["string — key safety points for bedside nurses"],');
  lines.push('  "citation": {"primary": "string — PI title", "url": "string — DailyMed URL", "ashp": null},');
  lines.push('  "dataComplete": true');
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("If PI or ASHP explicitly says the drug CAN be given IV push, replace null ivPush with:");
  lines.push('  {"eligible": "yes|emergency only", "pushRate": "string or null", "pushRateSrc": "PI or ASHP",');
  lines.push('   "maxConcentration": "string or null", "dilutionRequired": "string or null",');
  lines.push('   "specialConditions": "string or null", "specialConditionsSrc": "PI or ASHP or null",');
  lines.push('   "warning": "string or null"}');
  lines.push("");
  lines.push("After producing all JSON objects, write them to the cache using this command for EACH drug:");
  lines.push('  node batch_workflow.js write <drug_key> \'<json>\'');
  lines.push("Where <drug_key> is the key shown below (lowercase, spaces not underscores).");
  lines.push("");
  lines.push(`Showing drugs ${offset + 1}–${offset + sliced.length} of ${processable.length} processable incomplete drugs.`);
  lines.push(`(${incomplete.length} total incomplete; ${incomplete.length - processable.length} lack label files)`);
  lines.push("");

  // Now output each drug's PI text.
  for (let i = 0; i < sliced.length; i++) {
    const drugKey = sliced[i];
    const label = loadLabel(drugKey);

    lines.push("───────────────────────────────────────────────────────────────────────────────");
    lines.push(`DRUG ${offset + i + 1}: ${drugKey}`);
    lines.push("───────────────────────────────────────────────────────────────────────────────");

    if (!label) {
      lines.push("[ERROR] Label file not found or unreadable.");
      lines.push("");
      continue;
    }

    const setId = getSetId(label);
    const citationUrl = dailymedUrl(setId, drugKey);

    lines.push(`Cache key:    ${drugKey}`);
    lines.push(`Set ID:       ${setId || "unknown"}`);
    lines.push(`Citation URL: ${citationUrl}`);

    // Show existing error if any.
    const existing = cache[drugKey];
    if (existing && existing.error) {
      lines.push(`Prior error:  ${existing.error}`);
    }

    lines.push("");
    lines.push("PI TEXT (key sections, truncated):");
    lines.push("---");

    const piText = assembleTruncatedPI(label);
    if (!piText || piText.length < 50) {
      lines.push("[WARNING] PI text is very short or empty. This drug may lack usable label data.");
    } else {
      lines.push(piText);
    }

    lines.push("---");
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════════════════════════");
  lines.push("END OF BATCH PROMPT");
  lines.push("═══════════════════════════════════════════════════════════════════════════════");

  console.log(lines.join("\n"));
}

function cmdWrite(drugKey, jsonStr) {
  if (!drugKey) {
    console.error("ERROR: Drug key is required. Usage: node batch_workflow.js write <drug_key> '<json>'");
    process.exit(1);
  }

  if (!jsonStr) {
    console.error("ERROR: JSON string is required. Usage: node batch_workflow.js write <drug_key> '<json>'");
    process.exit(1);
  }

  let entry;
  try {
    entry = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`ERROR: Invalid JSON: ${e.message}`);
    console.error("Tip: Make sure the JSON is properly quoted. On most shells, wrap it in single quotes.");
    process.exit(1);
  }

  // Validate required fields.
  const requiredFields = ["drugName", "dataComplete"];
  for (const field of requiredFields) {
    if (!(field in entry)) {
      console.error(`ERROR: Missing required field "${field}" in the provided JSON.`);
      process.exit(1);
    }
  }

  const cache = loadCache();
  const normalizedKey = drugKey.toLowerCase().trim();

  const isNew = !(normalizedKey in cache);
  const wasComplete = !isNew && cache[normalizedKey].dataComplete === true;

  cache[normalizedKey] = entry;
  saveCache(cache);

  const action = isNew ? "Added" : (wasComplete ? "Overwrote (was complete)" : "Updated");
  console.log(`${action}: ${normalizedKey}`);
  console.log(`  drugName:     ${entry.drugName}`);
  console.log(`  dataComplete: ${entry.dataComplete}`);

  // Quick field count for verification.
  const populated = Object.keys(entry).filter(k => {
    const v = entry[k];
    return v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
  console.log(`  Fields populated: ${populated.length}/${Object.keys(entry).length}`);
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

function printUsage() {
  console.log("");
  console.log("  batch_workflow.js — QuickDrip batch processing tool");
  console.log("  ═══════════════════════════════════════════════════");
  console.log("");
  console.log("  Commands:");
  console.log("    status                     Show cache completion summary");
  console.log("    next <count> [--offset N]  Output PI text + prompt for N incomplete drugs");
  console.log("    write <key> '<json>'       Write a single drug entry to the cache");
  console.log("");
  console.log("  Examples:");
  console.log("    node batch_workflow.js status");
  console.log("    node batch_workflow.js next 10");
  console.log("    node batch_workflow.js next 5 --offset 20");
  console.log('    node batch_workflow.js write dopamine \'{"drugName":"Dopamine",...}\'');
  console.log("");
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0].toLowerCase();

  switch (command) {
    case "status": {
      cmdStatus();
      break;
    }

    case "next": {
      const count = parseInt(args[1], 10);
      if (isNaN(count) || count < 1) {
        console.error("ERROR: 'next' requires a positive integer count. Usage: node batch_workflow.js next 10");
        process.exit(1);
      }

      let offset = 0;
      const offsetIdx = args.indexOf("--offset");
      if (offsetIdx !== -1) {
        offset = parseInt(args[offsetIdx + 1], 10);
        if (isNaN(offset) || offset < 0) {
          console.error("ERROR: --offset requires a non-negative integer.");
          process.exit(1);
        }
      }

      cmdNext(count, offset);
      break;
    }

    case "write": {
      const drugKey = args[1];
      // The JSON may be split across multiple args if the shell split on spaces.
      // Join everything after the drug key.
      const jsonStr = args.slice(2).join(" ");
      cmdWrite(drugKey, jsonStr);
      break;
    }

    case "help":
    case "--help":
    case "-h": {
      printUsage();
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }
  }
}

main();
