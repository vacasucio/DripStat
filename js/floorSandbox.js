/**
 * floorSandbox.js — Synthetic ward Floor 4W for end-to-end sandbox testing
 * Server-side only (Node/Jest). NOT served to browser.
 *
 * 15 patients covering every severity tier, AKI stage, and major drug category.
 * computeFloorCensus() runs the real renalEngine + drugRules — no pre-computed data.
 */

const RenalEngine = require('./renalEngine');
const DrugRules   = require('./drugRules');

// ── Helpers ──────────────────────────────────────────────────────────────────

function d(dateStr) { return dateStr; } // identity — dates are ISO date strings

// ── 15 Synthetic Patients (Floor 4 West — General Medicine) ─────────────────
//
// scrTrend: newest reading first  { value: mg/dL, date: ISO date string }
// medications: matched by genericName substring (see drugRules.js matchRule)
//
// Verified CrCl & expected flags:
//  FL001 82M 60kg 170cm SCr4.9 → CrCl 10 → metformin/methotrexate/colchicine/nitrofurantoin: 4×contraindicated
//  FL002 74F 61kg 162cm SCr2.4 → CrCl 20 → metformin: contraindicated, enoxaparin: high, gabapentin: moderate
//  FL003 68M 82kg 178cm SCr5.5 → CrCl 15 → dabigatran: contraindicated, spironolactone: high
//  FL004 71F 64kg 163cm SCr1.9 → CrCl 27, AKI1 → enoxaparin: high, vancomycin: moderate
//  FL005 65M 88kg 175cm SCr2.3 → CrCl 40 → metformin: high
//  FL006 78F 52kg 155cm SCr2.2 → CrCl 17 → spironolactone: high; pregabalin/digoxin/acyclovir: moderate
//  FL007 59M 79kg 180cm SCr2.9 → CrCl 31, AKI1 improving → piptazo: low→moderate (AKI upgrade)
//  FL008 54F 71kg 165cm SCr2.5 → CrCl 29 → ciprofloxacin/gabapentin: moderate
//  FL009 80M 65kg 172cm SCr1.4 → CrCl 39 → vancomycin: moderate
//  FL010 80F 58kg 160cm SCr1.0 → CrCl 41 → spironolactone: moderate
//  FL011 55M 100kg 180cm SCr3.5 → CrCl 29 (ABW), AKI1 → enoxaparin: high
//  FL012 67F 70kg 162cm SCr1.5 → CrCl 40 → meropenem: low
//  FL013 42M 80kg 177cm SCr0.9 → CrCl 120 → no renal-sensitive drugs: 0 flags
//  FL014 35F 65kg 168cm SCr0.8 → CrCl 101 → no renal-sensitive drugs: 0 flags
//  FL015 72F 55kg 157cm SCr5.1 → CrCl 9, AKI3 stable → metformin/nitrofurantoin/colchicine: 3×contraindicated

const FLOOR_PATIENTS = [
  // ── FL001: Crane, Arthur — Stage 3 AKI worsening, 4 contraindicated ─────
  {
    id: 'FL001',
    name: 'Crane, Arthur',
    age: 82,
    sex: 'M',
    weightKg: 60,
    heightCm: 170,
    scrTrend: [
      { value: 4.9, date: d('2026-03-18') },
      { value: 3.2, date: d('2026-03-17') },
      { value: 2.1, date: d('2026-03-16') },
      { value: 1.2, date: d('2026-03-15') },
      { value: 0.9, date: d('2026-03-14') },
    ],
    medications: [
      { id: 'FL001-M1', medicationName: 'Metformin 500mg BID', rxnormCodes: [], dosages: [{ text: '500 mg PO BID' }] },
      { id: 'FL001-M2', medicationName: 'Methotrexate 7.5mg weekly', rxnormCodes: [], dosages: [{ text: '7.5 mg PO weekly' }] },
      { id: 'FL001-M3', medicationName: 'Colchicine 0.6mg BID', rxnormCodes: [], dosages: [{ text: '0.6 mg PO BID' }] },
      { id: 'FL001-M4', medicationName: 'Nitrofurantoin 100mg BID', rxnormCodes: [], dosages: [{ text: '100 mg PO BID' }] },
    ],
  },

  // ── FL002: TEST, Renata F — Stage 2 AKI worsening, metformin contraindicated ─
  {
    id: 'FL002',
    name: 'TEST, Renata F',
    age: 74,
    sex: 'F',
    weightKg: 61,
    heightCm: 162,
    scrTrend: [
      { value: 2.4, date: d('2026-03-18') },
      { value: 1.8, date: d('2026-03-16') },
      { value: 1.1, date: d('2026-03-14') },
      { value: 0.9, date: d('2026-03-12') },
    ],
    medications: [
      { id: 'FL002-M1', medicationName: 'Metformin 1000mg BID', rxnormCodes: [], dosages: [{ text: '1000 mg PO BID' }] },
      { id: 'FL002-M2', medicationName: 'Enoxaparin 60mg BID', rxnormCodes: [], dosages: [{ text: '60 mg SC BID' }] },
      { id: 'FL002-M3', medicationName: 'Gabapentin 300mg TID', rxnormCodes: [], dosages: [{ text: '300 mg PO TID' }] },
    ],
  },

  // ── FL003: Okafor, Blessing — Stage 2 AKI improving, dabigatran contraindicated ─
  {
    id: 'FL003',
    name: 'Okafor, Blessing',
    age: 68,
    sex: 'M',
    weightKg: 82,
    heightCm: 178,
    scrTrend: [
      { value: 5.5, date: d('2026-03-18') },
      { value: 6.5, date: d('2026-03-16') },
      { value: 4.0, date: d('2026-03-14') },
      { value: 2.0, date: d('2026-03-12') },
    ],
    medications: [
      { id: 'FL003-M1', medicationName: 'Dabigatran 150mg BID', rxnormCodes: [], dosages: [{ text: '150 mg PO BID' }] },
      { id: 'FL003-M2', medicationName: 'Spironolactone 25mg daily', rxnormCodes: [], dosages: [{ text: '25 mg PO daily' }] },
    ],
  },

  // ── FL004: Petersen, Ingrid — Stage 1 AKI worsening, enoxaparin high ──────
  {
    id: 'FL004',
    name: 'Petersen, Ingrid',
    age: 71,
    sex: 'F',
    weightKg: 64,
    heightCm: 163,
    scrTrend: [
      { value: 1.9, date: d('2026-03-18') },
      { value: 1.4, date: d('2026-03-17') },
      { value: 1.1, date: d('2026-03-16') },
    ],
    medications: [
      { id: 'FL004-M1', medicationName: 'Enoxaparin 80mg BID', rxnormCodes: [], dosages: [{ text: '80 mg SC BID' }] },
      { id: 'FL004-M2', medicationName: 'Vancomycin 1250mg q12h', rxnormCodes: [], dosages: [{ text: '1250 mg IV q12h' }] },
    ],
  },

  // ── FL005: Ramirez, Carlos — no AKI, metformin high ──────────────────────
  {
    id: 'FL005',
    name: 'Ramirez, Carlos',
    age: 65,
    sex: 'M',
    weightKg: 88,
    heightCm: 175,
    scrTrend: [
      { value: 2.3, date: d('2026-03-18') },
      { value: 2.2, date: d('2026-03-16') },
    ],
    medications: [
      { id: 'FL005-M1', medicationName: 'Metformin 500mg BID', rxnormCodes: [], dosages: [{ text: '500 mg PO BID' }] },
      { id: 'FL005-M2', medicationName: 'Tramadol 50mg q6h PRN', rxnormCodes: [], dosages: [{ text: '50 mg PO q6h PRN' }] },
    ],
  },

  // ── FL006: Nguyen, Linh — no AKI, spironolactone high ───────────────────
  {
    id: 'FL006',
    name: 'Nguyen, Linh',
    age: 78,
    sex: 'F',
    weightKg: 52,
    heightCm: 155,
    scrTrend: [
      { value: 2.2, date: d('2026-03-18') },
      { value: 2.1, date: d('2026-03-17') },
    ],
    medications: [
      { id: 'FL006-M1', medicationName: 'Pregabalin 75mg BID', rxnormCodes: [], dosages: [{ text: '75 mg PO BID' }] },
      { id: 'FL006-M2', medicationName: 'Digoxin 0.125mg daily', rxnormCodes: [], dosages: [{ text: '0.125 mg PO daily' }] },
      { id: 'FL006-M3', medicationName: 'Acyclovir 400mg TID', rxnormCodes: [], dosages: [{ text: '400 mg PO TID' }] },
      { id: 'FL006-M4', medicationName: 'Spironolactone 25mg daily', rxnormCodes: [], dosages: [{ text: '25 mg PO daily' }] },
    ],
  },

  // ── FL007: Johansson, Erik — Stage 1 AKI improving, piptazo moderate ─────
  //    piptazo is LOW at CrCl 31, AKI upgrades it to moderate
  {
    id: 'FL007',
    name: 'Johansson, Erik',
    age: 59,
    sex: 'M',
    weightKg: 79,
    heightCm: 180,
    scrTrend: [
      { value: 2.9, date: d('2026-03-18') },
      { value: 3.5, date: d('2026-03-16') },
      { value: 2.5, date: d('2026-03-14') },
      { value: 1.9, date: d('2026-03-13') },
    ],
    medications: [
      { id: 'FL007-M1', medicationName: 'Piperacillin-Tazobactam 3.375g q8h', rxnormCodes: [], dosages: [{ text: '3.375 g IV q8h' }] },
    ],
  },

  // ── FL008: Washington, Denise — no AKI, ciprofloxacin + gabapentin moderate ─
  {
    id: 'FL008',
    name: 'Washington, Denise',
    age: 54,
    sex: 'F',
    weightKg: 71,
    heightCm: 165,
    scrTrend: [
      { value: 2.5, date: d('2026-03-18') },
      { value: 2.4, date: d('2026-03-16') },
    ],
    medications: [
      { id: 'FL008-M1', medicationName: 'Ciprofloxacin 500mg BID', rxnormCodes: [], dosages: [{ text: '500 mg PO BID' }] },
      { id: 'FL008-M2', medicationName: 'Gabapentin 300mg TID', rxnormCodes: [], dosages: [{ text: '300 mg PO TID' }] },
    ],
  },

  // ── FL009: Patel, Suresh — no AKI, vancomycin moderate ──────────────────
  {
    id: 'FL009',
    name: 'Patel, Suresh',
    age: 80,
    sex: 'M',
    weightKg: 65,
    heightCm: 172,
    scrTrend: [
      { value: 1.4, date: d('2026-03-18') },
      { value: 1.3, date: d('2026-03-17') },
    ],
    medications: [
      { id: 'FL009-M1', medicationName: 'Vancomycin 1000mg q12h', rxnormCodes: [], dosages: [{ text: '1000 mg IV q12h' }] },
      { id: 'FL009-M2', medicationName: 'Metoprolol 25mg BID', rxnormCodes: [], dosages: [{ text: '25 mg PO BID' }] },
    ],
  },

  // ── FL010: Chen, Margaret — no AKI, spironolactone moderate ─────────────
  {
    id: 'FL010',
    name: 'Chen, Margaret',
    age: 80,
    sex: 'F',
    weightKg: 58,
    heightCm: 160,
    scrTrend: [
      { value: 1.0, date: d('2026-03-18') },
      { value: 1.1, date: d('2026-03-17') },
    ],
    medications: [
      { id: 'FL010-M1', medicationName: 'Gabapentin 300mg BID', rxnormCodes: [], dosages: [{ text: '300 mg PO BID' }] },
      { id: 'FL010-M2', medicationName: 'Spironolactone 25mg daily', rxnormCodes: [], dosages: [{ text: '25 mg PO daily' }] },
    ],
  },

  // ── FL011: Kowalski, Jan — Stage 1 AKI, obese (BMI 30.9), enoxaparin high ─
  //    ABW = 75 + 0.4*(100-75) = 85 kg → CrCl 29
  {
    id: 'FL011',
    name: 'Kowalski, Jan',
    age: 55,
    sex: 'M',
    weightKg: 100,
    heightCm: 180,
    scrTrend: [
      { value: 3.5, date: d('2026-03-18') },
      { value: 2.8, date: d('2026-03-17') },
      { value: 2.0, date: d('2026-03-16') },
    ],
    medications: [
      { id: 'FL011-M1', medicationName: 'Enoxaparin 100mg BID', rxnormCodes: [], dosages: [{ text: '100 mg SC BID (1 mg/kg)' }] },
    ],
  },

  // ── FL012: Torres, Isabel — no AKI, meropenem low ───────────────────────
  {
    id: 'FL012',
    name: 'Torres, Isabel',
    age: 67,
    sex: 'F',
    weightKg: 70,
    heightCm: 162,
    scrTrend: [
      { value: 1.5, date: d('2026-03-18') },
      { value: 1.5, date: d('2026-03-17') },
    ],
    medications: [
      { id: 'FL012-M1', medicationName: 'Meropenem 1g q8h', rxnormCodes: [], dosages: [{ text: '1 g IV q8h' }] },
    ],
  },

  // ── FL013: Murphy, Patrick — normal renal function, no flags ────────────
  {
    id: 'FL013',
    name: 'Murphy, Patrick',
    age: 42,
    sex: 'M',
    weightKg: 80,
    heightCm: 177,
    scrTrend: [
      { value: 0.9, date: d('2026-03-18') },
    ],
    medications: [
      { id: 'FL013-M1', medicationName: 'Acetaminophen 500mg q6h', rxnormCodes: [], dosages: [{ text: '500 mg PO q6h' }] },
      { id: 'FL013-M2', medicationName: 'Lisinopril 10mg daily', rxnormCodes: [], dosages: [{ text: '10 mg PO daily' }] },
    ],
  },

  // ── FL014: Sharma, Priya — normal renal function, no flags ─────────────
  {
    id: 'FL014',
    name: 'Sharma, Priya',
    age: 35,
    sex: 'F',
    weightKg: 65,
    heightCm: 168,
    scrTrend: [
      { value: 0.8, date: d('2026-03-18') },
    ],
    medications: [
      { id: 'FL014-M1', medicationName: 'Metoprolol 50mg BID', rxnormCodes: [], dosages: [{ text: '50 mg PO BID' }] },
      { id: 'FL014-M2', medicationName: 'Omeprazole 20mg daily', rxnormCodes: [], dosages: [{ text: '20 mg PO daily' }] },
    ],
  },

  // ── FL015: Brooks, Evelyn — Stage 3 AKI stable, 3 contraindicated ───────
  {
    id: 'FL015',
    name: 'Brooks, Evelyn',
    age: 72,
    sex: 'F',
    weightKg: 55,
    heightCm: 157,
    scrTrend: [
      { value: 5.1, date: d('2026-03-18') },
      { value: 5.1, date: d('2026-03-17') },
      { value: 3.0, date: d('2026-03-14') },
      { value: 1.0, date: d('2026-03-10') },
    ],
    medications: [
      { id: 'FL015-M1', medicationName: 'Metformin 500mg BID', rxnormCodes: [], dosages: [{ text: '500 mg PO BID' }] },
      { id: 'FL015-M2', medicationName: 'Nitrofurantoin 100mg BID', rxnormCodes: [], dosages: [{ text: '100 mg PO BID' }] },
      { id: 'FL015-M3', medicationName: 'Colchicine 0.6mg BID', rxnormCodes: [], dosages: [{ text: '0.6 mg PO BID' }] },
      { id: 'FL015-M4', medicationName: 'Spironolactone 25mg daily', rxnormCodes: [], dosages: [{ text: '25 mg PO daily' }] },
      { id: 'FL015-M5', medicationName: 'Digoxin 0.125mg daily', rxnormCodes: [], dosages: [{ text: '0.125 mg PO daily' }] },
    ],
  },
];

// ── Census computation ────────────────────────────────────────────────────────

function computeFloorCensus() {
  const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'contraindicated'];

  return FLOOR_PATIENTS.map(pt => {
    const { crcl } = RenalEngine.calcCrCl({
      age: pt.age,
      weightKg: pt.weightKg,
      heightCm: pt.heightCm,
      sex: pt.sex,
      scrMgDl: pt.scrTrend[0].value,
    });

    const aki = pt.scrTrend.length >= 2
      ? RenalEngine.detectAKI(pt.scrTrend)
      : { akiDetected: false, trend: 'stable' };

    const flags = DrugRules.checkMedicationList(
      pt.medications,
      crcl,
      aki.akiDetected,
      aki.akiStage,
    );

    return {
      patientId: pt.id,
      name: pt.name,
      age: pt.age,
      sex: pt.sex,
      crcl,
      currentScr: pt.scrTrend[0].value,
      akiDetected: aki.akiDetected,
      akiStage: aki.akiStage || null,
      trend: aki.trend || 'stable',
      baselineScr: aki.baselineScr || pt.scrTrend[pt.scrTrend.length - 1].value,
      flagCount: flags.length,
      severestFlag: flags[0]?.severity || null,
      flags: flags.map(f => `${f.medicationName} — ${f.action}`),
    };
  }).sort((a, b) => {
    const rank = s => SEVERITY_ORDER.indexOf(s);
    return rank(b.severestFlag) - rank(a.severestFlag);
  });
}

function getFloorPatient(id) {
  return FLOOR_PATIENTS.find(p => p.id === id) || null;
}

module.exports = { FLOOR_PATIENTS, computeFloorCensus, getFloorPatient };
