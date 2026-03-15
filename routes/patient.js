/**
 * Patient Demographics
 * GET /api/patient/:id
 *
 * Returns: weight (kg), height (cm), age (years), sex
 * Sources: Patient resource + Observation (weight/height vital signs)
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { TEST_PATIENT_ID, patient: mockPatient } = require('../testData');

const FHIR_BASE = process.env.FHIR_BASE_URL;

// LOINC codes
const LOINC_WEIGHT = '29463-7';
const LOINC_HEIGHT = '8302-2';

function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

async function getLatestObservation(patientId, loincCode) {
  const url = `${FHIR_BASE}/Observation`;
  const res = await axios.get(url, {
    params: {
      patient: patientId,
      code: loincCode,
      _sort: '-date',
      _count: 1,
    },
    headers: { Accept: 'application/fhir+json' },
  });
  const bundle = res.data;
  if (!bundle.entry || bundle.entry.length === 0) return null;
  return bundle.entry[0].resource;
}

function extractQuantity(obs) {
  if (!obs) return null;
  if (obs.valueQuantity) {
    return { value: obs.valueQuantity.value, unit: obs.valueQuantity.unit, date: obs.effectiveDateTime };
  }
  return null;
}

// GET /api/patient/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (id === TEST_PATIENT_ID) return res.json(mockPatient);
  try {
    const [patientRes, weightObs, heightObs] = await Promise.all([
      axios.get(`${FHIR_BASE}/Patient/${id}`, { headers: { Accept: 'application/fhir+json' } }),
      getLatestObservation(id, LOINC_WEIGHT),
      getLatestObservation(id, LOINC_HEIGHT),
    ]);

    const pt = patientRes.data;

    const name = pt.name?.[0];
    const fullName = name
      ? [name.prefix?.[0], ...(name.given || []), name.family].filter(Boolean).join(' ')
      : 'Unknown';

    const gender = pt.gender || null;
    const dob = pt.birthDate || null;
    const age = calcAge(dob);

    const weight = extractQuantity(weightObs);
    const height = extractQuantity(heightObs);

    res.json({
      patientId: id,
      name: fullName,
      gender,
      dateOfBirth: dob,
      age,
      weight,
      height,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.message, fhirStatus: err.response?.data });
  }
});

module.exports = router;
