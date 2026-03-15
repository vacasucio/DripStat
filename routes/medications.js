/**
 * Medications
 * GET /api/medications/:patientId       — active medication list with doses & frequencies
 * GET /api/medications/:patientId/:id   — single MedicationRequest by ID
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { TEST_PATIENT_ID, medications: mockMeds } = require('../testData');

const FHIR_BASE = process.env.FHIR_BASE_URL;

function formatMedRequest(mr) {
  // Medication name: from contained resource or medicationCodeableConcept
  let medicationName = null;
  if (mr.medicationCodeableConcept) {
    medicationName =
      mr.medicationCodeableConcept.text ||
      mr.medicationCodeableConcept.coding?.[0]?.display ||
      null;
  } else if (mr.medicationReference && mr.contained) {
    const ref = mr.medicationReference.reference?.replace('#', '');
    const contained = mr.contained.find(c => c.id === ref);
    medicationName =
      contained?.code?.text ||
      contained?.code?.coding?.[0]?.display ||
      null;
  }

  // Dosage instructions
  const dosages = (mr.dosageInstruction || []).map(d => {
    const dose = d.doseAndRate?.[0];
    return {
      text: d.text || null,
      route: d.route?.text || d.route?.coding?.[0]?.display || null,
      doseQuantity: dose?.doseQuantity
        ? { value: dose.doseQuantity.value, unit: dose.doseQuantity.unit }
        : null,
      doseRange: dose?.doseRange || null,
      frequency: d.timing?.repeat
        ? {
            frequency: d.timing.repeat.frequency,
            period: d.timing.repeat.period,
            periodUnit: d.timing.repeat.periodUnit,
            // Human-readable: e.g. "2 per 1 d"
            display: `${d.timing.repeat.frequency ?? ''} per ${d.timing.repeat.period ?? ''} ${d.timing.repeat.periodUnit ?? ''}`.trim(),
          }
        : null,
      timing: d.timing?.code?.text || d.timing?.code?.coding?.[0]?.display || null,
    };
  });

  return {
    id: mr.id,
    status: mr.status,
    intent: mr.intent,
    medicationName,
    authoredOn: mr.authoredOn || null,
    requester: mr.requester?.display || null,
    dosages,
    note: mr.note?.map(n => n.text) || [],
  };
}

// GET /api/medications/:patientId
router.get('/:patientId', async (req, res) => {
  const { patientId } = req.params;
  if (patientId === TEST_PATIENT_ID) return res.json(mockMeds);
  const status = req.query.status || 'active';
  const count = Math.min(parseInt(req.query.count) || 50, 100);

  try {
    const response = await axios.get(`${FHIR_BASE}/MedicationRequest`, {
      params: {
        patient: patientId,
        status,
        _count: count,
        _sort: '-authoredon',
      },
      headers: { Accept: 'application/fhir+json' },
    });

    const bundle = response.data;
    const medications = (bundle.entry || []).map(e => formatMedRequest(e.resource));

    res.json({
      patientId,
      total: bundle.total ?? medications.length,
      status,
      medications,
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/medications/:patientId/:id
router.get('/:patientId/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const response = await axios.get(`${FHIR_BASE}/MedicationRequest/${id}`, {
      headers: { Accept: 'application/fhir+json' },
    });
    res.json(formatMedRequest(response.data));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
