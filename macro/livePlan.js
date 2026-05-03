'use strict';
// §2 + §11 Trade Status / Live Plan with §5 Final Assessment merged at the bottom of this block.
// Single decisive state per build; missing conditions enumerated explicitly (no "if confirmed" handoff).

const states = require('./actionStates');
const weighting = require('./decisionWeighting');
const { dollars } = require('./language');

function build(input) {
  const { symbol, ctx, structure, calendar, darkHorse, fmp, tagsUsed } = input;
  const corey = coreyBundle(ctx);
  const spidey = structureBundle(structure);
  const evOverride = eventOverrideBundle(calendar);
  const jane = weighting.reconcile({ corey, spidey, eventOverride: evOverride });
  const action = states.resolve({
    janeVerdict: jane.verdict,
    missing: collectMissing({ corey, spidey, evOverride, structure }),
    eventBlock: evOverride.permission,
    structureAgreement: jane.agreement
  });

  if (tagsUsed) tagsUsed.push('execution_authority', 'trigger', 'stop_loss', 'event_risk', 'validity_window', 'flow');

  const lines = [];
  lines.push('## Trade Status / Live Plan — ' + symbol);
  lines.push('');
  lines.push('**ATLAS VERDICT:** **' + action.state + '**');
  lines.push('');
  lines.push('**Plain English:** ' + plainEnglish(action, corey, spidey, evOverride));
  lines.push('');
  lines.push('**Why:** ' + whyParagraph(corey, spidey, evOverride));
  lines.push('');
  const readiness = readinessScoreFromComposite(jane.composite);
  lines.push('**Market Readiness:** ' + readiness + '/10 — ' + readinessExplain(readiness));
  lines.push('');
  lines.push('**Dominant Bias:** ' + dominantBiasLabel(corey, spidey) + ' — ' + dominantBiasExplain(corey, spidey));
  lines.push('');
  lines.push('**Conviction:** ' + convictionLabel(action, jane));
  lines.push('');
  const probs = probabilityModel(corey, spidey, evOverride);
  lines.push('**Most Likely Behaviour:**');
  lines.push('- Continuation — ' + probs.continuation + '% — price attempts to keep following the current dominant direction.');
  lines.push('- Range — ' + probs.range + '% — price moves sideways between nearby liquidity.');
  lines.push('- Reversal — ' + probs.reversal + '% — price rejects current direction and moves the other way.');
  if (probs.note) { lines.push(''); lines.push('*' + probs.note + '*'); }
  lines.push('');
  lines.push('**Trade Permit:** ' + tradePermit(action, readiness, evOverride));
  lines.push('');
  lines.push('### Live Plan');
  lines.push('**Direction (plain):** ' + directionPlain(corey, spidey));
  lines.push('**Execution Authority / Setup Quality:** ' + qualityLabel(jane.composite));
  lines.push('**Entry:** ' + (structure?.entry != null ? formatLevel(structure.entry, structure.entryExtended) : describeArmedTrigger(structure)));
  if (structure?.entry == null) {
    lines.push('**Stop Loss:** Not authorised');
    lines.push('**Target:** Not authorised');
    lines.push('**Invalidation:** Not defined until entry structure forms');
  } else {
    lines.push('**Stop Loss:** ' + (structure?.stopLoss != null ? formatLevel(structure.stopLoss, structure.stopLossExtended) : 'Not authorised'));
    if (structure?.targets?.length) lines.push('**Targets:** ' + structure.targets.join(' → '));
  }
  lines.push('**Flow:** ' + (structure?.flow || 'no clear directional pressure yet'));
  lines.push('**Validity Window:** ' + (structure?.validityWindow || 'until structure or event resets the read'));
  if (structure?.cancellation?.length) lines.push('**Cancellation Triggers:** ' + structure.cancellation.join('; '));
  lines.push('**Event Risk:** ' + (evOverride.label || 'no high-impact event in active window'));
  lines.push('**What Needs to Happen Next:** ' + nextStep(action, evOverride));
  if (darkHorse) {
    lines.push('');
    lines.push(`*Dark Horse flag:* ${darkHorse.score}/10 ${darkHorse.direction || 'Neutral'} — ${darkHorse.summary || 'composite threshold met'}`);
  }

  // §5 Final Assessment merged INSIDE Live Plan — not detached.
  lines.push('');
  lines.push('### Final Assessment');
  lines.push(`Reconciliation: Corey ${pct(corey.score)} | Spidey ${pct(spidey.score)} | Event override ${pct(evOverride.score)} → composite ${pct(jane.composite)}.`);
  lines.push(`Macro-structure agreement: ${jane.agreement ? 'YES' : 'NO'}.`);
  if (action.missing && action.missing.length) {
    lines.push('**Conditions still missing:**');
    for (const m of action.missing) lines.push(`- ${m}`);
  } else {
    lines.push('All required conditions are present for the stated action state.');
  }

  // source_used footer — required logging.
  const sources = [];
  sources.push(`coreyLive=${ctx?.status || 'unknown'}`);
  if (calendar?.snapshot?.health?.source_used) sources.push(`calendar=${calendar.snapshot.health.source_used}`);
  if (fmp && fmp.available)     sources.push('fmp=ok');
  else if (fmp)                 sources.push(`fmp=${fmp.fallback_note || 'unavailable'}`);
  lines.push('');
  lines.push(`*sources: ${sources.join(' | ')}*`);

  return lines.join('\n');
}

function coreyBundle(ctx) {
  const dxyScore = ctx?.dxy?.score ?? 0;
  const vixScore = ctx?.vix?.score ?? 0;
  const yScore   = ctx?.yield?.score ?? 0;
  const score = clamp((-dxyScore * 0.5) + (-vixScore * 0.3) + (yScore * 0.2), -1, 1);
  return { score, dxyBias: ctx?.dxy?.bias, vixLevel: ctx?.vix?.level, yieldRegime: ctx?.yield?.regime };
}
function structureBundle(s) {
  if (!s) return { score: 0, bias: 'unknown' };
  if (typeof s.score === 'number') return { score: clamp(s.score, -1, 1), bias: s.bias || 'unknown' };
  const bias = (s.bias || 'neutral').toLowerCase();
  const conv = clamp(s.conviction || 0, 0, 1);
  const sign = bias.startsWith('bull') ? 1 : bias.startsWith('bear') ? -1 : 0;
  return { score: sign * conv, bias };
}
function eventOverrideBundle(calendar) {
  const intel = calendar?.intel;
  const snap = calendar?.snapshot;
  if (snap?.health && snap.health.available === false)
    return { score: 0, permission: 'BLOCK', label: 'calendar feeds unavailable — entry blocked until at least one feed recovers' };
  if (intel && /EVENT —/.test(intel)) {
    const m = intel.match(/—\s*([\d.]+)h from now/);
    if (m && parseFloat(m[1]) <= 2)
      return { score: 0, permission: 'BLOCK', label: `high-impact event in ${m[1]}h — entry blocked` };
    return { score: 0, permission: 'CAUTION', label: 'high-impact event in next 48h' };
  }
  return { score: 0, permission: 'OPEN', label: null };
}
function collectMissing({ corey, spidey, evOverride, structure }) {
  const out = [];
  if (Math.abs(corey.score) < 0.10) out.push('macro tilt is too neutral to authorise a direction');
  if (Math.abs(spidey.score) < 0.10) out.push('structure has not yet established a directional sequence');
  if (corey.score && spidey.score && Math.sign(corey.score) !== Math.sign(spidey.score))
    out.push('macro and structure disagree on direction');
  if (evOverride.permission === 'BLOCK') out.push(evOverride.label);
  if (structure && !structure.trigger) out.push('no trigger condition has been defined for entry');
  if (structure && structure.stopLoss == null) out.push('stop loss level is not yet defined');
  return out;
}
function directionPlain(corey, spidey) {
  const c = corey.score, s = spidey.score;
  if (c > 0.15 && s > 0.15)   return 'Macro and structure both lean upside — buyers gaining control.';
  if (c < -0.15 && s < -0.15) return 'Macro and structure both lean downside — sellers gaining control.';
  if (c > 0.15 && s < -0.15)  return 'Macro favours upside but structure resists — disagreement, no clean direction yet.';
  if (c < -0.15 && s > 0.15)  return 'Macro favours downside but structure resists — disagreement, no clean direction yet.';
  return 'No strong directional bias yet — conditions building.';
}
function qualityLabel(c) {
  const a = Math.abs(c);
  if (a >= 0.55) return 'A — institutional-grade';
  if (a >= 0.35) return 'B — actionable with discipline';
  if (a >= 0.20) return 'C — developing';
  return 'D — not yet investable';
}
function describeArmedTrigger(s) {
  if (!s) return 'pending — no structure data yet';
  if (s.trigger) return `armed on ${s.trigger}`;
  return 'pending — trigger not defined';
}
function nextStep(action, evOverride) {
  if (evOverride.permission === 'BLOCK') return 'wait for the event window to clear, then re-check structure.';
  if (action.state.startsWith('TRADE') || action.state.startsWith('ENTRY AUTHORISED')) return 'execute on the defined trigger; manage stop loss; do not chase if missed.';
  if (action.state.startsWith('ARMED')) return 'monitor for the trigger condition; do not pre-empt.';
  if (action.state.startsWith('TRIGGER APPROACHING')) return 'prepare order; verify event risk and spread before submission.';
  if (action.state.startsWith('CONDITIONS BUILDING')) return 'wait for one more confirmation candle on the trigger timeframe.';
  return 'stand aside until the listed missing conditions resolve.';
}
function formatLevel(p, ext) { return ext != null ? p + ' (extended ' + ext + ')' : String(p); }
function pct(v) { const n = (v || 0); return (n >= 0 ? '+' : '') + Math.round(n * 100) + '%'; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Spec Part 4 helpers — Trade Status as a decision guide.
function plainEnglish(action, corey, spidey, evOverride) {
  if (action.state.indexOf('TRADE INVALID') >= 0)        return 'The trade idea is invalid right now. Stand aside.';
  if (action.state.indexOf('DO NOT TRADE') >= 0)         return 'Do not trade. Conditions actively contradict any directional plan.';
  if (action.state.indexOf('ENTRY NOT AUTHORISED') >= 0) return 'Entry is not authorised. Either an event blocks new entries, or the structure prerequisites are not in place.';
  if (action.state.indexOf('WAIT — NO TRADE') >= 0)      return 'Wait. No authorised trade right now — conditions are not built.';
  if (action.state.indexOf('HOLD') >= 0)                 return 'Hold. The setup has not matured. Conditions are still building.';
  if (action.state.indexOf('CONDITIONS BUILDING') >= 0)  return 'Conditions are forming but not complete. Keep eyes on the trigger timeframe.';
  if (action.state.indexOf('TRIGGER APPROACHING') >= 0)  return 'A trigger is close. Prepare order; verify spread and event risk.';
  if (action.state.indexOf('ARMED') >= 0)                return 'Armed and waiting for the defined trigger. Do not pre-empt.';
  if (action.state.indexOf('ENTRY AUTHORISED') >= 0)     return 'Entry is authorised on the defined trigger. Manage the stop loss; do not chase if missed.';
  if (action.state.indexOf('TRADE CONFIRMED') >= 0)      return 'Trade is confirmed. Execute on the defined trigger.';
  return 'No directional path is currently authorised.';
}
function whyParagraph(corey, spidey, evOverride) {
  const parts = [];
  if (Math.abs(corey.score) < 0.10)  parts.push('Macro tilt is too neutral to authorise direction');
  else if (corey.score > 0)          parts.push('Macro favours upside (' + pct(corey.score) + ')');
  else                               parts.push('Macro favours downside (' + pct(corey.score) + ')');
  if (Math.abs(spidey.score) < 0.10) parts.push('structure has not established a directional sequence');
  else if (spidey.score > 0)         parts.push('structure is constructive');
  else                               parts.push('structure is heavy');
  if (corey.score && spidey.score && Math.sign(corey.score) !== Math.sign(spidey.score))
    parts.push('macro and structure disagree');
  if (evOverride.permission === 'BLOCK') parts.push(evOverride.label);
  return parts.join('; ') + '.';
}
function readinessScoreFromComposite(c) { return Math.max(0, Math.min(10, Math.round(Math.abs(c) * 10))); }
function readinessExplain(r) {
  if (r >= 8) return 'institutional-grade — most ATLAS conditions satisfied.';
  if (r >= 6) return 'actionable with discipline — majority of ATLAS conditions satisfied.';
  if (r >= 4) return 'developing — half the ATLAS conditions satisfied.';
  if (r >= 1) return 'only ' + r + ' major ATLAS condition' + (r === 1 ? '' : 's') + ' satisfied. The setup is not mature enough for capital.';
  return 'no ATLAS conditions satisfied. Setup is not investable.';
}
function dominantBiasLabel(corey, spidey) {
  const c = corey.score, s = spidey.score;
  if (c > 0.15 && s > 0.15)   return 'Bullish';
  if (c < -0.15 && s < -0.15) return 'Bearish';
  if (Math.abs(c) < 0.10 && Math.abs(s) < 0.10) return 'Neutral';
  return 'Mixed';
}
function dominantBiasExplain(corey, spidey) {
  const lbl = dominantBiasLabel(corey, spidey);
  if (lbl === 'Bullish') return 'macro and structure both lean upside.';
  if (lbl === 'Bearish') return 'macro and structure both lean downside.';
  if (lbl === 'Mixed')   return 'macro and structure disagree — neither side has full control.';
  return 'ATLAS cannot choose buy or sell with enough confidence.';
}
function convictionLabel(action, jane) {
  if (/DO NOT TRADE|TRADE INVALID|ENTRY NOT AUTHORISED|WAIT — NO TRADE|HOLD/i.test(action.state))
    return 'No authorised trade conviction. This does not mean price will not move. It means the system does not have enough clean evidence to risk capital.';
  const a = Math.abs(jane.composite);
  if (a >= 0.55) return 'A — institutional-grade conviction.';
  if (a >= 0.35) return 'B — actionable with discipline.';
  if (a >= 0.20) return 'C — developing; do not size up.';
  return 'No authorised trade conviction.';
}
function probabilityModel(corey, spidey, evOverride) {
  // Composite-driven probabilities; deliberately conservative so that close
  // splits (<5pp) trigger the "no edge" note per spec Part 4.
  const cont = Math.round(40 + Math.abs(corey.score + spidey.score) * 25);
  const rev  = Math.round(20 + Math.abs(corey.score - spidey.score) * 30);
  const range = Math.max(0, 100 - cont - rev);
  const arr = [['continuation', cont], ['range', range], ['reversal', rev]].sort((a, b) => b[1] - a[1]);
  const note = (arr[0][1] - arr[1][1]) < 5
    ? 'The leading path is not strong enough to create an edge.'
    : null;
  return { continuation: cont, range: range, reversal: rev, note: note };
}
function tradePermit(action, readiness, evOverride) {
  if (/DO NOT TRADE|TRADE INVALID|ENTRY NOT AUTHORISED|WAIT — NO TRADE|HOLD/i.test(action.state)) return 'BLOCKED — see missing conditions below.';
  if (readiness <= 3) return 'BLOCKED — Market Readiness ' + readiness + '/10.';
  if (evOverride.permission === 'BLOCK') return 'BLOCKED — ' + evOverride.label;
  if (/ENTRY AUTHORISED|TRADE CONFIRMED/i.test(action.state)) return 'AVAILABLE on the defined trigger.';
  return 'PENDING — armed/approach state; not yet AVAILABLE.';
}

module.exports = { build };

