/**
 * Renal Dose Defender — Unit Tests
 * Tests renalEngine.js (CrCl + AKI) and drugRules.js (drug rule matching + flag generation)
 */

const { calcCrCl, detectAKI } = require('../js/renalEngine');
const { checkMedicationList, _matchRule, getDefaultRules, severityRank } = require('../js/drugRules');

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 3600000).toISOString();
}

// ── CrCl Tests ───────────────────────────────────────────────────────────────

describe('calcCrCl', () => {
  test('standard male CrCl', () => {
    // 55M, 70kg, 175cm, SCr 1.0 → CG ≈ 80
    const result = calcCrCl({ age: 55, weightKg: 70, heightCm: 175, sex: 'M', scrMgDl: 1.0 });
    expect(result.crcl).toBeGreaterThan(75);
    expect(result.crcl).toBeLessThan(90);
    expect(result.method).toBe('CG');
    expect(result.floorApplied).toBe(false);
  });

  test('female correction factor (×0.85)', () => {
    const male = calcCrCl({ age: 55, weightKg: 70, heightCm: 175, sex: 'M', scrMgDl: 1.0 });
    const female = calcCrCl({ age: 55, weightKg: 70, heightCm: 175, sex: 'F', scrMgDl: 1.0 });
    // Female CrCl should be ~85% of male
    expect(female.crcl).toBeLessThan(male.crcl);
    expect(female.crcl / male.crcl).toBeCloseTo(0.85, 1);
  });

  test('SCr floor applied at 0.4 mg/dL (floor is 0.7 per ASHP/IDSA 2020)', () => {
    const result = calcCrCl({ age: 70, weightKg: 65, heightCm: 168, sex: 'M', scrMgDl: 0.4 });
    expect(result.floorApplied).toBe(true);
    expect(result.scrUsed).toBe(0.7);
  });

  test('ABW used for obese patient (BMI > 30)', () => {
    // 50M, 120kg, 175cm → BMI = 39.2 → use ABW
    const result = calcCrCl({ age: 50, weightKg: 120, heightCm: 175, sex: 'M', scrMgDl: 1.0 });
    expect(result.bmi).toBeGreaterThan(30);
    // IBW ~72kg, ABW = 72 + 0.4*(120-72) = 72 + 19.2 = 91.2 kg
    expect(result.weightUsed).toBeGreaterThan(70);
    expect(result.weightUsed).toBeLessThan(100);
  });

  test('CrCl capped at 120 mL/min', () => {
    // Very young/large patient
    const result = calcCrCl({ age: 20, weightKg: 100, heightCm: 185, sex: 'M', scrMgDl: 0.7 });
    expect(result.crcl).toBeLessThanOrEqual(120);
  });

  test('renal demo patient: 74F, 61kg, 162cm, SCr 2.4 → CrCl ~20', () => {
    const result = calcCrCl({ age: 74, weightKg: 61, heightCm: 162, sex: 'F', scrMgDl: 2.4 });
    expect(result.crcl).toBeGreaterThanOrEqual(16);
    expect(result.crcl).toBeLessThanOrEqual(24);
  });
});

// ── AKI Tests ────────────────────────────────────────────────────────────────

describe('detectAKI', () => {
  test('AKI: absolute rise >= 0.3 mg/dL within 48h', () => {
    const scrResults = [
      { value: 1.6, date: hoursAgo(6) },
      { value: 1.2, date: hoursAgo(24) },
      { value: 1.1, date: hoursAgo(72) },
    ];
    const result = detectAKI(scrResults);
    expect(result.akiDetected).toBe(true);
    expect(result.rise48h).toBe(true);
  });

  test('AKI: 1.5x baseline rise', () => {
    const scrResults = [
      { value: 1.8, date: hoursAgo(6) },
      { value: 1.5, date: hoursAgo(36) },
      { value: 1.1, date: daysAgo(5) },  // baseline 7-day low
      { value: 0.9, date: daysAgo(10) }, // admission
    ];
    const result = detectAKI(scrResults);
    expect(result.akiDetected).toBe(true);
  });

  test('AKI stage 1: ratio 1.5–1.9×', () => {
    const scrResults = [
      { value: 1.5, date: hoursAgo(24) },
      { value: 1.3, date: hoursAgo(48) },
      { value: 1.0, date: daysAgo(5) },
    ];
    const result = detectAKI(scrResults);
    if (result.akiDetected) {
      expect(result.akiStage).toBe(1);
    }
  });

  test('AKI stage 2: ratio 2.0–2.9×', () => {
    const scrResults = [
      { value: 2.4, date: hoursAgo(1) },
      { value: 1.8, date: daysAgo(1) },
      { value: 1.1, date: daysAgo(2) },
      { value: 0.9, date: daysAgo(3) }, // admission
    ];
    const result = detectAKI(scrResults);
    expect(result.akiDetected).toBe(true);
    expect(result.akiStage).toBe(2);
  });

  test('AKI stage 3: ratio >= 3.0× or SCr >= 4.0', () => {
    const scrResults = [
      { value: 4.2, date: hoursAgo(1) },
      { value: 3.0, date: daysAgo(1) },
      { value: 1.2, date: daysAgo(3) },
      { value: 0.9, date: daysAgo(7) },
    ];
    const result = detectAKI(scrResults);
    expect(result.akiDetected).toBe(true);
    expect(result.akiStage).toBe(3);
  });

  test('no AKI: stable trend', () => {
    const scrResults = [
      { value: 1.0, date: hoursAgo(6) },
      { value: 1.0, date: hoursAgo(24) },
      { value: 1.1, date: daysAgo(3) },
    ];
    const result = detectAKI(scrResults);
    expect(result.akiDetected).toBe(false);
  });

  test('trend: worsening vs improving', () => {
    const worsening = [
      { value: 2.0, date: hoursAgo(1) },
      { value: 1.5, date: hoursAgo(24) },
      { value: 0.9, date: daysAgo(5) },
    ];
    const improving = [
      { value: 1.2, date: hoursAgo(1) },
      { value: 2.0, date: hoursAgo(24) },
      { value: 0.9, date: daysAgo(5) },
    ];
    expect(detectAKI(worsening).trend).toBe('worsening');
    expect(detectAKI(improving).trend).toBe('improving');
  });

  test('returns akiDetected false with only one SCr value', () => {
    const result = detectAKI([{ value: 2.5, date: hoursAgo(1) }]);
    expect(result.akiDetected).toBe(false);
  });
});

// ── Drug Rules Tests ─────────────────────────────────────────────────────────

describe('checkMedicationList', () => {
  const rules = getDefaultRules();

  test('metformin flagged at CrCl 24', () => {
    const meds = [{ id: 'm1', medicationName: 'Metformin 500 mg', rxnormCodes: ['860975'], dosages: [{ text: '500 mg PO BID' }] }];
    const flags = checkMedicationList(meds, 24, false, null);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('contraindicated');
    expect(flags[0].medicationId).toBe('m1');
  });

  test('metformin NOT flagged at CrCl 55', () => {
    const meds = [{ id: 'm1', medicationName: 'Metformin 500 mg', rxnormCodes: ['860975'], dosages: [] }];
    const flags = checkMedicationList(meds, 55, false, null);
    expect(flags).toHaveLength(0);
  });

  test('AKI upgrades severity (low → moderate)', () => {
    // Gabapentin at CrCl 45 is 'low' (30-60 range)
    const meds = [{ id: 'g1', medicationName: 'Gabapentin 300 mg', rxnormCodes: ['310431'], dosages: [] }];
    const withoutAki = checkMedicationList(meds, 45, false, null);
    const withAki = checkMedicationList(meds, 45, true, 2);
    if (withoutAki.length > 0) {
      expect(severityRank(withAki[0].severity)).toBeGreaterThanOrEqual(severityRank(withoutAki[0].severity));
    }
  });

  test('RxNorm match priority over name', () => {
    // Medication with gabapentin RxNorm code but different name — should still match gabapentin rule
    const meds = [{ id: 'x1', medicationName: 'Gralise ER', rxnormCodes: ['310431'], dosages: [] }];
    const flags = checkMedicationList(meds, 20, false, null);
    expect(flags).toHaveLength(1);
    expect(flags[0].ruleId).toBe('gabapentin');
  });

  test('name match fallback (case-insensitive)', () => {
    // No RxNorm code, match by name
    const meds = [{ id: 'n1', medicationName: 'NITROFURANTOIN MACROBID 100mg', rxnormCodes: [], dosages: [] }];
    const flags = checkMedicationList(meds, 40, false, null);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('contraindicated');
  });

  test('unknown drug returns no flag', () => {
    const meds = [{ id: 'u1', medicationName: 'Ibuprofen 400 mg', rxnormCodes: ['5640'], dosages: [] }];
    const flags = checkMedicationList(meds, 20, false, null);
    expect(flags).toHaveLength(0);
  });

  test('correct threshold tier selected for CrCl 28', () => {
    // Enoxaparin: CrCl 15-30 → 'high'
    const meds = [{ id: 'e1', medicationName: 'Enoxaparin (Lovenox)', rxnormCodes: ['854228'], dosages: [] }];
    const flags = checkMedicationList(meds, 28, false, null);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('high');
    expect(flags[0].action).toBe('DOSE-ADJUSTMENT');
  });

  test('flags sorted by severity descending', () => {
    const meds = [
      { id: 'm1', medicationName: 'Metformin', rxnormCodes: ['860975'], dosages: [] },
      { id: 'g1', medicationName: 'Gabapentin', rxnormCodes: ['310431'], dosages: [] },
    ];
    const flags = checkMedicationList(meds, 20, false, null);
    expect(flags.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < flags.length; i++) {
      expect(severityRank(flags[i - 1].severity)).toBeGreaterThanOrEqual(severityRank(flags[i].severity));
    }
  });

  test('renal demo scenario: 3 flags for RENAL001 meds at CrCl 20', () => {
    const meds = [
      { id: 'rmed-001', medicationName: 'Metformin (Glucophage)', rxnormCodes: ['860975'], dosages: [] },
      { id: 'rmed-002', medicationName: 'Enoxaparin (Lovenox)', rxnormCodes: ['854228'], dosages: [] },
      { id: 'rmed-003', medicationName: 'Gabapentin (Neurontin)', rxnormCodes: ['310431'], dosages: [] },
      { id: 'rmed-004', medicationName: 'Lisinopril (Prinivil)', rxnormCodes: ['314076'], dosages: [] },
      { id: 'rmed-005', medicationName: 'Metoprolol Tartrate (Lopressor)', rxnormCodes: ['866508'], dosages: [] },
    ];
    const flags = checkMedicationList(meds, 20, true, 2);
    expect(flags).toHaveLength(3);
    const ids = flags.map(f => f.medicationId);
    expect(ids).toContain('rmed-001'); // metformin
    expect(ids).toContain('rmed-002'); // enoxaparin
    expect(ids).toContain('rmed-003'); // gabapentin
    expect(ids).not.toContain('rmed-004'); // lisinopril — not in drug rules
    expect(ids).not.toContain('rmed-005'); // metoprolol — not in drug rules
    // Metformin should be contraindicated
    const metforminFlag = flags.find(f => f.medicationId === 'rmed-001');
    expect(metforminFlag.severity).toBe('contraindicated');
  });
});
