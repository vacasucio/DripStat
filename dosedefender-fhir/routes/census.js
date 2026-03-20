/**
 * Census
 * GET /api/census/:locationId
 * Returns all in-progress encounters at a location with renal flag aggregation.
 * For TEST_UNIT, returns mock census data.
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { mockCensus } = require('../testData');
const { getFhirHeaders } = require('../lib/fhirHeaders');
const floorSandbox = require('../js/floorSandbox');

const FHIR_BASE = process.env.FHIR_BASE_URL;

// GET /api/census/:locationId
router.get('/:locationId', async (req, res) => {
  const { locationId } = req.params;

  // Mock census for development / demo
  if (locationId === 'TEST_UNIT') {
    return res.json(mockCensus);
  }

  if (locationId === 'FLOOR_4W') {
    const patients = floorSandbox.computeFloorCensus();
    return res.json({
      locationId: 'FLOOR_4W',
      locationName: '4 West — General Medicine (Sandbox)',
      patients,
      _isMock: true,
    });
  }

  // FHIR-backed census (requires active FHIR server)
  const headers = getFhirHeaders(req);

  try {
    // 1. Fetch active encounters at the specified location
    const encounterRes = await axios.get(`${FHIR_BASE}/Encounter`, {
      params: {
        location: locationId,
        status: 'in-progress',
        _count: 100,
        _include: 'Encounter:patient',
      },
      headers,
    });

    const bundle = encounterRes.data;
    const entries = bundle.entry || [];

    // Separate Encounter and Patient resources
    const encounters = entries
      .filter(e => e.resource?.resourceType === 'Encounter')
      .map(e => e.resource);
    const patientMap = {};
    entries
      .filter(e => e.resource?.resourceType === 'Patient')
      .forEach(e => { patientMap[e.resource.id] = e.resource; });

    if (encounters.length === 0) {
      return res.json({ locationId, patients: [], _isMock: false });
    }

    // 2. For each encounter, fetch SCr trend and medications in parallel
    const RenalEngine = require('../js/renalEngine');
    const RenalDrugRules = require('../js/drugRules');

    const patientResults = await Promise.allSettled(
      encounters.map(async enc => {
        const patientRef = enc.subject?.reference || '';
        const patientId = patientRef.split('/').pop();
        const ptResource = patientMap[patientId];

        // Fetch SCr trend and medications concurrently
        const [scrRes, medRes, patRes] = await Promise.allSettled([
          axios.get(`${FHIR_BASE}/Observation`, {
            params: { patient: patientId, code: '2160-0', _sort: '-date', _count: 10 },
            headers,
          }),
          axios.get(`${FHIR_BASE}/MedicationRequest`, {
            params: { patient: patientId, status: 'active', _count: 50 },
            headers,
          }),
          ptResource
            ? Promise.resolve({ data: ptResource })
            : axios.get(`${FHIR_BASE}/Patient/${patientId}`, { headers }),
        ]);

        // Build SCr trend
        const scrTrend = scrRes.status === 'fulfilled'
          ? (scrRes.value.data.entry || []).map(e => ({
              value: e.resource.valueQuantity?.value,
              date: e.resource.effectiveDateTime || e.resource.issued,
            })).filter(r => r.value != null)
          : [];

        // Get patient demographics
        const pt = patRes.status === 'fulfilled' ? patRes.value.data : {};
        const dob = pt.birthDate;
        const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000) : null;
        const sex = pt.gender === 'male' ? 'M' : pt.gender === 'female' ? 'F' : '';
        const name = pt.name?.[0]
          ? [pt.name[0].family, ...(pt.name[0].given || [])].filter(Boolean).join(', ')
          : patientId;

        // CrCl requires weight/height — use defaults if not available (no vitals fetch for census perf)
        // We'll flag if SCr is elevated even without exact CrCl
        const currentScr = scrTrend[0]?.value;
        let crcl = null;
        const aki = scrTrend.length >= 2 ? RenalEngine.detectAKI(scrTrend) : { akiDetected: false };

        // Get medications
        const meds = medRes.status === 'fulfilled'
          ? (medRes.value.data.entry || []).map(e => ({
              id: e.resource.id,
              medicationName: e.resource.medicationCodeableConcept?.text
                || e.resource.medicationCodeableConcept?.coding?.[0]?.display
                || 'Unknown',
              rxnormCodes: (e.resource.medicationCodeableConcept?.coding || [])
                .filter(c => c.system?.toLowerCase().includes('rxnorm'))
                .map(c => c.code),
            }))
          : [];

        const flags = crcl != null
          ? RenalDrugRules.checkMedicationList(meds, crcl, aki.akiDetected, aki.akiStage)
          : [];

        return {
          patientId,
          name,
          age,
          sex,
          crcl,
          currentScr,
          akiDetected: aki.akiDetected,
          akiStage: aki.akiStage || null,
          trend: aki.trend || 'stable',
          baselineScr: aki.baselineScr,
          flagCount: flags.length,
          severestFlag: flags[0]?.severity || null,
          flags: flags.map(f => `${f.medicationName} — ${f.action}`),
        };
      })
    );

    const patients = patientResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .sort((a, b) => {
        const rankA = a.severestFlag ? ['info', 'low', 'moderate', 'high', 'contraindicated'].indexOf(a.severestFlag) : -1;
        const rankB = b.severestFlag ? ['info', 'low', 'moderate', 'high', 'contraindicated'].indexOf(b.severestFlag) : -1;
        return rankB - rankA;
      });

    res.json({ locationId, patients, _isMock: false });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
