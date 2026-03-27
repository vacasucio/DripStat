/**
 * validate_cache.js
 * Validates quickdrip_cache.json for schema correctness, data completeness,
 * and clinical spot-checks.
 *
 * Usage: node validate_cache.js
 */

const fs   = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "quickdrip_cache.json");
const DB_PATH    = path.join(__dirname, "drugs_database.json");

if (!fs.existsSync(CACHE_PATH)) {
  console.error("quickdrip_cache.json not found. Run build_quickdrip_cache.js first.");
  process.exit(1);
}

const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
let drugsDb = {};
try { drugsDb = JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch {}

const drugs = Object.keys(cache);
const complete = drugs.filter(d => cache[d].dataComplete);
const errors = drugs.filter(d => cache[d].error);
const incomplete = drugs.filter(d => !cache[d].dataComplete && !cache[d].error);

console.log(`\n  QuickDrip Cache Validation`);
console.log(`  ─────────────────────────`);
console.log(`  Total entries:  ${drugs.length}`);
console.log(`  Complete:       ${complete.length}`);
console.log(`  Errors:         ${errors.length}`);
console.log(`  Incomplete:     ${incomplete.length}`);
console.log();

// ── Schema Validation ──────────────────────────────────────────────────────

const REQUIRED_FIELDS = [
  "drugName", "drugClass", "sourceUsed", "reconstitution", "dilution",
  "administration", "ivCompatibility", "monitoring", "sideEffects",
  "blackBoxWarnings", "clinicalAlerts", "citation", "dataComplete"
];

const ARRAY_FIELDS = ["reconstitution", "dilution", "administration", "ivCompatibility", "sideEffects", "blackBoxWarnings", "clinicalAlerts"];

let schemaIssues = 0;
const nullFields = {}; // field → count of drugs where it's null/empty

for (const drug of complete) {
  const d = cache[drug];

  // Check required fields exist
  for (const field of REQUIRED_FIELDS) {
    if (d[field] === undefined) {
      console.log(`  SCHEMA: ${drug} — missing field: ${field}`);
      schemaIssues++;
    }
  }

  // Check array fields are arrays
  for (const field of ARRAY_FIELDS) {
    if (d[field] !== undefined && d[field] !== null && !Array.isArray(d[field])) {
      console.log(`  SCHEMA: ${drug} — ${field} is not an array: ${typeof d[field]}`);
      schemaIssues++;
    }
  }

  // Check monitoring is an object
  if (d.monitoring && typeof d.monitoring !== "object") {
    console.log(`  SCHEMA: ${drug} — monitoring is not an object`);
    schemaIssues++;
  }

  // Track null/empty fields
  for (const field of ARRAY_FIELDS) {
    if (!d[field] || (Array.isArray(d[field]) && d[field].length === 0)) {
      nullFields[field] = (nullFields[field] || 0) + 1;
    }
  }

  // Check citation has url
  if (!d.citation?.url) {
    nullFields["citation.url"] = (nullFields["citation.url"] || 0) + 1;
  }
}

console.log(`  Schema issues: ${schemaIssues}`);
console.log();

// ── Null/Empty Field Analysis ──────────────────────────────────────────────

console.log(`  Field Completeness (${complete.length} drugs):`);
for (const [field, count] of Object.entries(nullFields).sort((a, b) => b[1] - a[1])) {
  const pct = ((complete.length - count) / complete.length * 100).toFixed(0);
  console.log(`    ${field.padEnd(25)} ${pct}% complete  (${count} null/empty)`);
}
console.log();

// ── Critical Drug Spot-Checks ──────────────────────────────────────────────

const SPOT_CHECKS = [
  {
    drug: "vancomycin",
    checks: [
      { field: "administration", test: d => (d.administration || []).some(r => /60\s*min/i.test(r.value || "")), desc: "infusion ≥60 min" },
      { field: "ivPush", test: d => d.ivPush === null || d.ivPush === undefined, desc: "NOT IV push eligible" },
      { field: "reconstitution", test: d => (d.reconstitution || []).some(r => /sterile water/i.test(r.value || "")), desc: "reconstitute with SWFI" },
    ]
  },
  {
    drug: "furosemide",
    checks: [
      { field: "ivPush", test: d => d.ivPush && d.ivPush.eligible, desc: "IV push eligible" },
    ]
  },
  {
    drug: "amiodarone",
    checks: [
      { field: "blackBoxWarnings", test: d => (d.blackBoxWarnings || []).length > 0, desc: "has black box warnings" },
    ]
  },
  {
    drug: "heparin",
    checks: [
      { field: "administration", test: d => (d.administration || []).length > 0, desc: "has administration data" },
    ]
  },
  {
    drug: "norepinephrine",
    checks: [
      { field: "administration", test: d => (d.administration || []).length > 0, desc: "has administration data" },
    ]
  },
];

console.log(`  Clinical Spot-Checks:`);
let spotPass = 0, spotFail = 0, spotSkip = 0;
for (const { drug, checks } of SPOT_CHECKS) {
  const d = cache[drug];
  if (!d || !d.dataComplete) {
    console.log(`    ${drug}: SKIPPED (not in cache)`);
    spotSkip += checks.length;
    continue;
  }
  for (const { desc, test } of checks) {
    const passed = test(d);
    console.log(`    ${drug}: ${passed ? "✓" : "✗"} ${desc}`);
    if (passed) spotPass++; else spotFail++;
  }
}
console.log(`\n  Spot-check results: ${spotPass} pass, ${spotFail} fail, ${spotSkip} skip`);

// ── Cross-Reference with drugs_database.json ───────────────────────────────

if (Object.keys(drugsDb).length) {
  let crossMatches = 0;
  let crossMismatches = 0;
  for (const drug of complete.slice(0, 50)) {
    const dbEntry = drugsDb[drug];
    if (!dbEntry) continue;
    const cacheEntry = cache[drug];
    // Check if infusion time roughly matches
    if (dbEntry.infusionTime && cacheEntry.administration) {
      crossMatches++;
    }
  }
  console.log(`\n  Cross-reference with drugs_database.json: ${crossMatches} checked`);
}

// ── Error Summary ──────────────────────────────────────────────────────────

if (errors.length) {
  console.log(`\n  Errored drugs (${errors.length}):`);
  for (const drug of errors.slice(0, 20)) {
    console.log(`    ${drug}: ${cache[drug].error}`);
  }
  if (errors.length > 20) console.log(`    ... and ${errors.length - 20} more`);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n  ══════════════════════════════`);
console.log(`  Validation Complete`);
console.log(`  ${complete.length}/${drugs.length} drugs validated`);
console.log(`  ${schemaIssues} schema issues`);
console.log(`  ${spotPass}/${spotPass + spotFail} spot-checks passed`);
console.log(`  ══════════════════════════════\n`);

process.exit(schemaIssues > 0 || spotFail > 0 ? 1 : 0);
