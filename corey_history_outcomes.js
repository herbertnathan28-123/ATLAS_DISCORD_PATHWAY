'use strict';

/**
 * ATLAS FX — Corey Clone Phase D outcome classifier.
 *
 * Spec authority: D.1.0.3 §OUTCOME LABELS.
 *
 * Closed label set: follow_through | reversal | range.
 * Primary horizon: 5D. Sensitivity horizons (1D/3D/10D) computed and
 * stored but not fed to Jane in Phase D.
 * Threshold: 1.0 × ATR(14) at outcome window start.
 *
 * Inputs:
 *   - rows (full chronological 1D candles, validated by reader)
 *   - anchorIndex (integer index of analogue's window_end bar)
 *
 * Output:
 *   {
 *     ok: bool,
 *     label, direction,                       // 'follow_through' | 'reversal' | 'range', 'up' | 'down' | 'flat'
 *     C_start, C_end, H_max, L_min, ATR,
 *     up_excursion, down_excursion, final_delta,
 *     close_at_window_start, close_at_window_end,
 *     atr_at_window_start, delta_in_atr,
 *     outcome_window_bar_open_times: [iso...],
 *     reason?
 *   }
 *
 * Drop analogue (ok=false, reason set) if:
 *   - any 5D forward bar missing
 *   - ATR(14) unavailable (need 14 prior bars including anchor)
 *   - forward bar fails row validation (already ensured by reader)
 *   - cache corruption boundary crossed (gap detection out of scope here;
 *     reader sorts and dedupes; absence of bars triggers the missing-bar drop)
 */

const config       = require('./corey_history_config');
const versions     = require('./corey_history_versions');

/**
 * computeATR — Wilder ATR(period) using the bar at endIndex inclusive.
 * Returns finite positive number, or null if not enough history.
 */
function computeATR(rows, endIndex, period) {
  if (!rows || endIndex < period) return null;
  // True Range for bars [endIndex - period + 1 .. endIndex], using
  // previous close from the bar at endIndex - period (if available).
  const trs = [];
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    const bar = rows[i];
    const prev = rows[i - 1];
    if (!bar || !prev) return null;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prev.close),
      Math.abs(bar.low  - prev.close),
    );
    if (!Number.isFinite(tr) || tr < 0) return null;
    trs.push(tr);
  }
  // Simple mean TR over the lookback as the ATR(14) seed value (Wilder's
  // first-step). For Phase D we use the stable mean form rather than
  // the recursive smoothing, because it is reproducible and
  // anchor-independent.
  const sum = trs.reduce((a, b) => a + b, 0);
  const atr = sum / trs.length;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}

/**
 * classifyOutcome — apply §OUTCOME LABELS rules.
 */
function classifyOutcome(rows, anchorIndex, opts) {
  opts = opts || {};
  const horizonDays = opts.horizonDays || config.OUTCOME.primaryHorizonDays;
  const period      = opts.atrPeriod   || config.OUTCOME.atrPeriod;
  const thr         = opts.thresholdAtrMultiple || config.OUTCOME.thresholdAtrMultiple;

  if (anchorIndex < 0 || anchorIndex >= rows.length) {
    return { ok: false, reason: 'anchor index out of range' };
  }
  const lastForward = anchorIndex + horizonDays;
  if (lastForward >= rows.length) {
    return { ok: false, reason: `forward window not present (need ${horizonDays} bars after anchor)` };
  }
  // ATR(14) at anchor — needs 14 bars ending at anchor (with previous close
  // for the first TR), so anchor must be >= period.
  const atr = computeATR(rows, anchorIndex, period);
  if (atr == null) {
    return { ok: false, reason: 'ATR(14) unavailable at anchor' };
  }

  const anchorBar = rows[anchorIndex];
  const C_start = anchorBar.close;
  const fwd = rows.slice(anchorIndex + 1, anchorIndex + 1 + horizonDays);
  if (fwd.length !== horizonDays) {
    return { ok: false, reason: 'forward window length mismatch' };
  }
  // Per-bar finite check
  for (const b of fwd) {
    if (!Number.isFinite(b.open) || !Number.isFinite(b.high) ||
        !Number.isFinite(b.low)  || !Number.isFinite(b.close)) {
      return { ok: false, reason: 'forward bar OHLC not finite' };
    }
  }

  const C_end = fwd[fwd.length - 1].close;
  let H_max = -Infinity, L_min = Infinity;
  // First-cross tracking: time at which |excursion| first crosses thr
  let firstCrossDir = null; // 'up' | 'down' | null
  for (let i = 0; i < fwd.length; i++) {
    const b = fwd[i];
    if (b.high > H_max) H_max = b.high;
    if (b.low  < L_min) L_min = b.low;
    if (firstCrossDir === null) {
      const upEx = (H_max - C_start) / atr;
      const dnEx = (C_start - L_min) / atr;
      const upCross = upEx >= thr;
      const dnCross = dnEx >= thr;
      if (upCross && dnCross) {
        // Both crossed within this bar — break by which extreme was reached
        // first within the bar's high/low. Convention: open-relative — if
        // (high - open) >= (open - low), up first; else down first.
        firstCrossDir = (b.high - b.open) >= (b.open - b.low) ? 'up' : 'down';
      } else if (upCross) firstCrossDir = 'up';
      else if (dnCross)   firstCrossDir = 'down';
    }
  }

  const up_excursion   = (H_max - C_start) / atr;
  const down_excursion = (C_start - L_min) / atr;
  const final_delta    = (C_end   - C_start) / atr;

  // Apply rules
  let label, direction;
  if (Math.max(up_excursion, down_excursion) < thr) {
    label = 'range';
    direction = 'flat';
  } else if (up_excursion >= thr && down_excursion < thr) {
    if (final_delta >=  thr)      { label = 'follow_through'; direction = 'up'; }
    else if (final_delta <= -thr) { label = 'reversal';        direction = 'down'; }
    else                          { label = 'range';           direction = 'flat'; }
  } else if (down_excursion >= thr && up_excursion < thr) {
    if (final_delta <= -thr)      { label = 'follow_through'; direction = 'down'; }
    else if (final_delta >=  thr) { label = 'reversal';        direction = 'up'; }
    else                          { label = 'range';           direction = 'flat'; }
  } else {
    // Both excursions >= thr — tie-break by first chronological cross
    // matching final_delta sign.
    const finalSign = final_delta >= thr ? 'up' : final_delta <= -thr ? 'down' : 'flat';
    if (firstCrossDir == null || finalSign === 'flat') {
      label = 'range'; direction = 'flat';
    } else if (firstCrossDir === finalSign) {
      label = 'follow_through'; direction = finalSign;
    } else {
      label = 'reversal'; direction = finalSign;
    }
  }

  return {
    ok: true,
    label,
    direction,
    C_start, C_end, H_max, L_min, ATR: atr,
    up_excursion, down_excursion, final_delta,
    close_at_window_start: C_start,
    close_at_window_end:   C_end,
    atr_at_window_start:   atr,
    delta_in_atr:          final_delta,
    outcome_window_bar_open_times: fwd.map(b => b.open_time),
    classifier_version:    versions.OUTCOME_CLASSIFIER_VERSION,
    horizon_days:          horizonDays,
  };
}

module.exports = {
  computeATR,
  classifyOutcome,
};
