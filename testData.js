/**
 * Mock test patient for local development and UI testing.
 * Patient ID: TEST001
 *
 * Scenario: 68-year-old male on IV heparin for DVT/VTE.
 * PTT is sub-therapeutic (42 sec) — calculator should recommend bolus + rate increase.
 */

const TEST_PATIENT_ID = 'TEST001';

const patient = {
  patientId: TEST_PATIENT_ID,
  name: 'TEST, John H',
  gender: 'male',
  dateOfBirth: '1957-03-22',
  age: 68,
  weight: { value: 84, unit: 'kg', date: new Date().toISOString() },
  height: { value: 178, unit: 'cm', date: new Date().toISOString() },
  _isMock: true,
};

const now = new Date();
const daysAgo = (n) => new Date(now - n * 86400000).toISOString();

const labs = {
  patientId: TEST_PATIENT_ID,
  serumCreatinine: {
    id: 'mock-scr-001',
    date: daysAgo(1),
    status: 'final',
    value: 1.1,
    unit: 'mg/dL',
    interpretation: null,
    referenceRange: { low: 0.7, high: 1.3, unit: 'mg/dL' },
  },
  ptt: {
    id: 'mock-ptt-001',
    date: daysAgo(0),
    status: 'final',
    value: 42,
    unit: 'sec',
    interpretation: 'L',
    referenceRange: { low: 60, high: 90, unit: 'sec' },
  },
  vancomycinTroughs: [],
  bun: {
    id: 'mock-bun-001',
    date: daysAgo(1),
    status: 'final',
    value: 22,
    unit: 'mg/dL',
    interpretation: null,
    referenceRange: { low: 7, high: 25, unit: 'mg/dL' },
  },
  _isMock: true,
};

const vitals = {
  patientId: TEST_PATIENT_ID,
  weightTrend: [
    { id: 'mock-wt-001', date: daysAgo(0), status: 'final', value: 84, unit: 'kg', components: null },
    { id: 'mock-wt-002', date: daysAgo(3), status: 'final', value: 83, unit: 'kg', components: null },
    { id: 'mock-wt-003', date: daysAgo(7), status: 'final', value: 85, unit: 'kg', components: null },
  ],
  stats: { latest: 84, min: 83, max: 85, avg: 84.0, unit: 'kg', count: 3 },
  _isMock: true,
};

const medications = {
  patientId: TEST_PATIENT_ID,
  total: 3,
  status: 'active',
  _isMock: true,
  medications: [
    {
      id: 'mock-med-001',
      status: 'active',
      intent: 'order',
      medicationName: 'Heparin 25,000 units / 500 mL (50 units/mL)',
      authoredOn: daysAgo(0),
      requester: 'TEST, Attending MD',
      dosages: [{
        text: '1,512 units/hr IV infusion (30.2 mL/hr) — DVT/VTE protocol',
        route: 'IV',
        doseQuantity: { value: 1512, unit: 'units/hr' },
        frequency: { frequency: 1, period: 1, periodUnit: 'h', display: 'continuous' },
        timing: 'continuous infusion',
      }],
      note: ['DVT/VTE protocol — initial dose. PTT in 6 hours.'],
    },
    {
      id: 'mock-med-002',
      status: 'active',
      intent: 'order',
      medicationName: 'Enoxaparin (Lovenox)',
      authoredOn: daysAgo(14),
      requester: 'TEST, Attending MD',
      dosages: [{
        text: '40 mg subcutaneous daily — DVT prophylaxis (bridging)',
        route: 'Subcutaneous',
        doseQuantity: { value: 40, unit: 'mg' },
        frequency: { frequency: 1, period: 1, periodUnit: 'd', display: '1 per 1 d' },
        timing: 'daily',
      }],
      note: [],
    },
    {
      id: 'mock-med-003',
      status: 'active',
      intent: 'order',
      medicationName: 'Acetaminophen (Tylenol)',
      authoredOn: daysAgo(2),
      requester: 'TEST, Attending MD',
      dosages: [{
        text: '650 mg PO every 6 hr PRN pain',
        route: 'Oral',
        doseQuantity: { value: 650, unit: 'mg' },
        frequency: { frequency: 1, period: 6, periodUnit: 'h', display: '1 per 6 h' },
        timing: 'every 6 hr PRN',
      }],
      note: [],
    },
  ],
};

// ── Renal demo patient (RENAL001) ─────────────────────────────────────────────
// 74-year-old female with AKI Stage 2, CrCl ~20 mL/min
// 5 active meds → 3 renal flags (metformin, enoxaparin, gabapentin)
const RENAL_PATIENT_ID = 'RENAL001';

const renalPatient = {
  patientId: RENAL_PATIENT_ID,
  name: 'TEST, Renata F',
  gender: 'female',
  dateOfBirth: '1952-01-15',
  age: 74,
  weight: { value: 61, unit: 'kg', date: new Date().toISOString() },
  height: { value: 162, unit: 'cm', date: new Date().toISOString() },
  _isMock: true,
};

const renalScrTrend = [
  { value: 2.4, date: now.toISOString(), unit: 'mg/dL' },
  { value: 1.8, date: daysAgo(1), unit: 'mg/dL' },
  { value: 1.1, date: daysAgo(2), unit: 'mg/dL' },
  { value: 0.9, date: daysAgo(3), unit: 'mg/dL' },
];

// Also export scrTrend for TEST001 (shows mild AKI context for existing patient)
const scrTrend = [
  { value: 1.1, date: now.toISOString(), unit: 'mg/dL' },
  { value: 0.9, date: daysAgo(1), unit: 'mg/dL' },
];

const renalLabs = {
  patientId: RENAL_PATIENT_ID,
  serumCreatinine: {
    id: 'mock-rscr-001',
    date: now.toISOString(),
    status: 'final',
    value: 2.4,
    unit: 'mg/dL',
    interpretation: 'H',
    referenceRange: { low: 0.5, high: 1.1, unit: 'mg/dL' },
  },
  ptt: null,
  vancomycinTroughs: [],
  bun: {
    id: 'mock-rbun-001',
    date: now.toISOString(),
    status: 'final',
    value: 48,
    unit: 'mg/dL',
    interpretation: 'H',
    referenceRange: { low: 7, high: 25, unit: 'mg/dL' },
  },
  _isMock: true,
};

const renalMedications = {
  patientId: RENAL_PATIENT_ID,
  total: 5,
  status: 'active',
  _isMock: true,
  medications: [
    {
      id: 'rmed-001',
      status: 'active',
      intent: 'order',
      medicationName: 'Metformin (Glucophage)',
      rxnormCodes: ['860975'],
      authoredOn: daysAgo(90),
      requester: 'TEST, Attending MD',
      dosages: [{ text: '500 mg PO BID with meals', route: 'Oral', doseQuantity: { value: 500, unit: 'mg' } }],
      note: [],
    },
    {
      id: 'rmed-002',
      status: 'active',
      intent: 'order',
      medicationName: 'Enoxaparin (Lovenox)',
      rxnormCodes: ['854228'],
      authoredOn: daysAgo(3),
      requester: 'TEST, Attending MD',
      dosages: [{ text: '40 mg SC daily — DVT prophylaxis', route: 'Subcutaneous', doseQuantity: { value: 40, unit: 'mg' } }],
      note: [],
    },
    {
      id: 'rmed-003',
      status: 'active',
      intent: 'order',
      medicationName: 'Gabapentin (Neurontin)',
      rxnormCodes: ['310431'],
      authoredOn: daysAgo(30),
      requester: 'TEST, Attending MD',
      dosages: [{ text: '300 mg PO TID — neuropathic pain', route: 'Oral', doseQuantity: { value: 300, unit: 'mg' } }],
      note: [],
    },
    {
      id: 'rmed-004',
      status: 'active',
      intent: 'order',
      medicationName: 'Lisinopril (Prinivil)',
      rxnormCodes: ['314076'],
      authoredOn: daysAgo(180),
      requester: 'TEST, Attending MD',
      dosages: [{ text: '10 mg PO daily', route: 'Oral', doseQuantity: { value: 10, unit: 'mg' } }],
      note: [],
    },
    {
      id: 'rmed-005',
      status: 'active',
      intent: 'order',
      medicationName: 'Metoprolol Tartrate (Lopressor)',
      rxnormCodes: ['866508'],
      authoredOn: daysAgo(180),
      requester: 'TEST, Attending MD',
      dosages: [{ text: '25 mg PO BID', route: 'Oral', doseQuantity: { value: 25, unit: 'mg' } }],
      note: [],
    },
  ],
};

// Census mock for TEST_UNIT location
const mockCensus = {
  locationId: 'TEST_UNIT',
  locationName: '4 West — General Medicine',
  _isMock: true,
  patients: [
    {
      patientId: RENAL_PATIENT_ID,
      name: 'TEST, Renata F',
      age: 74,
      sex: 'F',
      crcl: 20,
      akiDetected: true,
      akiStage: 2,
      trend: 'worsening',
      baselineScr: 0.9,
      currentScr: 2.4,
      flagCount: 3,
      severestFlag: 'contraindicated',
      flags: ['Metformin — CONTRAINDICATED', 'Enoxaparin — DOSE-ADJUSTMENT', 'Gabapentin — DOSE-ADJUSTMENT'],
    },
    {
      patientId: TEST_PATIENT_ID,
      name: 'TEST, John H',
      age: 68,
      sex: 'M',
      crcl: 72,
      akiDetected: false,
      akiStage: null,
      trend: 'stable',
      baselineScr: 1.1,
      currentScr: 1.1,
      flagCount: 0,
      severestFlag: null,
      flags: [],
    },
  ],
};

module.exports = {
  TEST_PATIENT_ID, patient, labs, vitals, medications,
  RENAL_PATIENT_ID, renalPatient, renalLabs, renalMedications, renalScrTrend, scrTrend, mockCensus,
};
