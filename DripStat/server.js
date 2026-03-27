const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Vector search — used when pi_embeddings.db exists
let searchPI, formatAsContext;
const DB_PATH = path.join(__dirname, "pi_embeddings.db");
if (fs.existsSync(DB_PATH)) {
  try {
    ({ searchPI, formatAsContext } = require("./search"));
    console.log("  ✓ Vector search loaded (pi_embeddings.db found)");
  } catch (e) {
    console.warn("  ⚠ Vector search unavailable:", e.message);
  }
} else {
  console.log("  ℹ Vector search not available (run embed_labels.js to enable)");
}

// Load drugs_database.json for retrieval-failure validation
const DB_JSON_PATH = path.join(__dirname, "drugs_database.json");
let drugsDatabase = {};
try {
  drugsDatabase = JSON.parse(fs.readFileSync(DB_JSON_PATH, "utf8"));
  console.log(`  ✓ drugs_database.json loaded (${Object.keys(drugsDatabase).length} entries)`);
} catch (e) {
  console.warn("  ⚠ drugs_database.json not found — retrieval validation disabled");
}

// Load pre-computed quickdrip cache (instant lookups)
const QDCACHE_PATH = path.join(__dirname, "quickdrip_cache.json");
const OVERRIDES_PATH = path.join(__dirname, "quickdrip_overrides.json");
let quickdripCache = {};
try {
  quickdripCache = JSON.parse(fs.readFileSync(QDCACHE_PATH, "utf8"));
  // Filter to only complete entries
  const total = Object.keys(quickdripCache).length;
  const complete = Object.values(quickdripCache).filter(v => v.dataComplete).length;
  console.log(`  ✓ quickdrip_cache.json loaded (${complete}/${total} complete)`);
} catch (e) {
  console.log("  ℹ quickdrip_cache.json not found — all lookups will be live");
}

// Merge overrides on top of cache
try {
  if (fs.existsSync(OVERRIDES_PATH)) {
    const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
    for (const [drug, data] of Object.entries(overrides)) {
      quickdripCache[drug] = { ...quickdripCache[drug], ...data };
    }
    console.log(`  ✓ quickdrip_overrides.json merged (${Object.keys(overrides).length} overrides)`);
  }
} catch (e) {
  console.warn("  ⚠ Error loading overrides:", e.message);
}

// Load brand name / abbreviation aliases
const ALIASES_PATH = path.join(__dirname, "drug_aliases.json");
let drugAliases = {};  // alias → generic
let reverseAliases = {}; // generic → [aliases]
try {
  const raw = JSON.parse(fs.readFileSync(ALIASES_PATH, "utf8"));
  for (const [alias, generic] of Object.entries(raw)) {
    if (alias.startsWith("_")) continue; // skip comments
    drugAliases[alias.toLowerCase()] = generic.toLowerCase();
    const g = generic.toLowerCase();
    if (!reverseAliases[g]) reverseAliases[g] = [];
    reverseAliases[g].push(alias.toLowerCase());
  }
  console.log(`  ✓ drug_aliases.json loaded (${Object.keys(drugAliases).length} aliases)`);
} catch (e) {
  console.log("  ℹ drug_aliases.json not found — brand name search disabled");
}

// ── ISMP High-Alert Medications ──────────────────────────────────────────────
// ISMP 2024 acute care high-alert medication classes and representative agents.
// Requires explicit confirmation before drip rate calculation.
const ISMP_HIGH_ALERT_DRUGS = new Set([
  // Anticoagulants & thrombolytics
  'heparin', 'bivalirudin', 'argatroban', 'fondaparinux', 'lepirudin',
  'alteplase', 'tenecteplase', 'reteplase',
  // Concentrated electrolytes
  'potassium chloride', 'potassium phosphate',
  'calcium chloride', 'calcium gluconate',
  'magnesium sulfate', 'sodium chloride',
  // Insulin
  'insulin',
  // Neuromuscular blocking agents (NMBAs)
  'succinylcholine', 'vecuronium', 'rocuronium', 'cisatracurium',
  'atracurium', 'pancuronium', 'mivacurium',
  // Opioids (parenteral)
  'morphine', 'fentanyl', 'hydromorphone', 'sufentanil',
  'remifentanil', 'alfentanil', 'meperidine', 'oxymorphone',
  // Vasopressors / vasoactive agents
  'epinephrine', 'norepinephrine', 'dopamine', 'dobutamine',
  'vasopressin', 'phenylephrine', 'milrinone', 'isoproterenol',
  'nitroprusside',
  // Chemotherapy agents (common IV agents)
  'vincristine', 'methotrexate', 'cytarabine', 'cyclophosphamide',
  'doxorubicin', 'cisplatin', 'carboplatin', 'oxaliplatin', 'paclitaxel',
  'docetaxel', 'gemcitabine', 'fluorouracil', 'ifosfamide',
  'bleomycin', 'daunorubicin', 'epirubicin',
]);

// ── Concentration Ceilings ───────────────────────────────────────────────────
// Maximum safe concentrations per ISMP, FDA PI, and ASHP standards.
// { max, unit, note } — blocks calculation if user-specified conc exceeds max.
const MAX_SAFE_CONCENTRATIONS = {
  'heparin':            { max: 100,   unit: 'units/mL', note: 'ISMP: standard peripheral max 100 units/mL (25,000 units/250 mL)' },
  'potassium chloride': { max: 0.1,   unit: 'mEq/mL',  note: 'ISMP: max 10 mEq/100 mL (0.1 mEq/mL) peripheral' },
  'potassium phosphate':{ max: 0.1,   unit: 'mmol/mL', note: 'ISMP: max 10 mmol/100 mL peripheral' },
  'vancomycin':         { max: 5,     unit: 'mg/mL',   note: 'ASHP: max 5 mg/mL to reduce phlebitis risk' },
  'magnesium sulfate':  { max: 20,    unit: 'mg/mL',   note: 'Max 20 mg/mL (2 g/100 mL) for continuous IV infusion' },
  'morphine':           { max: 15,    unit: 'mg/mL',   note: 'Standard max 15 mg/mL for IV infusion/PCA' },
  'hydromorphone':      { max: 1,     unit: 'mg/mL',   note: 'Standard max 1 mg/mL; higher concentrations require institutional approval' },
  'fentanyl':           { max: 0.05,  unit: 'mg/mL',   note: 'Max 50 mcg/mL (0.05 mg/mL) for standard IV infusion' },
  'nitroprusside':      { max: 0.2,   unit: 'mg/mL',   note: 'Max 200 mcg/mL (0.2 mg/mL) per FDA PI' },
  'nitroglycerin':      { max: 0.4,   unit: 'mg/mL',   note: 'Max 400 mcg/mL (0.4 mg/mL) per FDA PI' },
  'dopamine':           { max: 3.2,   unit: 'mg/mL',   note: 'Max 3.2 mg/mL (800 mg/250 mL) for standard peripheral IV' },
};

/**
 * Parse an explicit concentration from a natural-language drip query.
 * Handles compound forms (X units/Y mL) and direct forms (X mg/mL).
 * Returns { value, unit } or null if no concentration found.
 */
function parseConcentrationFromQuery(query) {
  const q = query;

  // "X units/Y mL" → compute units/mL
  let m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*units?\s*\/\s*(\d[\d,]*(?:\.\d+)?)\s*m[lL]/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, '')), vol = parseFloat(m[2].replace(/,/g, ''));
    if (vol > 0) return { value: v / vol, unit: 'units/mL' };
  }

  // "X units/mL" direct
  m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*units?\s*\/\s*m[lL]/i);
  if (m) return { value: parseFloat(m[1].replace(/,/g, '')), unit: 'units/mL' };

  // "X g/Y mL" → compute mg/mL
  m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*g\s*\/\s*(\d[\d,]*(?:\.\d+)?)\s*m[lL]/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, '')), vol = parseFloat(m[2].replace(/,/g, ''));
    if (vol > 0) return { value: (v * 1000) / vol, unit: 'mg/mL' };
  }

  // "X mg/Y mL" → compute mg/mL
  m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*mg\s*\/\s*(\d[\d,]*(?:\.\d+)?)\s*m[lL]/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, '')), vol = parseFloat(m[2].replace(/,/g, ''));
    if (vol > 0) return { value: v / vol, unit: 'mg/mL' };
  }

  // "X mg/mL" direct
  m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*mg\s*\/\s*m[lL]/i);
  if (m) return { value: parseFloat(m[1].replace(/,/g, '')), unit: 'mg/mL' };

  // "X mcg/mL" → convert to mg/mL
  m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*mcg\s*\/\s*m[lL]/i);
  if (m) return { value: parseFloat(m[1].replace(/,/g, '')) / 1000, unit: 'mg/mL' };

  // "X mEq/Y mL" → compute mEq/mL
  m = q.match(/(\d[\d,]*(?:\.\d+)?)\s*mEq\s*\/\s*(\d[\d,]*(?:\.\d+)?)\s*m[lL]/i);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, '')), vol = parseFloat(m[2].replace(/,/g, ''));
    if (vol > 0) return { value: v / vol, unit: 'mEq/mL' };
  }

  return null;
}

/**
 * Check whether a parsed concentration exceeds the ceiling for a given drug.
 * Returns a violation object or null.
 */
function checkConcentrationCeiling(drugName, parsedConc) {
  if (!parsedConc) return null;
  const ceiling = MAX_SAFE_CONCENTRATIONS[drugName.toLowerCase()];
  if (!ceiling) return null;
  if (parsedConc.unit === ceiling.unit && parsedConc.value > ceiling.max) {
    return {
      drug: drugName,
      entered: `${parsedConc.value % 1 === 0 ? parsedConc.value : parsedConc.value.toFixed(2)} ${parsedConc.unit}`,
      maximum: `${ceiling.max} ${ceiling.unit}`,
      note: ceiling.note,
    };
  }
  return null;
}

// Resolve a drug name through aliases (brand→generic, abbreviation→generic)
function resolveDrugName(input) {
  const lower = input.toLowerCase().trim();
  // Direct match in cache or drug list
  if (quickdripCache[lower]?.dataComplete) return lower;
  // Alias match
  if (drugAliases[lower]) return drugAliases[lower];
  return lower;
}

// Build drug name list for autocomplete (generics + aliases)
let allDrugNames = [];
let allSearchEntries = []; // { name, generic, isAlias }
try {
  const drugList = require("./drug_list");
  const cacheKeys = Object.keys(quickdripCache).filter(k => quickdripCache[k].dataComplete);
  const generics = [...new Set([...cacheKeys, ...drugList.map(d => d.toLowerCase())])].sort();
  allDrugNames = generics;

  // Build search entries: generics + aliases
  allSearchEntries = generics.map(g => ({ name: g, generic: g, isAlias: false }));
  for (const [alias, generic] of Object.entries(drugAliases)) {
    allSearchEntries.push({ name: alias, generic: generic, isAlias: true });
  }
  console.log(`  ✓ Drug autocomplete list: ${generics.length} generics + ${Object.keys(drugAliases).length} aliases`);
} catch (e) {
  allDrugNames = Object.keys(quickdripCache).sort();
  allSearchEntries = allDrugNames.map(g => ({ name: g, generic: g, isAlias: false }));
}

// Load .env
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const [key, ...rest] = line.trim().split("=");
    if (key && rest.length) process.env[key] = rest.join("=").trim();
  });
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = 3579;

if (!API_KEY) {
  console.error("\n  ERROR: ANTHROPIC_API_KEY not found in .env file\n");
  process.exit(1);
}

// In-memory lookup cache — keyed by "drug:tab", TTL 10 minutes
const lookupCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
function cacheKey(drug, tab) { return `${drug.toLowerCase()}:${tab || "all"}`; }
function getCached(drug, tab) {
  const k = cacheKey(drug, tab);
  const entry = lookupCache.get(k);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { lookupCache.delete(k); return null; }
  return entry.data;
}
function setCached(drug, tab, data) {
  lookupCache.set(cacheKey(drug, tab), { ts: Date.now(), data });
}

// PI sections targeted per tab — keeps vector context focused
const TAB_SECTIONS = {
  reconstitution: ["dosage_and_administration", "reconstitution", "description"],
  administration: ["dosage_and_administration", "clinical_pharmacology", "warnings",
                   "warnings_and_cautions", "warnings_and_precautions", "precautions", "adverse_reactions"],
  compatibility:  ["dosage_and_administration", "description", "drug_interactions", "clinical_pharmacology"],
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "QuickDrip/1.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

async function queryPubMed(drug, mode = "lookup") {
  try {
    const rawQuery = mode === "drip"
      ? `${drug}[tiab] AND ("package insert"[tiab] OR "prescribing information"[tiab] OR "intravenous administration"[tiab] OR "infusion rate"[tiab] OR "dilution"[tiab] OR "reconstitution"[tiab])`
      : `${drug}[tiab] AND ("package insert"[tiab] OR "prescribing information"[tiab] OR "infusion rate"[tiab] OR "reconstitution"[tiab]) AND (intravenous[tiab] OR injection[tiab] OR injectable[tiab])`;
    const retmax = mode === "drip" ? 8 : 5;
    console.log(`  → PubMed query (${mode}): ${rawQuery}`);
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(rawQuery)}&retmax=${retmax}&sort=relevance&retmode=json`;
    console.log(`  → PubMed search URL: ${searchUrl}`);
    const { statusCode: sc1, body: searchBody } = await httpsGet(searchUrl);
    console.log(`  → PubMed search HTTP status: ${sc1}`);
    const searchData = JSON.parse(searchBody);
    const ids = searchData?.esearchresult?.idlist || [];
    console.log(`  → PubMed IDs found: ${ids.length} (${ids.join(", ") || "none"})`);
    if (!ids.length) return null;
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`;
    console.log(`  → PubMed fetch URL: ${fetchUrl}`);
    const { statusCode: sc2, body: abstracts } = await httpsGet(fetchUrl);
    console.log(`  → PubMed fetch HTTP status: ${sc2}, body length: ${abstracts.length}`);
    return abstracts.slice(0, 3000);
  } catch (e) {
    console.error("PubMed error:", e.message);
    return null;
  }
}

async function queryASHP(drug) {
  // ASHP.org returns 403 (Cloudflare bot-block) for all server-side requests.
  // The working alternative: query PubMed for AJHP-published guidelines — ASHP's
  // official journal is indexed in PubMed and contains IV push and monitoring guidance.
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(drug)}+AND+%22Am+J+Health+Syst+Pharm%22%5Bjour%5D+AND+(intravenous+OR+monitoring+OR+%22IV+push%22+OR+administration)&retmax=3&sort=relevance&retmode=json`;
    console.log(`  → ASHP/AJHP PubMed search: ${searchUrl}`);
    const { statusCode: sc1, body: searchBody } = await httpsGet(searchUrl);
    console.log(`  → ASHP search HTTP status: ${sc1}`);
    if (sc1 !== 200) return null;
    const ids = JSON.parse(searchBody)?.esearchresult?.idlist || [];
    console.log(`  → ASHP IDs found: ${ids.length} (${ids.join(", ") || "none"})`);
    if (!ids.length) return null;
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`;
    const { statusCode: sc2, body: abstracts } = await httpsGet(fetchUrl);
    console.log(`  → ASHP fetch HTTP status: ${sc2}, body length: ${abstracts.length}`);
    if (sc2 !== 200 || !abstracts.trim()) return null;
    return abstracts.slice(0, 2500);
  } catch (e) {
    console.error("ASHP query error:", e.message);
    return null;
  }
}

// Build DailyMed citation URL from setId, or fall back to search URL
function dailymedUrl(setId, drugName) {
  if (setId && setId !== "unknown") {
    return `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`;
  }
  const cleanName = cleanDrugName(drugName || "");
  return `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(cleanName)}`;
}

// Look up setId from local label JSON (used when vector DB is the PI source)
function getSetIdFromLocalLabel(drug) {
  try {
    const filePath = path.join(__dirname, "labels", `${drug.toLowerCase().replace(/\s+/g, "_")}.json`);
    if (!fs.existsSync(filePath)) return null;
    const { label } = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return label?.set_id || null;
  } catch { return null; }
}

async function queryDailyMedIV(drug) {
  try {
    const cleanName = cleanDrugName(drug);
    console.log(`  → Cleaned drug name: "${cleanName}" (from "${drug}")`);

    // Try with cleaned name first, then original if different
    const namesToTry = cleanName !== drug.toLowerCase() ? [cleanName, drug] : [cleanName];
    let label = null;

    for (const name of namesToTry) {
      const searchUrl = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(name)}"+AND+openfda.route:intravenous&limit=1`;
      console.log(`  → OpenFDA label URL (intravenous): ${searchUrl}`);
      const { statusCode, body } = await httpsGet(searchUrl);
      console.log(`  → OpenFDA HTTP status: ${statusCode}`);
      if (statusCode === 200) {
        const data = JSON.parse(body);
        console.log(`  → OpenFDA results: ${data?.meta?.results?.total ?? 0}`);
        if (data?.results?.length) { label = data.results[0]; break; }
      }
      // Fallback: no route filter
      const fallbackUrl = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(name)}"&limit=1`;
      console.log(`  → OpenFDA fallback URL (no route filter): ${fallbackUrl}`);
      const { statusCode: sc2, body: b2 } = await httpsGet(fallbackUrl);
      console.log(`  → OpenFDA fallback HTTP status: ${sc2}`);
      if (sc2 === 200) {
        const d2 = JSON.parse(b2);
        if (d2?.results?.length) { label = d2.results[0]; break; }
      }
    }

    if (!label) { console.log("  → OpenFDA: no results for any name variant"); return null; }
    return await extractOpenFDAText(label, drug);
  } catch (e) {
    console.error("OpenFDA error:", e.message);
    return null;
  }
}

// Fetch full SPL text from DailyMed using setId — gives the AI the same raw PI text as Open Evidence
async function queryDailyMedSPL(setId) {
  if (!setId) return null;
  try {
    const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setId}.json`;
    console.log(`  → DailyMed SPL URL: ${url}`);
    // Use Accept: application/json to avoid 415 from content negotiation
    const { statusCode, body } = await new Promise((resolve, reject) => {
      https.get(url, { headers: { "User-Agent": "QuickDrip/1.0", "Accept": "application/json" } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ statusCode: res.statusCode, body: d }));
      }).on("error", reject);
    });
    console.log(`  → DailyMed SPL HTTP status: ${statusCode}`);
    if (statusCode !== 200) { console.log(`  → DailyMed SPL non-200: ${body.slice(0, 200)}`); return null; }

    const data = JSON.parse(body);
    // v2 API can nest sections under data.sections or directly as sections
    const sections = data?.data?.sections || data?.sections || [];
    if (!sections.length) { console.log("  → DailyMed SPL: no sections found"); return null; }

    const parts = [];
    for (const sec of sections) {
      const title = (sec.title || sec.name || "SECTION").toUpperCase().trim();
      const text  = typeof sec.text === "string" ? sec.text
        : Array.isArray(sec.content) ? sec.content.join("\n")
        : typeof sec.content === "string" ? sec.content : "";
      if (text.trim()) parts.push(`[${title}]\n${text.trim()}`);
    }
    if (!parts.length) { console.log("  → DailyMed SPL: no text content extracted"); return null; }

    const fullText = parts.join("\n\n");
    console.log(`  → DailyMed SPL: ${parts.length} sections, ${fullText.length} chars`);
    return fullText.slice(0, 14000); // generous limit — AI gets the full raw PI
  } catch (e) {
    console.warn(`  → DailyMed SPL error: ${e.message}`);
    return null;
  }
}

// Returns { text, setId, citationUrl } or null
async function extractOpenFDAText(label, drug) {
  const setId = label.set_id || label.id || null;
  const effectiveDate = label.effective_time || "unknown";
  const citationUrl = dailymedUrl(setId, drug);
  console.log(`  → OpenFDA label: set_id=${setId}, effective_time=${effectiveDate}`);
  console.log(`  → Citation URL: ${citationUrl}`);

  // Step 1: try to fetch full SPL text from DailyMed — gives raw PI text like Open Evidence uses
  const splText = await queryDailyMedSPL(setId);
  if (splText) {
    console.log(`  → Using full DailyMed SPL text (${splText.length} chars)`);
    return { text: splText, setId, citationUrl };
  }

  // Step 2: fall back to OpenFDA structured sections
  console.log("  → DailyMed SPL unavailable — extracting OpenFDA structured sections");
  const SECTIONS = [
    ["description",              "DESCRIPTION"],
    ["clinical_pharmacology",    "CLINICAL PHARMACOLOGY"],
    ["dosage_and_administration","DOSAGE AND ADMINISTRATION"],
    ["warnings",                 "WARNINGS"],
    ["boxed_warning",            "BOXED WARNING"],
    ["contraindications",        "CONTRAINDICATIONS"],
    ["adverse_reactions",        "ADVERSE REACTIONS"],
    ["precautions",              "PRECAUTIONS"],
  ];
  const parts = [];
  for (const [key, title] of SECTIONS) {
    const val = label[key];
    if (val) {
      const text = Array.isArray(val) ? val.join("\n") : val;
      console.log(`  → OpenFDA section extracted: ${title} (${text.length} chars)`);
      parts.push(`[${title}]\n${text}`);
    }
  }
  if (!parts.length) { console.log("  → OpenFDA: no relevant sections found"); return null; }
  return { text: parts.join("\n\n").slice(0, 8000), setId, citationUrl };
}

// Strip dose quantities (e.g. "200mg", "0.5 mcg/kg", "500 mg/day") leaving only the drug name
function extractDrugName(query) {
  return query
    .replace(/\b\d+(\.\d+)?\s*(mcg|mg|g|mEq|units?|mmol|ml|mL)(\s*\/\s*\S+)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Clean drug name for API queries:
//   - combo drugs (piperacillin-tazobactam) → first component only (piperacillin)
//   - salt/form suffixes stripped (vancomycin hydrochloride → vancomycin)
const SALT_SUFFIXES = /\s+(hydrochloride|hcl|hyclate|sodium|sulfate|sulphate|phosphate|acetate|mesylate|monohydrate|dihydrate|potassium|chloride|tartrate|maleate|fumarate|bromide|lactate|citrate|gluconate|valerate|propionate|succinate|besylate|tosylate)\b/gi;
function cleanDrugName(name) {
  let clean = name.split(/\s*[-\/]\s*/)[0].trim(); // take first component of combo
  clean = clean.replace(SALT_SUFFIXES, "").trim();
  return clean;
}

// PubMed compatibility query — only used when tab=compatibility
async function queryPubMedCompat(drug) {
  try {
    const rawQuery = `${drug}[tiab] AND (compatibility[tiab] OR "Y-site"[tiab] OR admixture[tiab] OR "physical compatibility"[tiab])`;
    console.log(`  → PubMed compatibility query: ${rawQuery}`);
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(rawQuery)}&retmax=5&sort=relevance&retmode=json`;
    const { statusCode: sc1, body: searchBody } = await httpsGet(searchUrl);
    console.log(`  → PubMed compat search HTTP status: ${sc1}`);
    const ids = JSON.parse(searchBody)?.esearchresult?.idlist || [];
    console.log(`  → PubMed compat IDs found: ${ids.length}`);
    if (!ids.length) return null;
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`;
    const { statusCode: sc2, body: abstracts } = await httpsGet(fetchUrl);
    console.log(`  → PubMed compat fetch HTTP status: ${sc2}, ${abstracts.length} chars`);
    if (sc2 !== 200 || !abstracts.trim()) return null;
    return abstracts.slice(0, 3000);
  } catch (e) {
    console.error("PubMed compat error:", e.message);
    return null;
  }
}

// ── Shared Prompts ──────────────────────────────────────────────────────────
const { LOOKUP_PROMPT, DRIP_PROMPT } = require("./prompts");

function callAnthropic(systemPrompt, userMessage, maxTokens = 1500, model = "claude-haiku-4-5-20251001") {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      max_tokens: maxTokens,
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
          const inputTokens = parsed.usage?.input_tokens ?? "?";
          const outputTokens = parsed.usage?.output_tokens ?? "?";
          console.log(`  → stop_reason: ${stopReason} | tokens in/out: ${inputTokens}/${outputTokens} (limit: ${maxTokens})`);
          if (stopReason === "max_tokens") console.warn("  ⚠ TRUNCATED — increase max_tokens");
          console.log(`  → Raw AI response (FULL, ${raw.length} chars):\n${raw}`);
          resolve(raw);
        } catch (e) { reject(e); }
      });
    });
    apiReq.on("error", reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Serve HTML
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const htmlPath = path.join(__dirname, "quickdrip.html");
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(htmlPath));
    } else { res.writeHead(404); res.end("quickdrip.html not found"); }
    return;
  }

  // Serve static files (CSS, fonts)
  if (req.method === "GET" && req.url.startsWith("/quickdrip_files/")) {
    const safePath = req.url.replace(/\.\./g, "").replace(/\?.*$/, "");
    const filePath = path.join(__dirname, safePath);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = { ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".js": "text/javascript" };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream", "Cache-Control": "public, max-age=86400" });
      res.end(fs.readFileSync(filePath));
    } else { res.writeHead(404); res.end("Not found"); }
    return;
  }

  // ── /autocomplete — Drug Name Search (generics + brand names + abbreviations) ──
  if (req.method === "GET" && req.url.startsWith("/autocomplete")) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    if (q.length < 1) { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return; }

    // Search all entries (generics + aliases)
    const seen = new Set();
    const matches = [];
    for (const entry of allSearchEntries) {
      if (!entry.name.includes(q)) continue;
      const key = entry.generic; // dedupe by generic
      if (seen.has(key) && !entry.isAlias) continue;
      // For aliases, always show (they help nurses find the drug)
      if (entry.isAlias) {
        if (seen.has(`alias:${entry.name}`)) continue;
        seen.add(`alias:${entry.name}`);
        matches.push({ name: entry.name, generic: entry.generic, isAlias: true,
          priority: entry.name.startsWith(q) ? 0 : 1 });
      } else {
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ name: entry.name, generic: entry.generic, isAlias: false,
          priority: entry.name.startsWith(q) ? 0 : 1 });
      }
    }
    matches.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(matches.slice(0, 12)));
    return;
  }

  // ── /drugs — Full Drug List (generics + aliases) ──
  if (req.method === "GET" && req.url === "/drugs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(allSearchEntries.map(e => ({ name: e.name, generic: e.generic, isAlias: e.isAlias }))));
    return;
  }

  // ── /lookup — Drug Reference (cache-first) ──
  if (req.method === "POST" && req.url === "/lookup") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      let drug, tab;
      try { ({ drug, tab } = JSON.parse(body)); } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" })); return;
      }
      if (!drug) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing drug" })); return; }
      // Normalise tab value
      tab = (["reconstitution", "administration", "compatibility"].includes(tab)) ? tab : null;

      const t0 = Date.now();
      const ms = () => `+${Date.now() - t0}ms`;
      console.log(`\n  [${new Date().toLocaleTimeString()}] Lookup: ${drug}${tab ? ` [tab=${tab}]` : ""}`);

      // ── Resolve aliases (brand→generic, abbreviation→generic) ──
      const drugLower = resolveDrugName(drug);
      if (drugLower !== drug.toLowerCase().trim()) {
        console.log(`  → [${ms()}] Alias resolved: "${drug}" → "${drugLower}"`);
      }

      // ── Pre-computed cache hit — instant response ──
      const cacheEntry = quickdripCache[drugLower];
      if (cacheEntry && cacheEntry.dataComplete) {
        console.log(`  → [${ms()}] CACHE HIT — returning pre-computed data instantly`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          raw: JSON.stringify(cacheEntry),
          piUsed: true,
          piSource: "cache",
          ashpUsed: cacheEntry.sourceUsed?.includes("ASHP") || false,
          pubmedCompatUsed: false,
          tab
        }));
        return;
      }

      // ── In-memory TTL cache hit (for live fallback results) ──
      const cached = getCached(drug, tab);
      if (cached) {
        console.log(`  → [${ms()}] TTL cache hit (${cacheKey(drug, tab)}) — returning immediately`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cached));
        return;
      }

      // ── Block unknown drugs — don't send to LLM ──
      const isKnownDrug = allDrugNames.includes(drugLower) || Object.values(drugAliases).includes(drugLower);
      if (!isKnownDrug) {
        console.log(`  → [${ms()}] BLOCKED — "${drug}" not in drug database`);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `"${drug}" not found in our IV drug database. Check spelling or try the generic name.` }));
        return;
      }

      console.log(`  → [${ms()}] Cache miss — falling back to live extraction`);

      // Section focus for vector search (tab-specific)
      const focusSections = tab ? TAB_SECTIONS[tab] : null;

      // Start ASHP query in parallel — don't await yet
      console.log(`  → [${ms()}] Starting PI + ASHP queries in parallel...`);
      const ashpPromise = queryASHP(drug).catch(e => { console.warn("ASHP promise error:", e.message); return null; });

      // PubMed compatibility — only for compatibility tab
      const pubmedCompatPromise = tab === "compatibility"
        ? queryPubMedCompat(drug).catch(e => { console.warn("PubMed compat error:", e.message); return null; })
        : Promise.resolve(null);

      // 1. Drug class detection — search description section first, prepend to AI context
      let drugClassContext = null;
      if (searchPI) {
        try {
          console.log(`  → [${ms()}] Drug class detection (description section)...`);
          const descHits = await searchPI(drug, "lookup", 1, ["description"]);
          if (descHits.length) {
            const excerpt = descHits[0].text.slice(0, 600);
            drugClassContext = excerpt;
            console.log(`  → [${ms()}] Drug class context: ${excerpt.slice(0, 100)}...`);
          }
        } catch (e) {
          console.warn(`  → [${ms()}] Drug class detection failed: ${e.message}`);
        }
      }

      // 2. PI text — vector DB (focused by tab) then OpenFDA fallback
      let piContext = null;
      let piSource  = "none";

      if (searchPI) {
        try {
          console.log(`  → [${ms()}] Vector search${focusSections ? ` (sections: ${focusSections.join(", ")})` : ""}...`);
          const hits = await searchPI(drug, "lookup", 6, focusSections);
          if (hits.length) {
            piContext = formatAsContext(hits);
            piSource  = "vector";
            console.log(`  → [${ms()}] Vector search: ${hits.length} chunks found — skipping live API`);
          } else {
            console.log(`  → [${ms()}] Vector search: no hits, falling back to OpenFDA`);
          }
        } catch (e) {
          console.warn(`  → [${ms()}] ⚠ Vector search error: ${e.message} — falling back to OpenFDA`);
        }
      }
      let citationUrl = null;

      if (!piContext) {
        console.log(`  → [${ms()}] Querying OpenFDA...`);
        const result = await queryDailyMedIV(drug);
        if (result) {
          piContext   = result.text;
          piSource    = "dailymed";
          citationUrl = result.citationUrl;
          console.log(`  → [${ms()}] OpenFDA: ${result.text.length} chars`);
        } else {
          console.log(`  → [${ms()}] OpenFDA: no results`);
        }
      }

      // For vector path — look up setId from local label JSON
      if (piSource === "vector" && !citationUrl) {
        const setId = getSetIdFromLocalLabel(drug);
        citationUrl = dailymedUrl(setId, drug);
        console.log(`  → [${ms()}] Citation URL (vector): ${citationUrl}`);
      }
      if (!citationUrl) citationUrl = dailymedUrl(null, drug);

      // Await parallel queries
      const [ashpData, pubmedCompatData] = await Promise.all([ashpPromise, pubmedCompatPromise]);
      console.log(ashpData
        ? `  → [${ms()}] ASHP: ${ashpData.length} chars`
        : `  → [${ms()}] ASHP: no results`);
      if (pubmedCompatData) console.log(`  → [${ms()}] PubMed compat: ${pubmedCompatData.length} chars`);

      console.log(`  → [${ms()}] Source: ${piSource === "vector" ? "local vector DB" : piSource === "dailymed" ? "OpenFDA/DailyMed live" : "none"}`);

      const userMsg = [
        `IV reference data for: ${drug}`,
        tab ? `\nFocused section: ${tab.toUpperCase()} tab` : "",
        `\nCITATION URL (use this exact URL in the citation.url field): ${citationUrl}`,
        drugClassContext ? `\n\nDRUG CLASS CONTEXT (from PI description section):\n---\n${drugClassContext}\n---` : "",
        piContext        ? `\n\nFDA PACKAGE INSERT TEXT:\n---\n${piContext}\n---`  : "",
        ashpData         ? `\n\nASHP GUIDELINES (Am J Health Syst Pharm):\n---\n${ashpData}\n---` : "",
        pubmedCompatData ? `\n\nPubMed COMPATIBILITY LITERATURE:\n---\n${pubmedCompatData}\n---` : "",
      ].join("");

      try {
        console.log(`  → [${ms()}] Calling Anthropic...`);
        const raw = await callAnthropic(LOOKUP_PROMPT, userMsg, 2000, "claude-sonnet-4-5");
        console.log(`  → [${ms()}] Done`);

        // Validate: block responses that acknowledge no source was found
        try {
          const parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || [])[0] || raw);
          if (parsed.sourceUsed === "Not sourced") {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `No verified PI data found for "${drug}". Cannot return reference data without a confirmed source.`, piSource }));
            return;
          }
        } catch { /* JSON parse failed — pass through, let frontend handle */ }

        const payload = { raw, piUsed: !!piContext, piSource, ashpUsed: !!ashpData, pubmedCompatUsed: !!pubmedCompatData, tab };
        setCached(drug, tab, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── /drip — Drip Builder ──
  if (req.method === "POST" && req.url === "/drip") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      let query, confirmed;
      try { ({ query, confirmed } = JSON.parse(body)); } catch {
        res.writeHead(400); res.end(JSON.stringify({ error: "Invalid request body" })); return;
      }
      if (!query) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing query" })); return; }

      const drugName = extractDrugName(query);
      const drugNameLower = drugName.toLowerCase();
      console.log(`\n  [${new Date().toLocaleTimeString()}] Drip Builder: ${query} (drug name: "${drugName}")`);

      // ── ISMP High-Alert Gate ──────────────────────────────────────────────
      // Require explicit confirmation before building a drip for high-alert drugs.
      if (ISMP_HIGH_ALERT_DRUGS.has(drugNameLower) && !confirmed) {
        console.log(`  → ISMP high-alert: "${drugName}" — confirmation required`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          requiresConfirmation: true,
          ismpAlert: true,
          drug: drugName,
          message: `⚠ ISMP HIGH-ALERT MEDICATION: ${drugName} is on the ISMP high-alert medication list. ` +
            `These medications bear a heightened risk of causing significant patient harm when used in error. ` +
            `Verify the order, concentration, and rate with an independent double-check before proceeding. ` +
            `Confirm to generate the drip protocol.`,
        }));
        return;
      }

      // ── Concentration Ceiling Enforcement ────────────────────────────────
      // Block calculation if user-specified concentration exceeds safe maximum.
      const parsedConc = parseConcentrationFromQuery(query);
      const ceilViolation = checkConcentrationCeiling(drugNameLower, parsedConc);
      if (ceilViolation) {
        console.log(`  → Concentration ceiling exceeded for "${drugName}": ${ceilViolation.entered} > ${ceilViolation.maximum}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `Concentration exceeds safe maximum for ${ceilViolation.drug}.`,
          entered: ceilViolation.entered,
          maximum: ceilViolation.maximum,
          note: ceilViolation.note,
          concentrationCeilingExceeded: true,
        }));
        return;
      }

      let piContext = null;
      let piSource  = "none";

      // 1. Try vector search (pi_embeddings.db)
      if (searchPI) {
        try {
          console.log("  → Vector search (pi_embeddings.db)...");
          const hits = await searchPI(query, "drip", 4);
          if (hits.length) {
            piContext = formatAsContext(hits);
            piSource  = "vector";
            console.log(`  → Vector search: ${hits.length} chunks found`);
          } else {
            console.log("  → Vector search: no hits, falling back to DailyMed");
          }
        } catch (e) {
          console.warn("  ⚠ Vector search error:", e.message, "— falling back to DailyMed");
        }
      }

      // 2. Fallback: DailyMed live fetch
      if (!piContext) {
        console.log("  → Querying DailyMed (IV)...");
        const result = await queryDailyMedIV(drugName);
        if (result) {
          piContext = result.text;
          piSource  = "dailymed";
          console.log(`  → DailyMed IV: ${result.text.length} chars`);
        } else {
          console.log("  → DailyMed IV: no results");
        }
      }

      // Hard-block: never call Claude without a verified PI source
      if (!piContext) {
        console.log(`  → No PI source found for "${drugName}" — blocking request`);
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `No verified FDA package insert data found for "${drugName}". Cannot build a drip without a confirmed PI source.`,
          piSource: "none"
        }));
        return;
      }

      // 3. Always append PubMed for supplemental context
      console.log("  → Querying PubMed...");
      const pubmedData = await queryPubMed(drugName, "drip");
      console.log(pubmedData ? `  → PubMed: ${pubmedData.length} chars` : "  → PubMed: no results");

      // Enrich with pre-computed cache data if available
      let cacheContext = "";
      const dripCacheEntry = quickdripCache[drugName.toLowerCase()];
      if (dripCacheEntry && dripCacheEntry.dataComplete) {
        const reconLines = (dripCacheEntry.reconstitution || []).map(r => `${r.label}: ${r.value}`).join("\n");
        const dilLines = (dripCacheEntry.dilution || []).map(r => `${r.label}: ${r.value}`).join("\n");
        const adminLines = (dripCacheEntry.administration || []).map(r => `${r.label}: ${r.value}`).join("\n");
        cacheContext = `\n\nPRE-EXTRACTED STRUCTURED DATA (verified from PI):\n---\nReconstitution:\n${reconLines}\n\nDilution:\n${dilLines}\n\nAdministration:\n${adminLines}\n---`;
        console.log(`  → Cache context added (${cacheContext.length} chars)`);
      }

      const userMsg = [
        `Build IV drip for: ${query}`,
        `\n\nFDA PACKAGE INSERT TEXT:\n---\n${piContext}\n---`,
        cacheContext,
        pubmedData ? `\n\nPubMed abstracts:\n---\n${pubmedData}\n---` : "",
      ].join("");

      console.log(`  → Source tier used: ${piSource === "vector" ? "PI (vector DB)" : "PI (DailyMed live)"}`);
      if (pubmedData) console.log(`  → Source tier used: PubMed (${pubmedData.length} chars)`);

      try {
        console.log("  → Calling Anthropic (Drip Skill — Sonnet)...");
        const raw = await callAnthropic(DRIP_PROMPT, userMsg, 1500, "claude-sonnet-4-5");
        console.log("  → Done");

        // Parse response
        let parsed = null;
        try { parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || [])[0] || raw); } catch { /* pass through */ }

        if (parsed) {
          // Block "Not sourced" responses
          if (parsed.sourceUsed === "Not sourced") {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Could not build drip from provided PI text for "${drugName}". Verify drug name and try again.`, piSource }));
            return;
          }

          // Retrieval failure: drug is in our DB but core fields are null — retry once
          const CORE_FIELDS = ["diluent", "totalVolume", "finalConcentration", "infusionTime"];
          const isNullVal = v => !v || v === "null" || v.toLowerCase().includes("not documented");
          const coreNull = CORE_FIELDS.some(f => isNullVal(parsed[f] || ""));
          const drugInDb = Object.prototype.hasOwnProperty.call(drugsDatabase, drugName.toLowerCase());

          if (drugInDb && coreNull) {
            console.log(`  → Retrieval failure for "${drugName}" (core fields null) — retrying`);
            const retryMsg = userMsg + "\n\nATTENTION: Your previous response was missing values for one or more core fields (diluent, totalVolume, finalConcentration, infusionTime). Re-read the DOSAGE AND ADMINISTRATION section and extract these values explicitly. They are present in the PI text — look for volume, concentration, and infusion duration statements.";
            try {
              const retryRaw = await callAnthropic(DRIP_PROMPT, retryMsg);
              let retryParsed = null;
              try { retryParsed = JSON.parse((retryRaw.match(/\{[\s\S]*\}/) || [])[0] || retryRaw); } catch { /* pass through */ }
              const stillNull = !retryParsed || CORE_FIELDS.some(f => isNullVal(retryParsed[f] || ""));
              if (stillNull) {
                const failLine = `${new Date().toISOString()} | ${drugName} | query: ${query}\n`;
                fs.appendFileSync(path.join(__dirname, "failures.log"), failLine);
                console.log(`  → Retry failed — logged to failures.log`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ raw: retryRaw, openFDAUsed: !!piContext, pubmedUsed: !!pubmedData, piSource, retrieval_failure: true }));
                return;
              }
              console.log(`  → Retry succeeded`);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ raw: retryRaw, openFDAUsed: !!piContext, pubmedUsed: !!pubmedData, piSource }));
              return;
            } catch (retryErr) {
              console.warn("  ⚠ Retry error:", retryErr.message);
            }
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ raw, openFDAUsed: !!piContext, pubmedUsed: !!pubmedData, piSource }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── /feedback — User Feedback Loop ──
  if (req.method === "POST" && req.url === "/feedback") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { drug, field, issue, currentValue } = JSON.parse(body);
        if (!drug || !field || !issue) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required fields: drug, field, issue" })); return;
        }
        const entry = `${new Date().toISOString()} | drug="${drug}" | field="${field}" | issue="${issue}" | value="${(currentValue || "").slice(0, 200)}"\n`;
        fs.appendFileSync(path.join(__dirname, "feedback.log"), entry);
        console.log(`  → Feedback logged: ${entry.trim()}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n  QuickDrip server running at http://localhost:${PORT}\n`);
});