'use strict';
// §2 + §11 Trade Status / Final Assessment merged into one block.
// Operator-facing wording per the locked dashboard/macro standard:
//   - Verdict strip: Target Status / Buyer-Seller Control / Setup Quality
//     / Execution Confidence / Next Review.
//   - No "AUTHORISED" / "TRIGGER" / "BLOCKED" / "WITHHELD" / "PERMITTED" /
//     "PERMISSION" / "Trade Probability" / "Corey" / "Spidey" / "Jane" in
//     user-facing copy. Internal enum keys are preserved.

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

  if (tagsUsed) tagsUsed.push('execution_confidence', 'confirmation', 'stop_loss', 'event_risk', 'validity_window', 'flow');

  const hasEntry = structure?.entry != null;

  const lines = [];
  lines.push('## TRADE STATUS / FINAL ASSESSMENT — ' + symbol);
  lines.push('');
  lines.push('**ATLAS VERDICT:** **' + action.state + '**');
  lines.push('');
  lines.push('**Plain English:** ' + plainEnglish(action));
  lines.push('');
  lines.push('**Why:** ' + whyParagraph(corey, spidey, evOverride));
  lines.push('');
  const readiness = readinessScoreFromComposite(jane.composite);
  const readinessDisc = readinessDiscScale(readiness);
  lines.push('**Read Maturity:** ' + readiness + '/10  ·  ' + readinessDisc + ' — ' + readinessExplain(readiness));
  lines.push('');

  // Verdict strip — five locked fields.
  lines.push('**Target Status:** ' + targetStatus(action, hasEntry));
  lines.push('**Buyer / Seller Control:** ' + buyerSellerControl(corey, spidey));
  lines.push('**Setup Quality:** ' + qualityLabel(jane.composite));
  lines.push('**Execution Confidence:** ' + executionConfidence(action, jane));
  lines.push('**Next Review:** ' + nextReview(structure));
  lines.push('');

  const probs = probabilityModel(corey, spidey);
  lines.push('**Most Likely Behaviour:**');
  lines.push('- Continuation — ' + probs.continuation + '% — price attempts to keep following the current dominant direction.');
  lines.push('- Range — ' + probs.range + '% — price not establishing a directional move; rotates between nearby liquidity.');
  lines.push('- Reversal — ' + probs.reversal + '% — price rejects the current direction and moves the other way.');
  if (probs.note) { lines.push(''); lines.push('*' + probs.note + '*'); }
  lines.push('');

  lines.push('### Live Plan');
  lines.push('**Direction (plain):** ' + directionPlain(corey, spidey));
  if (!hasEntry) {
    lines.push('**ANALYSED TARGETS:** NO VALID BUY OR SELL TARGET IDENTIFIED');
    lines.push('**Entry Point:** Not identified yet');
    lines.push('**Exit Point:** Not identified yet');
    lines.push('**Set Stop Loss:** Not identified yet');
    lines.push('**Extended Stop Loss:** Not identified yet');
    lines.push('**Invalidation:** Not defined until entry structure forms');
  } else {
    lines.push('**Entry Point:** ' + formatLevel(structure.entry, structure.entryExtended));
    lines.push('**Set Stop Loss:** ' + (structure?.stopLoss != null ? formatLevel(structure.stopLoss, structure.stopLossExtended) : 'Not identified yet'));
    lines.push('**Extended Stop Loss:** ' + (structure?.stopLossExtended != null ? String(structure.stopLossExtended) : 'Not identified yet'));
    lines.push('**Select ONE stop loss only.**');
    if (structure?.targets?.length) lines.push('**Exit Points:** ' + structure.targets.join(' → '));
  }
  lines.push('**Flow:** ' + (structure?.flow || 'no clear directional pressure yet'));
  lines.push('**Validity Window:** ' + planValidityWindow(structure));
  if (structure?.cancellation?.length) lines.push('**Cancellation Conditions:** ' + structure.cancellation.join('; '));
  lines.push('**Event Risk:** ' + (evOverride.label || 'no high-impact event in active window'));
  lines.push('**What Needs to Happen Next:** ' + nextStep(action, evOverride));
  if (darkHorse) {
    lines.push('');
    lines.push(`*Dark Horse flag:* ${darkHorse.score}/10 ${darkHorse.direction || 'Neutral'} — ${darkHorse.summary || 'composite threshold met'}`);
  }

  // §5 Final Assessment merged INSIDE Trade Status.
  lines.push('');
  lines.push('### Final Assessment');
  lines.push(`Reconciliation: macro ${pct(corey.score)} | structure ${pct(spidey.score)} | event override ${pct(evOverride.score)} → composite ${pct(jane.composite)}.`);
  lines.push(`Macro / structure agreement: ${jane.agreement ? 'YES' : 'NO'}.`);
  if (action.missing && action.missing.length) {
    lines.push('**Conditions still missing:**');
    for (const m of action.missing) lines.push(`- ${m}`);
  } else {
    lines.push('All required conditions are present for the stated action state.');
  }

  // Source/provenance line is OFF by default on the user surface
  // (operator wording standard). Gate behind ATLAS_DEBUG_AUX=1 for
  // operator/audit visibility. Console always logs the digest.
  const sources = [];
  sources.push(`market data=${ctx?.status || 'unknown'}`);
  if (calendar?.snapshot?.health?.source_used) sources.push(`calendar=${calendar.snapshot.health.source_used}`);
  if (fmp && fmp.available)     sources.push('fmp=ok');
  else if (fmp)                 sources.push(`fmp=${fmp.fallback_note || 'pending'}`);
  console.log('[LIVEPLAN-SOURCES] ' + sources.join(' | '));
  if (process.env.ATLAS_DEBUG_AUX === '1') {
    lines.push('');
    lines.push(`*sources: ${sources.join(' | ')}*`);
  }

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
    return { score: 0, permission: 'BLOCK', label: 'calendar feeds pending — entries paused until at least one feed recovers' };
  if (intel && /EVENT —/.test(intel)) {
    const m = intel.match(/—\s*([\d.]+)h from now/);
    if (m && parseFloat(m[1]) <= 2)
      return { score: 0, permission: 'BLOCK', label: `high-impact event in ${m[1]}h — entries paused` };
    return { score: 0, permission: 'CAUTION', label: 'high-impact event in next 48h' };
  }
  return { score: 0, permission: 'OPEN', label: null };
}
function collectMissing({ corey, spidey, evOverride, structure }) {
  const out = [];
  if (Math.abs(corey.score) < 0.10) out.push('macro tilt is too neutral to assert a direction');
  if (Math.abs(spidey.score) < 0.10) out.push('structure has not yet established a directional sequence');
  if (corey.score && spidey.score && Math.sign(corey.score) !== Math.sign(spidey.score))
    out.push('macro and structure disagree on direction');
  if (evOverride.permission === 'BLOCK') out.push(evOverride.label);
  if (structure && !structure.trigger) out.push('no buyer or seller control level is currently reliable enough to publish');
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
function nextStep(action, evOverride) {
  if (evOverride.permission === 'BLOCK') return 'wait for the event window to clear, then re-check structure.';
  if (action.state.startsWith('TRADE') || action.state.startsWith('ENTRY CONFIRMED')) return 'execute on the published buyer or seller control level; manage stop loss; do not chase if missed.';
  if (action.state.startsWith('ARMED')) return 'monitor for the buyer or seller control level to publish; do not pre-empt.';
  if (action.state.startsWith('CONFIRMATION APPROACHING')) return 'prepare order; verify event risk and spread before submission.';
  if (action.state.startsWith('CONDITIONS BUILDING')) return 'wait for one more full candle body close beyond the primary level on the primary timeframe.';
  return 'entry conditions not met — monitor for confirmation (full candle body close on the primary timeframe) until ATLAS publishes a reliable buyer or seller control level.';
}
function formatLevel(p, ext) { return ext != null ? p + ' (extended ' + ext + ')' : String(p); }
function pct(v) { const n = (v || 0); return (n >= 0 ? '+' : '') + Math.round(n * 100) + '%'; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Spec Part 4 helpers — Trade Status as a decision guide. Operator-facing.
function plainEnglish(action) {
  if (action.state.indexOf('TRADE INVALID') >= 0)         return 'The trade idea is invalid right now. Entry conditions not met — monitor for confirmation.';
  if (action.state.indexOf('NO ACTIVE TRADE — ENTRY CONDITIONS NOT MET') >= 0) return 'Entry not probable for this validity window. Conditions actively contradict any directional plan.';
  if (action.state.indexOf('ENTRY NOT AVAILABLE') >= 0)   return 'Entry is not available. Either an event window is active, or the structure prerequisites are not in place.';
  if (action.state.indexOf('HOLD — NO ACTIVE') >= 0)      return 'Hold. The setup has not matured. Conditions are still building.';
  if (action.state.indexOf('CONDITIONS BUILDING') >= 0)   return 'Conditions are forming but not complete. Keep eyes on the primary timeframe.';
  if (action.state.indexOf('CONFIRMATION APPROACHING') >= 0) return 'A confirmation is close. Prepare order; verify spread and event risk.';
  if (action.state.indexOf('ARMED') >= 0)                 return 'Armed and waiting for the defined confirmation. Do not pre-empt.';
  if (action.state.indexOf('ENTRY CONFIRMED') >= 0)       return 'Entry is confirmed on the defined confirmation. Manage the stop loss; do not chase if missed.';
  if (action.state.indexOf('TRADE CONFIRMED') >= 0)       return 'Trade is confirmed. Execute on the defined confirmation.';
  return 'No directional path is currently confirmed.';
}
function whyParagraph(corey, spidey, evOverride) {
  const parts = [];
  if (Math.abs(corey.score) < 0.10)  parts.push('Macro tilt is too neutral to assert direction');
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
// 1-5 dot scale alongside the /10 score per CLAUDE.md §3 ("Sentiment
// system: Dominant bias on 1–5 dot scale"). Same v6 traffic-light
// glyph family as the Dark Horse FOH Market Mood + the macro
// eventIntelligence Sentiment header — keeps every Pack-3 surface
// visually consistent. Mapping: 0-1 → 1/5, 2-3 → 2/5, 4-5 → 3/5,
// 6-7 → 4/5, 8-10 → 5/5.
function readinessDiscScale(readinessOutOf10) {
  const r = Math.max(0, Math.min(10, Number(readinessOutOf10) || 0));
  const active = r >= 8 ? 5 : r >= 6 ? 4 : r >= 4 ? 3 : r >= 2 ? 2 : 1;
  const glyph = active >= 4 ? '🟢' : active === 3 ? '🟠' : active === 2 ? '🟡' : '🔴';
  return glyph.repeat(active) + '⚫'.repeat(5 - active) + ' ' + active + '/5';
}
function readinessExplain(r) {
  if (r >= 8) return 'institutional-grade — most ATLAS conditions satisfied.';
  if (r >= 6) return 'actionable with discipline — majority of ATLAS conditions satisfied.';
  if (r >= 4) return 'developing — half the ATLAS conditions satisfied.';
  if (r >= 1) return 'only ' + r + ' major ATLAS condition' + (r === 1 ? '' : 's') + ' satisfied. The setup is not mature enough for capital.';
  return 'no ATLAS conditions satisfied. Setup is not yet investable.';
}
function buyerSellerControl(corey, spidey) {
  const c = corey.score, s = spidey.score;
  if (c > 0.15 && s > 0.15)                       return 'Buyers in control';
  if (c < -0.15 && s < -0.15)                     return 'Sellers in control';
  if (Math.abs(c) < 0.10 && Math.abs(s) < 0.10)   return 'Balanced — neither side in control';
  return 'Mixed — buyers and sellers contesting';
}
function targetStatus(action, hasEntry) {
  if (/ENTRY CONDITIONS NOT MET|TRADE INVALID/.test(action.state))     return 'No valid target identified';
  if (/HOLD — NO ACTIVE TRADE/.test(action.state))       return 'No valid target identified yet';
  if (/CONDITIONS BUILDING/.test(action.state))          return 'Building';
  if (/CONFIRMATION APPROACHING/.test(action.state))     return 'Confirmation close';
  if (/ARMED/.test(action.state))                        return 'Active read — armed';
  if (/ENTRY CONFIRMED|TRADE CONFIRMED/.test(action.state)) return 'Active read';
  if (/ENTRY NOT AVAILABLE/.test(action.state))          return 'Read paused — event window active';
  return hasEntry ? 'Active read' : 'No valid target identified yet';
}
function executionConfidence(action, jane) {
  if (/ENTRY CONDITIONS NOT MET|TRADE INVALID|HOLD — NO ACTIVE/.test(action.state))
    return 'Insufficient — entry conditions not met; monitor for confirmation (full candle body close on the primary timeframe) until conditions stack.';
  const a = Math.abs(jane.composite);
  if (a >= 0.55) return 'High — institutional-grade';
  if (a >= 0.35) return 'Medium — actionable with discipline';
  if (a >= 0.20) return 'Low — developing';
  return 'Insufficient';
}
function nextReview(structure) {
  // Allow upstream override only when the value is operator-facing (no
  // engine narration like "primary-timeframe close"). Otherwise compute
  // exact UTC + AWST from structure.nextReviewMinutes / structure.
  // nextReviewExpiryUtc, defaulting to +1 hour.
  if (structure && typeof structure.nextReview === 'string' && structure.nextReview && !/primary-timeframe close|event-window boundary|whichever comes sooner/i.test(structure.nextReview)) {
    return structure.nextReview;
  }
  let d;
  if (structure && structure.nextReviewExpiryUtc) {
    const t = Date.parse(structure.nextReviewExpiryUtc);
    d = Number.isFinite(t) ? new Date(t) : new Date(Date.now() + 60 * 60 * 1000);
  } else if (structure && Number.isFinite(structure.nextReviewMinutes) && structure.nextReviewMinutes > 0) {
    d = new Date(Date.now() + structure.nextReviewMinutes * 60 * 1000);
  } else {
    d = new Date(Date.now() + 60 * 60 * 1000);
  }
  const pad = function (n) { return n < 10 ? '0' + n : n; };
  const utc  = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  const a    = new Date(d.getTime() + 8 * 3600 * 1000);
  const awst = pad(a.getUTCHours()) + ':' + pad(a.getUTCMinutes()) + ' AWST';
  return utc + ' / ' + awst + ', or earlier if buyer/seller control changes before then.';
}

// Render the Live Plan's Validity Window using exact UTC + AWST when no
// upstream descriptor is supplied. Mirrors the VALIDITY block format so
// the user reads the same expiry shape in both places. Default expiry is
// 4 hours from build time when no minutes/expiry hint is supplied.
function planValidityWindow(structure) {
  if (structure && typeof structure.validityWindow === 'string' && structure.validityWindow && !/until structure or event resets/i.test(structure.validityWindow)) {
    return structure.validityWindow;
  }
  let d;
  if (structure && structure.validityExpiryUtc) {
    const t = Date.parse(structure.validityExpiryUtc);
    d = Number.isFinite(t) ? new Date(t) : new Date(Date.now() + 4 * 3600 * 1000);
  } else if (structure && Number.isFinite(structure.validityMinutes) && structure.validityMinutes > 0) {
    d = new Date(Date.now() + structure.validityMinutes * 60 * 1000);
  } else {
    d = new Date(Date.now() + 4 * 3600 * 1000);
  }
  const pad = function (n) { return n < 10 ? '0' + n : n; };
  const utc  = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  const a    = new Date(d.getTime() + 8 * 3600 * 1000);
  const awst = pad(a.getUTCHours()) + ':' + pad(a.getUTCMinutes()) + ' AWST';
  return 'Valid until ' + utc + ' / ' + awst + ', or earlier if buyer/seller control changes before then.';
}
function probabilityModel(corey, spidey) {
  // Composite-driven probabilities; deliberately conservative so close
  // splits (<5pp) trigger the "no edge" note per spec Part 4.
  const cont = Math.round(40 + Math.abs(corey.score + spidey.score) * 25);
  const rev  = Math.round(20 + Math.abs(corey.score - spidey.score) * 30);
  const range = Math.max(0, 100 - cont - rev);
  const arr = [['continuation', cont], ['range', range], ['reversal', rev]].sort((a, b) => b[1] - a[1]);
  const note = (arr[0][1] - arr[1][1]) < 5
    ? 'The leading path is not strong enough to identify a reliable buy or sell target.'
    : null;
  return { continuation: cont, range: range, reversal: rev, note: note };
}

module.exports = { build };
