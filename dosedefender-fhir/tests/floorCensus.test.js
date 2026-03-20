/**
 * Floor 4W Sandbox — Census Tests
 * Verifies that computeFloorCensus() produces correct severity rankings,
 * AKI detection, drug flags, and ABW adjustment across 15 synthetic patients.
 */

const { computeFloorCensus, FLOOR_PATIENTS, getFloorPatient } = require('../js/floorSandbox');
const { calcCrCl } = require('../js/renalEngine');

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'contraindicated'];
function severityRank(s) { return SEVERITY_ORDER.indexOf(s ?? ''); }

// ── Basic census shape ────────────────────────────────────────────────────────

describe('computeFloorCensus — basic shape', () => {
  let census;
  beforeAll(() => { census = computeFloorCensus(); });

  test('returns exactly 15 patients', () => {
    expect(census).toHaveLength(15);
  });

  test('every patient has required fields', () => {
    for (const pt of census) {
      expect(pt).toHaveProperty('patientId');
      expect(pt).toHaveProperty('name');
      expect(pt).toHaveProperty('crcl');
      expect(pt).toHaveProperty('akiDetected');
      expect(pt).toHaveProperty('flags');
      expect(Array.isArray(pt.flags)).toBe(true);
    }
  });

  test('sorted highest severity first (contraindicated at top)', () => {
    const first = census[0];
    expect(first.severestFlag).toBe('contraindicated');
  });

  test('severity never increases down the list', () => {
    for (let i = 1; i < census.length; i++) {
      expect(severityRank(census[i].severestFlag))
        .toBeLessThanOrEqual(severityRank(census[i - 1].severestFlag));
    }
  });

  test('FL013 and FL014 appear last with no flags', () => {
    const noFlagIds = census.filter(p => p.severestFlag === null).map(p => p.patientId);
    expect(noFlagIds).toContain('FL013');
    expect(noFlagIds).toContain('FL014');
  });
});

// ── Contraindicated patients ──────────────────────────────────────────────────

describe('FL001 — Crane, Arthur (4 contraindicated flags)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL001'); });

  test('severest flag is contraindicated', () => {
    expect(pt.severestFlag).toBe('contraindicated');
  });

  test('has exactly 4 flags', () => {
    expect(pt.flagCount).toBe(4);
  });

  test('all 4 flags are contraindicated', () => {
    // Recompute with full flag objects for severity inspection
    const { checkMedicationList } = require('../js/drugRules');
    const { detectAKI } = require('../js/renalEngine');
    const raw = getFloorPatient('FL001');
    const { crcl } = calcCrCl({ age: raw.age, weightKg: raw.weightKg, heightCm: raw.heightCm, sex: raw.sex, scrMgDl: raw.scrTrend[0].value });
    const aki = detectAKI(raw.scrTrend);
    const flags = checkMedicationList(raw.medications, crcl, aki.akiDetected, aki.akiStage);
    const contraindicatedFlags = flags.filter(f => f.severity === 'contraindicated');
    expect(contraindicatedFlags).toHaveLength(4);
  });

  test('AKI Stage 3 detected', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(3);
  });

  test('trend is worsening', () => {
    expect(pt.trend).toBe('worsening');
  });

  test('CrCl ≤ 10 (needed for methotrexate/colchicine to be contraindicated)', () => {
    expect(pt.crcl).toBeLessThanOrEqual(10);
  });
});

describe('FL002 — Renata F (metformin contraindicated)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL002'); });

  test('severest flag is contraindicated', () => {
    expect(pt.severestFlag).toBe('contraindicated');
  });

  test('AKI Stage 2 worsening', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(2);
    expect(pt.trend).toBe('worsening');
  });

  test('CrCl ≈ 20 mL/min', () => {
    expect(pt.crcl).toBeGreaterThanOrEqual(18);
    expect(pt.crcl).toBeLessThanOrEqual(22);
  });
});

describe('FL003 — Okafor, Blessing (dabigatran contraindicated)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL003'); });

  test('severest flag is contraindicated', () => {
    expect(pt.severestFlag).toBe('contraindicated');
  });

  test('AKI Stage 3 improving (SCr 5.5 ≥ 4.0 → Stage 3 by KDIGO absolute criterion)', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(3);
    expect(pt.trend).toBe('improving');
  });

  test('CrCl ≤ 15 (dabigatran contraindicated threshold)', () => {
    expect(pt.crcl).toBeLessThanOrEqual(15);
  });
});

describe('FL015 — Brooks, Evelyn (3 contraindicated flags)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL015'); });

  test('severest flag is contraindicated', () => {
    expect(pt.severestFlag).toBe('contraindicated');
  });

  test('has at least 3 contraindicated flags', () => {
    const { checkMedicationList } = require('../js/drugRules');
    const { detectAKI } = require('../js/renalEngine');
    const raw = getFloorPatient('FL015');
    const { crcl } = calcCrCl({ age: raw.age, weightKg: raw.weightKg, heightCm: raw.heightCm, sex: raw.sex, scrMgDl: raw.scrTrend[0].value });
    const aki = detectAKI(raw.scrTrend);
    const flags = checkMedicationList(raw.medications, crcl, aki.akiDetected, aki.akiStage);
    const contraindicatedCount = flags.filter(f => f.severity === 'contraindicated').length;
    expect(contraindicatedCount).toBeGreaterThanOrEqual(3);
  });

  test('AKI Stage 3 stable', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(3);
    expect(pt.trend).toBe('stable');
  });
});

// ── High-severity patients ────────────────────────────────────────────────────

describe('FL004 — Petersen, Ingrid (enoxaparin high)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL004'); });

  test('severest flag is high', () => { expect(pt.severestFlag).toBe('high'); });
  test('AKI Stage 1 worsening', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(1);
    expect(pt.trend).toBe('worsening');
  });
});

describe('FL005 — Ramirez, Carlos (metformin high)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL005'); });

  test('severest flag is high', () => { expect(pt.severestFlag).toBe('high'); });
  test('no AKI', () => { expect(pt.akiDetected).toBe(false); });
});

describe('FL006 — Nguyen, Linh (spironolactone high)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL006'); });

  test('severest flag is high', () => { expect(pt.severestFlag).toBe('high'); });
  test('no AKI', () => { expect(pt.akiDetected).toBe(false); });
});

describe('FL011 — Kowalski, Jan (obese, ABW-adjusted CrCl)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL011'); });

  test('severest flag is high (enoxaparin)', () => {
    expect(pt.severestFlag).toBe('high');
  });

  test('AKI Stage 1 detected', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(1);
  });

  test('uses ABW — CrCl lower than naive TBW-based CG estimate', () => {
    const raw = getFloorPatient('FL011');
    const bmi = raw.weightKg / Math.pow(raw.heightCm / 100, 2);
    expect(bmi).toBeGreaterThan(30); // confirms ABW branch is triggered

    // Naive CrCl using TBW directly (bypasses ABW — manual formula)
    const scrUsed = Math.max(raw.scrTrend[0].value, 0.6);
    const naiveCrCl = Math.round(Math.min((140 - raw.age) * raw.weightKg / (72 * scrUsed), 120));
    // ABW-adjusted CrCl (what the engine computes) must be lower
    expect(pt.crcl).toBeLessThan(naiveCrCl);
  });

  test('CrCl is in enoxaparin high range (15–30)', () => {
    expect(pt.crcl).toBeGreaterThanOrEqual(15);
    expect(pt.crcl).toBeLessThanOrEqual(30);
  });
});

// ── Moderate patients ─────────────────────────────────────────────────────────

describe('FL007 — Johansson, Erik (piptazo moderate via AKI upgrade)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL007'); });

  test('severest flag is moderate', () => { expect(pt.severestFlag).toBe('moderate'); });
  test('AKI Stage 1 improving', () => {
    expect(pt.akiDetected).toBe(true);
    expect(pt.akiStage).toBe(1);
    expect(pt.trend).toBe('improving');
  });
  test('exactly 1 flag', () => { expect(pt.flagCount).toBe(1); });
});

describe('FL008 — Washington, Denise (cipro + gabapentin moderate)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL008'); });

  test('severest flag is moderate', () => { expect(pt.severestFlag).toBe('moderate'); });
  test('no AKI', () => { expect(pt.akiDetected).toBe(false); });
  test('has 2 flags', () => { expect(pt.flagCount).toBe(2); });
});

// ── No-flag patients ──────────────────────────────────────────────────────────

describe('FL013 — Murphy, Patrick (no flags)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL013'); });

  test('0 flags', () => { expect(pt.flagCount).toBe(0); });
  test('severestFlag is null', () => { expect(pt.severestFlag).toBeNull(); });
  test('no AKI', () => { expect(pt.akiDetected).toBe(false); });
  test('high CrCl (capped at 120)', () => { expect(pt.crcl).toBeGreaterThanOrEqual(100); });
});

describe('FL014 — Sharma, Priya (no flags)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL014'); });

  test('0 flags', () => { expect(pt.flagCount).toBe(0); });
  test('severestFlag is null', () => { expect(pt.severestFlag).toBeNull(); });
});

// ── Low-severity patient ──────────────────────────────────────────────────────

describe('FL012 — Torres, Isabel (meropenem low)', () => {
  let pt;
  beforeAll(() => { [pt] = computeFloorCensus().filter(p => p.patientId === 'FL012'); });

  test('severest flag is low', () => { expect(pt.severestFlag).toBe('low'); });
  test('no AKI', () => { expect(pt.akiDetected).toBe(false); });
});

// ── AKI patient count ─────────────────────────────────────────────────────────

describe('AKI population', () => {
  let census;
  beforeAll(() => { census = computeFloorCensus(); });

  test('7 out of 15 patients have AKI', () => {
    // FL001, FL002, FL003, FL004, FL007, FL011 (staged AKI) + FL015 (SCr 5.1 ≥ 4.0)
    const akiCount = census.filter(p => p.akiDetected).length;
    expect(akiCount).toBe(7);
  });

  test('AKI patients include FL001, FL002, FL003, FL004, FL007, FL011, FL015', () => {
    const akiIds = census.filter(p => p.akiDetected).map(p => p.patientId);
    ['FL001', 'FL002', 'FL003', 'FL004', 'FL007', 'FL011', 'FL015'].forEach(id => {
      expect(akiIds).toContain(id);
    });
  });

  test('non-AKI patients include FL005, FL006, FL012, FL013, FL014', () => {
    const nonAkiIds = census.filter(p => !p.akiDetected).map(p => p.patientId);
    ['FL005', 'FL006', 'FL012', 'FL013', 'FL014'].forEach(id => {
      expect(nonAkiIds).toContain(id);
    });
  });
});

// ── getFloorPatient helper ────────────────────────────────────────────────────

describe('getFloorPatient', () => {
  test('returns correct patient by ID', () => {
    const pt = getFloorPatient('FL001');
    expect(pt).not.toBeNull();
    expect(pt.name).toBe('Crane, Arthur');
    expect(pt.age).toBe(82);
  });

  test('returns null for unknown ID', () => {
    expect(getFloorPatient('FL999')).toBeNull();
  });

  test('FLOOR_PATIENTS has 15 entries', () => {
    expect(FLOOR_PATIENTS).toHaveLength(15);
  });
});
