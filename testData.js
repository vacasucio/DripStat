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

module.exports = { TEST_PATIENT_ID, patient, labs, vitals, medications };
