'use strict';
// Spec Part 15 — contradiction checker. Run on the assembled macro string before
// it is sent to Discord. Returns { ok:true } or { ok:false, reason }.
// Caller decides whether to throw, redact, or attach a banner.

function check(text, ctx) {
  const t = text || '';
  const sym = ctx && ctx.symbol;
  const ac = (ctx && ctx.assetClass) || '';
  const blocked = ctx && ctx.blocked;
  const readiness = ctx && Number.isFinite(ctx.readiness) ? ctx.readiness : null;
  const vol = ctx && ctx.vol;
  const ez  = ctx && ctx.entryZone;
  const macroBias = ctx && ctx.macroBias;
  const catalystInside2h = !!(ctx && ctx.catalystInside2h);
  const setupExpired = !!(ctx && ctx.setupExpired);
  const placeholderSent = !!(ctx && ctx.placeholderSent);
  const blankChartSent = !!(ctx && ctx.blankChartSent);
  const requestedSymbol = ctx && ctx.requestedSymbol;
  const renderedSymbol = ctx && ctx.renderedSymbol;
  const fail = function (reason) { return { ok: false, reason: reason }; };

  // 1. Trade Status available + entry-conditions-not-met stated together (contradiction)
  if (/Trade Status[^a-zA-Z]*AVAILABLE/i.test(t) && /ENTRY CONDITIONS NOT MET|TRADE INVALID|ENTRY NOT AVAILABLE/i.test(t)) return fail('status_available_and_entry_conditions_not_met');
  // 2. Market Readiness <= 3/10 + active entry stated
  if (readiness != null && readiness <= 3 && /ENTRY CONFIRMED|TRADE CONFIRMED|execution unlocked/i.test(t)) return fail('readiness_low_but_active_entry');
  // 3. Macro Alignment Strong + macro neutral with no explanation
  if (/Macro Alignment Strong/i.test(t) && /macro engine.{0,30}neutral/i.test(t) && !/although|however|while|despite/i.test(t)) return fail('macro_strong_macro_neutral_no_explanation');
  // 4. VIX Elevated + execution normal
  if (vol === 'High' && /execution conditions are normal/i.test(t)) return fail('vix_elevated_execution_normal');
  // 5. Entry pending + risk/reward calculated
  if ((!ez || ez === 'Pending') && /Reward-to-risk on T1 — 1:|R:R\s*[0-9]|RR\s*[0-9]/i.test(t)) return fail('pending_entry_with_rr_calculated');
  // 6. No entry + stop loss displayed as active number
  if ((!ez || ez === 'Pending') && /STOP LOSS\s*[:=]\s*[0-9]/i.test(t) && !/Not identified|pending|paused/i.test(t)) return fail('no_entry_with_active_stop');
  // 7. Equity output contains pips/standard lot/pair language
  if ((ac === 'equity' || ac === 'index' || ac === 'commodity') && /\bpip\b|\bpips\b|\bstandard lot\b|\bbase currency\b|\bquote currency\b/i.test(t)) return fail('equity_output_contains_fx_language');
  // 8. Neutral macro + "matches the macro direction"
  if (macroBias === 'Neutral' && /matches the macro direction/i.test(t)) return fail('neutral_macro_with_matches_macro');
  // 9. Catalyst inside 2h + active entry stated
  if (catalystInside2h && /(ENTRY CONFIRMED|TRADE CONFIRMED|new entries available)/i.test(t)) return fail('catalyst_inside_2h_with_active_entry');
  // 10. Expired setup + active entry plan
  if (setupExpired && /\*\*ENTRY POINT\*\*[^\n]*[0-9]/.test(t)) return fail('expired_setup_with_active_entry');
  // 11. Placeholder chart sent
  if (placeholderSent) return fail('placeholder_chart_sent');
  // 12. Blank chart sent
  if (blankChartSent) return fail('blank_chart_sent');
  // 13. "confirmation" used without defining confirmation. After the macro
  //     language scrub, BOS / CHoCH become [Structure Break] / [Trend Shift],
  //     so both forms count as a defining token.
  if (/\bconfirmation\b/i.test(t) && !/(BOS|CHoCH|\[Structure Break\]|\[Trend Shift\]|candle close|body close|primary timeframe)/i.test(t)) return fail('confirmation_used_without_definition');
  // 16. Requested symbol differs from rendered symbol
  if (requestedSymbol && renderedSymbol && requestedSymbol !== renderedSymbol) return fail('symbol_requested_vs_rendered_mismatch');
  // 17. Equity symbol receives FX-scale price levels
  if ((ac === 'equity' || ac === 'index') && /\b1\.[0-9]{4,5}\b/.test(t)) return fail('equity_symbol_with_fx_scale_levels');

  return { ok: true };
}

module.exports = { check };
