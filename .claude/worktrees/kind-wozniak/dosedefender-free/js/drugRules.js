/**
 * drugRules.js — Renal dose-adjustment rules for 18 high-risk medications
 * UMD module: works in Node (Jest) and browser (global RenalDrugRules)
 *
 * Schema per drug:
 *   { id, name, genericNames[], rxnormCodes[], category,
 *     thresholds: [{ crcl_max, crcl_min?, severity, recommendation, action }],
 *     acuteKidneyInjuryNote, dialysisNote }
 *
 * Threshold match: crcl <= crcl_max  AND  crcl > (crcl_min ?? -1)
 * Severity order (ascending): 'info' < 'low' < 'moderate' < 'high' < 'contraindicated'
 */
(function(global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.RenalDrugRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  // ── Severity helpers ─────────────────────────────────────────────────────────
  const SEVERITY_RANK = { info: 1, low: 2, moderate: 3, high: 4, contraindicated: 5 };

  function severityRank(s) { return SEVERITY_RANK[s] || 0; }

  function upgradeSeverity(s) {
    const map = { info: 'low', low: 'moderate', moderate: 'high', high: 'contraindicated' };
    return map[s] || s;
  }

  // ── Built-in drug rules ──────────────────────────────────────────────────────
  function getDefaultRules() {
    return [
      {
        id: 'metformin',
        name: 'Metformin',
        genericNames: ['metformin', 'glucophage', 'glumetza', 'fortamet'],
        rxnormCodes: ['860975', '861007', '860999', '1007', '861014'],
        category: 'Antidiabetic',
        thresholds: [
          {
            crcl_max: 30,
            severity: 'contraindicated',
            recommendation: 'Contraindicated — risk of lactic acidosis. Discontinue immediately.',
            action: 'DISCONTINUE',
          },
          {
            crcl_max: 45,
            crcl_min: 30,
            severity: 'high',
            recommendation: 'eGFR 30–45 mL/min: not recommended (ADA). Consider discontinuation.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Hold metformin immediately — AKI markedly increases lactic acidosis risk.',
        dialysisNote: 'Contraindicated on dialysis.',
      },
      {
        id: 'enoxaparin',
        name: 'Enoxaparin',
        genericNames: ['enoxaparin', 'lovenox'],
        rxnormCodes: ['854228', '854232', '854235', '854238'],
        category: 'Anticoagulant',
        thresholds: [
          {
            crcl_max: 15,
            severity: 'contraindicated',
            recommendation: 'Avoid — switch to unfractionated heparin with aPTT monitoring.',
            action: 'SWITCH-AGENT',
          },
          {
            crcl_max: 30,
            crcl_min: 15,
            severity: 'high',
            recommendation: 'CrCl 15–30: treatment dose → 1 mg/kg q24h (not q12h). Prophylaxis: 30 mg q24h. Anti-Xa monitoring recommended.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI greatly increases enoxaparin accumulation — consider switching to UFH.',
        dialysisNote: 'Avoid. Use UFH with aPTT monitoring.',
      },
      {
        id: 'apixaban',
        name: 'Apixaban',
        genericNames: ['apixaban', 'eliquis'],
        rxnormCodes: ['1364430', '1364435', '1364440'],
        category: 'Anticoagulant',
        thresholds: [
          {
            crcl_max: 25,
            severity: 'high',
            recommendation: 'Avoid — insufficient clinical data in severe renal impairment.',
            action: 'AVOID',
          },
          {
            crcl_max: 50,
            crcl_min: 25,
            severity: 'moderate',
            recommendation: 'CrCl 25–50 with ≥2 of: age ≥80, weight ≤60 kg, SCr ≥1.5 → reduce to 2.5 mg BID.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI may worsen drug accumulation — reassess dose.',
        dialysisNote: 'Not recommended. Limited data.',
      },
      {
        id: 'rivaroxaban',
        name: 'Rivaroxaban',
        genericNames: ['rivaroxaban', 'xarelto'],
        rxnormCodes: ['1359033', '1359034', '1362432'],
        category: 'Anticoagulant',
        thresholds: [
          {
            crcl_max: 15,
            severity: 'high',
            recommendation: 'Avoid — increased bleeding risk, insufficient safety data.',
            action: 'AVOID',
          },
          {
            crcl_max: 30,
            crcl_min: 15,
            severity: 'moderate',
            recommendation: 'CrCl 15–30: use with extreme caution. Consider alternative anticoagulant.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI may increase drug accumulation — consider UFH or LMWH transition.',
        dialysisNote: 'Not recommended.',
      },
      {
        id: 'dabigatran',
        name: 'Dabigatran',
        genericNames: ['dabigatran', 'pradaxa'],
        rxnormCodes: ['854236', '854239', '854244'],
        category: 'Anticoagulant',
        thresholds: [
          {
            crcl_max: 15,
            severity: 'contraindicated',
            recommendation: 'Contraindicated — drug eliminated renally, severe accumulation risk.',
            action: 'DISCONTINUE',
          },
          {
            crcl_max: 30,
            crcl_min: 15,
            severity: 'high',
            recommendation: 'CrCl 15–30: avoid (high bleeding risk). Switch to UFH.',
            action: 'AVOID',
          },
          {
            crcl_max: 50,
            crcl_min: 30,
            severity: 'moderate',
            recommendation: 'CrCl 30–50: reduce dose to 75 mg BID for AF. Avoid for VTE treatment.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI dramatically increases dabigatran levels — discontinue and transition to parenteral anticoagulation.',
        dialysisNote: 'Dialyzable (~60%). Contraindicated.',
      },
      {
        id: 'gabapentin',
        name: 'Gabapentin',
        genericNames: ['gabapentin', 'neurontin', 'gralise', 'horizant'],
        rxnormCodes: ['310431', '310432', '310433', '196994', '857296'],
        category: 'Analgesic/Anticonvulsant',
        thresholds: [
          {
            crcl_max: 15,
            severity: 'moderate',
            recommendation: 'CrCl < 15: 100–300 mg once daily. Titrate based on response and tolerability.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 30,
            crcl_min: 15,
            severity: 'moderate',
            recommendation: 'CrCl 15–30: 200–700 mg once daily. Maximum 300 mg BID.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 60,
            crcl_min: 30,
            severity: 'low',
            recommendation: 'CrCl 30–60: 200–700 mg BID. Reduce maximum daily dose.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI may markedly reduce clearance — hold dose pending reassessment.',
        dialysisNote: 'Post-dialysis supplemental dose required. 125–350 mg after each session.',
      },
      {
        id: 'pregabalin',
        name: 'Pregabalin',
        genericNames: ['pregabalin', 'lyrica'],
        rxnormCodes: ['559011', '559012', '559013', '559015'],
        category: 'Analgesic/Anticonvulsant',
        thresholds: [
          {
            crcl_max: 15,
            severity: 'moderate',
            recommendation: 'CrCl < 15: 25–75 mg once daily. Start low and titrate cautiously.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 30,
            crcl_min: 15,
            severity: 'moderate',
            recommendation: 'CrCl 15–30: 25–150 mg/day in 1–2 divided doses.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 60,
            crcl_min: 30,
            severity: 'low',
            recommendation: 'CrCl 30–60: 75–300 mg/day. Dose range reduced from normal.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Reduce dose or hold pending stability of renal function.',
        dialysisNote: 'Supplemental dose 25–75 mg post-dialysis.',
      },
      {
        id: 'vancomycin',
        name: 'Vancomycin',
        genericNames: ['vancomycin', 'vancocin'],
        rxnormCodes: ['11124', '370348', '370349', '309109', '309110'],
        category: 'Antibiotic',
        thresholds: [
          {
            crcl_max: 50,
            severity: 'moderate',
            recommendation: 'CrCl < 50: use AUC-guided dosing with extended intervals. Target AUC/MIC 400–600. Obtain PK levels.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI: hold or extend interval. Repeat levels before next dose. Consider alternative agent.',
        dialysisNote: 'Intermittent HD: 15–20 mg/kg post-dialysis, redose per trough <10 mg/L.',
      },
      {
        id: 'piptazo',
        name: 'Piperacillin-Tazobactam',
        genericNames: ['piperacillin', 'tazobactam', 'pip-tazo', 'piptazo', 'zosyn'],
        rxnormCodes: ['308460', '308461', '1659149', '1659152'],
        category: 'Antibiotic',
        thresholds: [
          {
            crcl_max: 20,
            severity: 'moderate',
            recommendation: 'CrCl < 20: reduce to 2.25 g q6h or 2.25 g q8h. Consider extended infusion (3–4h).',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 40,
            crcl_min: 20,
            severity: 'low',
            recommendation: 'CrCl 20–40: 3.375 g q8h or 2.25 g q6h. Normal dose 4.5 g q6h may be used with monitoring.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Reduce dose in AKI. Extended infusion over 4h may optimize PD/PK target attainment.',
        dialysisNote: 'HD: 2.25 g q12h with supplemental 0.75 g post-HD.',
      },
      {
        id: 'meropenem',
        name: 'Meropenem',
        genericNames: ['meropenem', 'merrem'],
        rxnormCodes: ['29519', '1665005', '1665007'],
        category: 'Antibiotic',
        thresholds: [
          {
            crcl_max: 10,
            severity: 'high',
            recommendation: 'CrCl < 10: 0.5 g q24h (standard infection). Reduce further for meningitis.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 25,
            crcl_min: 10,
            severity: 'moderate',
            recommendation: 'CrCl 10–25: 0.5 g q12h.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 50,
            crcl_min: 25,
            severity: 'low',
            recommendation: 'CrCl 25–50: 1 g q12h (normal is 1 g q8h). Reduce interval for CNS infection.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Dose reduction required. Monitor for CNS toxicity (seizures) at accumulation.',
        dialysisNote: 'HD: 0.5 g q24h. Supplemental 0.5 g after each session.',
      },
      {
        id: 'ciprofloxacin',
        name: 'Ciprofloxacin',
        genericNames: ['ciprofloxacin', 'cipro', 'ciloxan'],
        rxnormCodes: ['309309', '309310', '309312', '309315'],
        category: 'Antibiotic',
        thresholds: [
          {
            crcl_max: 30,
            severity: 'moderate',
            recommendation: 'CrCl < 30: PO 250–500 mg q18h or IV 200–400 mg q18–24h. Avoid high doses.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Reduce dose and extend interval during AKI.',
        dialysisNote: 'HD: 250–500 mg q24h after dialysis sessions.',
      },
      {
        id: 'digoxin',
        name: 'Digoxin',
        genericNames: ['digoxin', 'lanoxin', 'digitek'],
        rxnormCodes: ['197604', '197605', '197606'],
        category: 'Cardiac Glycoside',
        thresholds: [
          {
            crcl_max: 10,
            severity: 'high',
            recommendation: 'CrCl < 10: 0.0625 mg every other day or avoid. Monitor digoxin levels closely.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 50,
            crcl_min: 10,
            severity: 'moderate',
            recommendation: 'CrCl 10–50: reduce maintenance dose 25–75%. Check digoxin levels (target 0.5–0.9 ng/mL).',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Hold digoxin during AKI — rapid accumulation risk. Monitor ECG and drug levels.',
        dialysisNote: 'Not significantly dialyzed. Use low dose with level monitoring.',
      },
      {
        id: 'methotrexate',
        name: 'Methotrexate',
        genericNames: ['methotrexate', 'trexall', 'rheumatrex', 'otrexup'],
        rxnormCodes: ['105586', '105587', '1167382'],
        category: 'Antineoplastic/DMARD',
        thresholds: [
          {
            crcl_max: 10,
            severity: 'contraindicated',
            recommendation: 'Contraindicated — severe accumulation and mucositis risk.',
            action: 'DISCONTINUE',
          },
          {
            crcl_max: 30,
            crcl_min: 10,
            severity: 'high',
            recommendation: 'CrCl 10–30: avoid methotrexate. Consider alternative DMARD (hydroxychloroquine, leflunomide).',
            action: 'AVOID',
          },
          {
            crcl_max: 60,
            crcl_min: 30,
            severity: 'moderate',
            recommendation: 'CrCl 30–60: reduce dose by 50%, monitor CBC/LFT/SCr closely.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Hold immediately — AKI dramatically increases toxicity (mucositis, cytopenias). Leucovorin rescue may be needed.',
        dialysisNote: 'Minimally dialyzed. Contraindicated.',
      },
      {
        id: 'colchicine',
        name: 'Colchicine',
        genericNames: ['colchicine', 'colcrys', 'mitigare'],
        rxnormCodes: ['202670', '1431235', '1431242'],
        category: 'Antigout',
        thresholds: [
          {
            crcl_max: 10,
            severity: 'contraindicated',
            recommendation: 'Contraindicated — severe neuromuscular toxicity risk.',
            action: 'DISCONTINUE',
          },
          {
            crcl_max: 30,
            crcl_min: 10,
            severity: 'high',
            recommendation: 'CrCl 10–30: maximum 0.5 mg/day. Avoid prophylactic use. Monitor for myopathy.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Hold colchicine during AKI — neuromuscular and gastrointestinal toxicity risk.',
        dialysisNote: 'Avoid — not removed by dialysis.',
      },
      {
        id: 'acyclovir',
        name: 'Acyclovir',
        genericNames: ['acyclovir', 'zovirax', 'sitavig'],
        rxnormCodes: ['199889', '199890', '204056'],
        category: 'Antiviral',
        thresholds: [
          {
            crcl_max: 10,
            severity: 'high',
            recommendation: 'CrCl < 10: IV 5 mg/kg q24h; PO: 200 mg q12h. Adequate hydration essential.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 25,
            crcl_min: 10,
            severity: 'moderate',
            recommendation: 'CrCl 10–25: IV 5–10 mg/kg q24h; PO: 800 mg q8h.',
            action: 'DOSE-ADJUSTMENT',
          },
          {
            crcl_max: 50,
            crcl_min: 25,
            severity: 'low',
            recommendation: 'CrCl 25–50: IV q12h (normal q8h); PO: 800 mg q12h.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI: hold IV acyclovir — nephrotoxic. Use minimum effective dose with aggressive hydration.',
        dialysisNote: 'HD removes ~60%. Supplement dose post-session.',
      },
      {
        id: 'tramadol',
        name: 'Tramadol',
        genericNames: ['tramadol', 'ultram', 'conzip', 'rybix'],
        rxnormCodes: ['319864', '319865', '104379'],
        category: 'Analgesic/Opioid',
        thresholds: [
          {
            crcl_max: 30,
            severity: 'moderate',
            recommendation: 'CrCl < 30: maximum 200 mg/day in divided doses (q12h). Avoid immediate-release > 50 mg q12h.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'AKI: reduce dose and frequency. Active metabolite accumulates — increased seizure and sedation risk.',
        dialysisNote: 'HD: poorly removed. Avoid or use extreme caution.',
      },
      {
        id: 'spironolactone',
        name: 'Spironolactone',
        genericNames: ['spironolactone', 'aldactone', 'carospir'],
        rxnormCodes: ['202589', '202590', '308105'],
        category: 'Diuretic/Aldosterone Antagonist',
        thresholds: [
          {
            crcl_max: 30,
            severity: 'high',
            recommendation: 'CrCl < 30: avoid — severe hyperkalemia risk. Consider loop diuretic.',
            action: 'AVOID',
          },
          {
            crcl_max: 50,
            crcl_min: 30,
            severity: 'moderate',
            recommendation: 'CrCl 30–50: use with caution, monitor K+ closely (q3–5d), reduce dose.',
            action: 'DOSE-ADJUSTMENT',
          },
        ],
        acuteKidneyInjuryNote: 'Hold spironolactone during AKI — life-threatening hyperkalemia risk.',
        dialysisNote: 'Contraindicated.',
      },
      {
        id: 'nitrofurantoin',
        name: 'Nitrofurantoin',
        genericNames: ['nitrofurantoin', 'macrobid', 'macrodantin', 'furadantin'],
        rxnormCodes: ['309449', '309450', '309452', '693430'],
        category: 'Antibiotic/Urinary',
        thresholds: [
          {
            crcl_max: 45,
            severity: 'contraindicated',
            recommendation: 'Contraindicated — inadequate urinary drug levels plus toxic metabolite accumulation. Use alternative (fosfomycin, trimethoprim, or based on sensitivity).',
            action: 'DISCONTINUE',
          },
        ],
        acuteKidneyInjuryNote: 'Contraindicated in AKI — worsen renal injury and pulmonary toxicity.',
        dialysisNote: 'Contraindicated.',
      },
    ];
  }

  // ── Rule lookup (localStorage override first) ────────────────────────────────
  function getRenalRules() {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('dosedefender_renal_rules');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) { /* fall through to defaults */ }
    }
    return getDefaultRules();
  }

  /**
   * matchRule — find a drug rule for a medication.
   * Priority: RxNorm code match > generic name substring match (case-insensitive).
   */
  function matchRule(medication, rules) {
    const medName = (medication.medicationName || '').toLowerCase();
    const medRxnorm = medication.rxnormCodes || [];

    // 1. RxNorm code match (highest priority)
    if (medRxnorm.length > 0) {
      for (const rule of rules) {
        if (rule.rxnormCodes && rule.rxnormCodes.some(c => medRxnorm.includes(c))) {
          return rule;
        }
      }
    }

    // 2. Generic name substring match (case-insensitive)
    for (const rule of rules) {
      if (rule.genericNames && rule.genericNames.some(n => medName.includes(n.toLowerCase()))) {
        return rule;
      }
    }

    return null;
  }

  /**
   * checkMedicationList — evaluate all medications against renal thresholds.
   * Returns flags sorted by severity (descending).
   *
   * @param {Array}   medications  — medication objects with { id, medicationName, rxnormCodes, dosages }
   * @param {number}  crcl         — CrCl in mL/min
   * @param {boolean} akiDetected  — AKI status
   * @param {number}  akiStage     — 1, 2, or 3 (ignored if !akiDetected)
   * @returns {Array} flags
   */
  function checkMedicationList(medications, crcl, akiDetected, akiStage) {
    const rules = getRenalRules();
    const flags = [];

    for (const med of medications) {
      const rule = matchRule(med, rules);
      if (!rule) continue;

      // Find matching threshold (patient CrCl must be ≤ crcl_max AND > crcl_min)
      const matching = rule.thresholds.filter(t =>
        crcl <= (t.crcl_max != null ? t.crcl_max : Infinity) &&
        crcl > (t.crcl_min != null ? t.crcl_min : -1)
      );
      if (matching.length === 0) continue;

      // Highest-severity matching threshold
      const threshold = matching.sort((a, b) =>
        severityRank(b.severity) - severityRank(a.severity)
      )[0];

      let severity = threshold.severity;
      let akiUpgraded = false;

      // Upgrade severity one step if AKI detected and current severity is low
      if (akiDetected && severityRank(severity) < 3) {
        severity = upgradeSeverity(severity);
        akiUpgraded = true;
      }

      flags.push({
        medicationId: med.id,
        medicationName: med.medicationName,
        severity,
        currentCrCl: crcl,
        recommendation: threshold.recommendation,
        action: threshold.action,
        category: rule.category,
        akiUpgraded,
        akiNote: akiDetected ? rule.acuteKidneyInjuryNote : null,
        orderedDose: med.dosages && med.dosages[0] ? med.dosages[0].text : null,
        ruleId: rule.id,
      });
    }

    return flags.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  return {
    getRenalRules,
    getDefaultRules,
    checkMedicationList,
    severityRank,
    upgradeSeverity,
    // Expose for testing
    _matchRule: matchRule,
  };
});
