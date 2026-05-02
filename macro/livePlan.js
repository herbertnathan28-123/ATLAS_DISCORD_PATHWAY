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
  lines.push('## Trade Status / Live Plan');
  lines.push('');
  lines.push(`**Symbol:** ${symbol}`);
  lines.push(`**Direction (plain):** ${directionPlain(corey, spidey)}`);
  lines.push(`**Action State:** **${action.state}**`);
  lines.push(`**Execution Authority / Setup Quality:** ${qualityLabel(jane.composite)}`);
  lines.push(`**Entry:** ${structure?.entry != null ? formatLevel(structure.entry, structure.entryExtended) : describeArmedTrigger(structure)}`);
  if (structure?.stopLoss != null) lines.push(`**Stop Loss:** ${formatLevel(structure.stopLoss, structure.stopLossExtended)}`);
  if (structure?.targets?.length)  lines.push(`**Targets:** ${structure.targets.join(' → ')}`);
  lines.push(`**Flow:** ${structure?.flow || 'no clear directional pressure yet'}`);
  lines.push(`**Validity Window:** ${structure?.validityWindow || 'until structure or event resets the read'}`);
  if (structure?.cancellation?.length) lines.push(`**Cancellation Triggers:** ${structure.cancellation.join('; ')}`);
  lines.push(`**Event Risk:** ${evOverride.label || 'no high-impact event in active window'}`);
  lines.push(`**What Needs to Happen Next:** ${nextStep(action, evOverride)}`);
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
function formatLevel(p, ext) { return ext != null ? `${p} (extended ${ext})` : String(p); }
function pct(v) { const n = (v || 0); return (n >= 0 ? '+' : '') + Math.round(n * 100) + '%'; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

module.exports = { build };
