/**
 * Vital Signs
 * GET /api/vitals/:patientId            — latest set of all vitals
 * GET /api/vitals/:patientId/weight     — weight trend (up to 30 readings)
 * GET /api/vitals/:patientId/bp         — blood pressure trend
 * GET /api/vitals/:patientId/latest     — single latest vital panel
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const FHIR_BASE = process.env.FHIR_BASE_URL;

const LOINC = {
  WEIGHT:      '29463-7',  // Body weight
  HEIGHT:      '8302-2',   // Body height
  TEMP:        '8310-5',   // Body temperature
  HEART_RATE:  '8867-4',   // Heart rate
  RESP_RATE:   '9279-1',   // Respiratory rate
  O2_SAT:      '59408-5',  // Oxygen saturation by pulse oximetry
  BP_SYSTOLIC: '8480-6',   // Systolic BP
  BP_DIASTOLIC:'8462-4',   // Diastolic BP
};

async function fetchVital(patientId, loincCode, count = 1) {
  const res = await axios.get(`${FHIR_BASE}/Observation`, {
    params: {
      patient: patientId,
      code: loincCode,
      category: 'vital-signs',
      _sort: '-date',
      _count: count,
    },
    headers: { Accept: 'application/fhir+json' },
  });
  return res.data.entry?.map(e => e.resource) || [];
}

function formatVital(obs) {
  if (!obs) return null;
  const result = {
    id: obs.id,
    date: obs.effectiveDateTime || obs.issued,
    status: obs.status,
    value: null,
    unit: null,
    components: null,
  };

  if (obs.valueQuantity) {
    result.value = obs.valueQuantity.value;
    result.unit = obs.valueQuantity.unit;
  }

  // Handle panel observations (e.g. BP with systolic/diastolic components)
  if (obs.component && obs.component.length > 0) {
    result.components = obs.component.map(c => ({
      code: c.code?.coding?.[0]?.code,
      display: c.code?.text || c.code?.coding?.[0]?.display,
      value: c.valueQuantity?.value ?? null,
      unit: c.valueQuantity?.unit ?? null,
    }));
  }

  return result;
}

// GET /api/vitals/:patientId — snapshot of latest vitals
router.get('/:patientId', async (req, res) => {
  const { patientId } = req.params;
  try {
    const [weightList, heightList, tempList, hrList, rrList, o2List] = await Promise.all([
      fetchVital(patientId, LOINC.WEIGHT, 1),
      fetchVital(patientId, LOINC.HEIGHT, 1),
      fetchVital(patientId, LOINC.TEMP, 1),
      fetchVital(patientId, LOINC.HEART_RATE, 1),
      fetchVital(patientId, LOINC.RESP_RATE, 1),
      fetchVital(patientId, LOINC.O2_SAT, 1),
    ]);

    res.json({
      patientId,
      weight:       formatVital(weightList[0]),
      height:       formatVital(heightList[0]),
      temperature:  formatVital(tempList[0]),
      heartRate:    formatVital(hrList[0]),
      respiratoryRate: formatVital(rrList[0]),
      oxygenSaturation: formatVital(o2List[0]),
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/vitals/:patientId/weight — weight trend for dosing calculations
router.get('/:patientId/weight', async (req, res) => {
  const { patientId } = req.params;
  const count = Math.min(parseInt(req.query.count) || 30, 100);
  try {
    const list = await fetchVital(patientId, LOINC.WEIGHT, count);
    const trend = list.map(formatVital);

    // Compute simple stats useful for pharmacy dosing
    const values = trend.filter(v => v?.value != null).map(v => v.value);
    const stats = values.length > 0
      ? {
          latest: values[0],
          min: Math.min(...values),
          max: Math.max(...values),
          avg: parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)),
          unit: trend[0]?.unit,
          count: values.length,
        }
      : null;

    res.json({ patientId, weightTrend: trend, stats });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/vitals/:patientId/bp — blood pressure trend
router.get('/:patientId/bp', async (req, res) => {
  const { patientId } = req.params;
  const count = Math.min(parseInt(req.query.count) || 20, 100);
  try {
    // Fetch BP as a panel observation (LOINC 55284-4) or individual components
    const res1 = await axios.get(`${FHIR_BASE}/Observation`, {
      params: {
        patient: patientId,
        code: '55284-4',        // Blood pressure panel
        category: 'vital-signs',
        _sort: '-date',
        _count: count,
      },
      headers: { Accept: 'application/fhir+json' },
    });

    const panels = (res1.data.entry || []).map(e => formatVital(e.resource));
    res.json({ patientId, bloodPressure: panels });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/vitals/:patientId/latest — alias for snapshot
router.get('/:patientId/latest', async (req, res) => {
  req.url = `/${req.params.patientId}`;
  res.redirect(307, `/api/vitals/${req.params.patientId}`);
});

module.exports = router;
