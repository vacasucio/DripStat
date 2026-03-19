/**
 * renalEngine.js — CrCl (Cockcroft-Gault + ABW) + KDIGO AKI detection
 * UMD module: works in Node (Jest) and browser (global RenalEngine)
 */
(function(global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.RenalEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  /**
   * calcCrCl — Cockcroft-Gault with ABW adjustment for obesity (BMI > 30)
   * and an SCr floor of 0.6 mg/dL to prevent CrCl overestimation.
   * CrCl is capped at 120 mL/min.
   *
   * @param {object} p
   * @param {number} p.age         years
   * @param {number} p.weightKg   actual body weight (kg)
   * @param {number} p.heightCm   height (cm)
   * @param {string} p.sex        'M' or 'F'
   * @param {number} p.scrMgDl    serum creatinine (mg/dL)
   * @returns {object} { crcl, method, scrUsed, weightUsed, floorApplied }
   */
  function calcCrCl({ age, weightKg, heightCm, sex, scrMgDl }) {
    // SCr floor at 0.6 mg/dL
    const scrUsed = Math.max(scrMgDl, 0.6);
    const floorApplied = scrMgDl < 0.6;

    // IBW (Devine formula, cm-based)
    const inchesOver5ft = (heightCm / 2.54) - 60;
    const ibw = sex === 'M'
      ? 50 + 2.3 * inchesOver5ft
      : 45.5 + 2.3 * inchesOver5ft;

    // ABW if BMI > 30
    const bmi = weightKg / Math.pow(heightCm / 100, 2);
    const weightUsed = bmi > 30 ? ibw + 0.4 * (weightKg - ibw) : weightKg;

    // Cockcroft-Gault
    let crcl = ((140 - age) * weightUsed) / (72 * scrUsed);
    if (sex === 'F') crcl *= 0.85;
    crcl = Math.min(Math.round(crcl), 120);

    return {
      crcl,
      method: 'CG',
      scrUsed,
      weightUsed: Math.round(weightUsed),
      floorApplied,
      bmi: Math.round(bmi * 10) / 10,
    };
  }

  /**
   * detectAKI — KDIGO-based AKI detection and staging
   * Criteria (any one triggers AKI):
   *   • Absolute rise ≥ 0.3 mg/dL within 48 hours
   *   • Ratio ≥ 1.5× lowest SCr in prior 7 days
   *
   * Staging by ratio vs admission (oldest) SCr:
   *   Stage 1: ×1.5–1.9
   *   Stage 2: ×2.0–2.9
   *   Stage 3: ×3.0 or SCr ≥ 4.0 mg/dL
   *
   * @param {Array<{value: number, date: string}>} scrResults  newest first
   * @returns {object} AKI result object
   */
  function detectAKI(scrResults) {
    if (!scrResults || scrResults.length < 2) {
      return { akiDetected: false, trend: 'stable' };
    }

    const current = scrResults[0];
    const currentVal = current.value;
    const currentTime = new Date(current.date).getTime();

    // Baseline = oldest value (admission)
    const admission = scrResults[scrResults.length - 1];
    const admissionVal = admission.value;
    const deltaHours = (currentTime - new Date(admission.date).getTime()) / 3600000;

    // Lowest SCr in prior 7 days (for ratio criterion)
    const sevenDaysAgo = currentTime - 7 * 86400000;
    const prior7 = scrResults.filter(r => {
      const t = new Date(r.date).getTime();
      return t < currentTime && t >= sevenDaysAgo;
    });
    const baseline7 = prior7.length
      ? Math.min(...prior7.map(r => r.value))
      : admissionVal;

    // Lowest SCr in prior 48h (for absolute rise criterion)
    const fortyEightHrsAgo = currentTime - 48 * 3600000;
    const prior48 = scrResults.filter(r => {
      const t = new Date(r.date).getTime();
      return t < currentTime && t >= fortyEightHrsAgo;
    });
    const lowestIn48h = prior48.length ? Math.min(...prior48.map(r => r.value)) : null;
    const deltaAbsolute48h = lowestIn48h != null ? currentVal - lowestIn48h : null;

    // AKI criteria
    const rise48h = deltaAbsolute48h != null && deltaAbsolute48h >= 0.3;
    const riseRatio = currentVal / baseline7 >= 1.5;
    const akiDetected = rise48h || riseRatio;

    // Always compute trend (compare current vs previous result)
    const prevValForTrend = scrResults[1] ? scrResults[1].value : null;
    const generalTrend = prevValForTrend == null
      ? 'stable'
      : currentVal > prevValForTrend ? 'worsening'
      : currentVal < prevValForTrend ? 'improving'
      : 'stable';

    if (!akiDetected) {
      return {
        akiDetected: false,
        trend: generalTrend,
        baselineScr: admissionVal,
        currentScr: currentVal,
      };
    }

    // Stage by ratio vs admission SCr
    const ratio = admissionVal > 0 ? currentVal / admissionVal : 1;
    let akiStage = 1;
    if (ratio >= 3.0 || currentVal >= 4.0) akiStage = 3;
    else if (ratio >= 2.0) akiStage = 2;

    const trend = generalTrend;

    return {
      akiDetected: true,
      akiStage,
      baselineScr: admissionVal,
      currentScr: currentVal,
      scrDeltaAbsolute: parseFloat((currentVal - admissionVal).toFixed(2)),
      scrDeltaPercent: Math.round((currentVal - admissionVal) / admissionVal * 100),
      deltaTimeHours: Math.round(deltaHours),
      trend,
      rise48h,
      riseRatio,
      message: `SCr ${admissionVal} → ${currentVal} mg/dL (${Math.round(deltaHours)}h, Stage ${akiStage} AKI)`,
    };
  }

  return { calcCrCl, detectAKI };
});
