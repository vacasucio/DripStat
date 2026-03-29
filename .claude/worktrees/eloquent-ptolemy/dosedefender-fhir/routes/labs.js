/**
 * Lab Results
 * GET /api/labs/:patientId              — all relevant labs (latest of each)
 * GET /api/labs/:patientId/scr          — serum creatinine
 * GET /api/labs/:patientId/ptt          — PTT (partial thromboplastin time)
 * GET /api/labs/:patientId/vancomycin   — vancomycin trough levels (last 10)
 * GET /api/labs/:patientId/bun          — BUN (blood urea nitrogen)
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { TEST_PATIENT_ID, labs: mockLabs, RENAL_PATIENT_ID, renalLabs, renalScrTrend, scrTrend: mockScrTrend } = require('../testData');
const { getFloorPatient } = require('../js/floorSandbox');
const { getFhirHeaders } = require('../lib/fhirHeaders');

const FHIR_BASE = process.env.FHIR_BASE_URL;

// LOINC codes
const LOINC = {
  SCR: '2160-0',         // Creatinine [Mass/volume] in Serum or Plasma
  PTT: '3173-2',         // aPTT in Blood by Coagulation assay
  VANCOMYCIN: '4084-1',  // Vancomycin [Mass/volume] in Serum or Plasma
  BUN: '3094-0',         // Urea nitrogen [Mass/volume] in Serum or Plasma
  GLUCOSE: '2345-7',     // Glucose [Mass/volume] in Serum or Plasma
  POTASSIUM: '2823-3',   // Potassium [Moles/volume] in Serum or Plasma
  CO2: '2028-9',         // Carbon dioxide, total (bicarbonate) in Serum or Plasma
  SODIUM: '2951-2',      // Sodium [Moles/volume] in Serum or Plasma
  CHLORIDE: '2075-0',    // Chloride [Moles/volume] in Serum or Plasma
};

async function fetchObs(patientId, loincCode, count = 1, headers = { Accept: 'application/fhir+json' }) {
  const res = await axios.get(`${FHIR_BASE}/Observation`, {
    params: {
      patient: patientId,
      code: loincCode,
      _sort: '-date',
      _count: count,
    },
    headers,
  });
  return res.data.entry?.map(e => e.resource) || [];
}

function formatObs(obs) {
  if (!obs) return null;
  return {
    id: obs.id,
    date: obs.effectiveDateTime || obs.issued,
    status: obs.status,
    value: obs.valueQuantity?.value ?? null,
    unit: obs.valueQuantity?.unit ?? null,
    interpretation: obs.interpretation?.[0]?.coding?.[0]?.code ?? null,
    referenceRange: obs.referenceRange?.[0]
      ? {
          low: obs.referenceRange[0].low?.value,
          high: obs.referenceRange[0].high?.value,
          unit: obs.referenceRange[0].low?.unit || obs.referenceRange[0].high?.unit,
        }
      : null,
  };
}

// GET /api/labs/:patientId — all latest labs in one call
router.get('/:patientId', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) return res.json(mockLabs);
  if (patientId === RENAL_PATIENT_ID) return res.json(renalLabs);
  if (patientId.startsWith('FL')) {
    const flPt = getFloorPatient(patientId);
    if (!flPt) return res.status(404).json({ error: `Floor patient ${patientId} not found` });
    const latest = flPt.scrTrend[0];
    return res.json({
      patientId,
      serumCreatinine: { value: latest.value, unit: 'mg/dL', date: latest.date },
      scrTrend: flPt.scrTrend,
    });
  }
  try {
    const [scrList, pttList, vancoList, bunList, glucoseList, potassiumList, co2List, sodiumList, chlorideList] = await Promise.all([
      fetchObs(patientId, LOINC.SCR, 1),
      fetchObs(patientId, LOINC.PTT, 1),
      fetchObs(patientId, LOINC.VANCOMYCIN, 5),
      fetchObs(patientId, LOINC.BUN, 1),
      fetchObs(patientId, LOINC.GLUCOSE, 1),
      fetchObs(patientId, LOINC.POTASSIUM, 1),
      fetchObs(patientId, LOINC.CO2, 1),
      fetchObs(patientId, LOINC.SODIUM, 1),
      fetchObs(patientId, LOINC.CHLORIDE, 1),
    ]);

    res.json({
      patientId,
      serumCreatinine: formatObs(scrList[0]),
      ptt: formatObs(pttList[0]),
      vancomycinTroughs: vancoList.map(formatObs),
      bun: formatObs(bunList[0]),
      glucose: formatObs(glucoseList[0]),
      potassium: formatObs(potassiumList[0]),
      bicarbonate: formatObs(co2List[0]),
      sodium: formatObs(sodiumList[0]),
      chloride: formatObs(chlorideList[0]),
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/labs/:patientId/scr
router.get('/:patientId/scr', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) return res.json({ patientId, serumCreatinine: [mockLabs.serumCreatinine] });
  try {
    const list = await fetchObs(patientId, LOINC.SCR, 5);
    res.json({ patientId, serumCreatinine: list.map(formatObs) });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/labs/:patientId/ptt
router.get('/:patientId/ptt', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) return res.json({ patientId, ptt: [mockLabs.ptt] });
  try {
    const list = await fetchObs(patientId, LOINC.PTT, 5);
    res.json({ patientId, ptt: list.map(formatObs) });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/labs/:patientId/vancomycin
router.get('/:patientId/vancomycin', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) return res.json({ patientId, vancomycinTroughs: [] });
  const count = Math.min(parseInt(req.query.count) || 10, 50);
  try {
    const list = await fetchObs(patientId, LOINC.VANCOMYCIN, count);
    res.json({ patientId, vancomycinTroughs: list.map(formatObs) });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/labs/:patientId/bun
router.get('/:patientId/bun', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) return res.json({ patientId, bun: [mockLabs.bun] });
  if (patientId === RENAL_PATIENT_ID) return res.json({ patientId, bun: [renalLabs.bun] });
  try {
    const list = await fetchObs(patientId, LOINC.BUN, 5);
    res.json({ patientId, bun: list.map(formatObs) });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/labs/:patientId/scr-trend — last 10 SCr values for AKI detection
router.get('/:patientId/scr-trend', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) {
    return res.json({ patientId, scrTrend: mockScrTrend });
  }
  if (patientId === RENAL_PATIENT_ID) {
    return res.json({ patientId, scrTrend: renalScrTrend });
  }
  if (patientId.startsWith('FL')) {
    const flPt = getFloorPatient(patientId);
    if (!flPt) return res.status(404).json({ error: `Floor patient ${patientId} not found` });
    return res.json({
      patientId,
      serumCreatinine: flPt.scrTrend[0].value,
      scrTrend: flPt.scrTrend,
    });
  }
  try {
    const list = await fetchObs(patientId, LOINC.SCR, 10, getFhirHeaders(req));
    res.json({ patientId, scrTrend: list.map(formatObs) });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
