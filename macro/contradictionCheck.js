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

  // 1. Trade Permit available + Trade Blocked
  if (/Trade permit is AVAILABLE/i.test(t) && /TRADE BLOCKED|DO NOT TRADE|TRADE INVALID|ENTRY NOT AUTHORISED/i.test(t)) return fail('permit_available_and_blocked');
  // 2. Market Readiness <= 3/10 + execution unlocked
  if (readiness != null && readiness <= 3 && /execution unlocked|TRADE PERMIT AVAILABLE|ENTRY AUTHORISED|TRADE CONFIRMED/i.test(t)) return fail('readiness_low_but_execution_unlocked');
  // 3. Macro Alignment Strong + Corey Neutral with no explanation
  if (/Macro Alignment Strong/i.test(t) && /Corey.{0,30}neutral/i.test(t) && !/although|however|while|despite/i.test(t)) return fail('macro_strong_corey_neutral_no_explanation');
  // 4. VIX Elevated + execution normal
  if (vol === 'High' && /execution conditions are normal/i.test(t)) return fail('vix_elevated_execution_normal');
  // 5. Entry pending + risk/reward calculated
  if ((!ez || ez === 'Pending') && /Reward-to-risk on T1 — 1:|R:R\s*[0-9]|RR\s*[0-9]/i.test(t)) return fail('pending_entry_with_rr_calculated');
  // 6. No entry + stop loss displayed as active
  if ((!ez || ez === 'Pending') && /STOP LOSS\s*[:=]\s*[0-9]/i.test(t) && !/Not authorised|pending/i.test(t)) return fail('no_entry_with_active_stop');
  // 7. Equity output contains pips/standard lot/pair language
  if ((ac === 'equity' || ac === 'index' || ac === 'commodity') && /\bpip\b|\bpips\b|\bstandard lot\b|\bbase currency\b|\bquote currency\b/i.test(t)) return fail('equity_output_contains_fx_language');
  // 8. Neutral macro + "matches the macro direction"
  if (macroBias === 'Neutral' && /matches the macro direction/i.test(t)) return fail('neutral_macro_with_matches_macro');
  // 9. Catalyst inside 2h + new entry permitted
  if (catalystInside2h && /(Trade permit is AVAILABLE|ENTRY AUTHORISED|TRADE CONFIRMED|new entries permitted)/i.test(t)) return fail('catalyst_inside_2h_with_permit_available');
  // 10. Expired setup + active entry plan
  if (setupExpired && /\*\*ENTRY\*\*[^\n]*[0-9]/.test(t)) return fail('expired_setup_with_active_entry');
  // 11. Placeholder chart sent
  if (placeholderSent) return fail('placeholder_chart_sent');
  // 12. Blank chart sent
  if (blankChartSent) return fail('blank_chart_sent');
  // 13. Missing exact trigger level
  if (/TRIGGER MAP/i.test(t) && !/Level:\s*[\$0-9]/i.test(t) && !/Exact shift level unavailable/i.test(t)) return fail('trigger_map_missing_levels');
  // 14. Missing exact timeframe
  if (/TRIGGER MAP/i.test(t) && !/(15M|30M|1H|4H|1D)/i.test(t)) return fail('trigger_map_missing_timeframe');
  // 15. "confirmation" used without defining confirmation
  if (/\bconfirmation\b/i.test(t) && !/(BOS|CHoCH|candle close|structure break|body close)/i.test(t)) return fail('confirmation_used_without_definition');
  // 16. Requested symbol differs from rendered symbol
  if (requestedSymbol && renderedSymbol && requestedSymbol !== renderedSymbol) return fail('symbol_requested_vs_rendered_mismatch');
  // 17. Equity symbol receives FX-scale price levels
  if ((ac === 'equity' || ac === 'index') && /\b1\.[0-9]{4,5}\b/.test(t)) return fail('equity_symbol_with_fx_scale_levels');

  return { ok: true };
}

module.exports = { check };
