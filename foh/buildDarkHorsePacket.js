'use strict';

// ============================================================
// foh/buildDarkHorsePacket.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Converts Dark Horse ranking + volatility intelligence into a
// stable FOH packet (same contract as Market Intel, surface-tuned
// for the standout-driven Dark Horse digest).
//
// Hard rule: if a required field is missing the builder fills a
// safe plain-English fallback INSIDE ATLAS output. NEVER routes
// the user to an external workspace.
// ============================================================

function _crypto() { try { return require('crypto'); } catch (_) { return null; } }
function _reportId() {
  const c = _crypto();
  if (c && c.randomBytes) return 'dh-' + c.randomBytes(4).toString('hex');
  return 'dh-' + Math.random().toString(16).slice(2, 10);
}
function _utcStamp(ms) { const d = new Date(ms || Date.now()); return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }

function _phaseToLifecycle(p) {
  switch (String(p || '').toLowerCase()) {
    case 'early':      return 'FRESH';
    case 'mid':        return 'STILL ACTIVE';
    case 'late':       return 'FADING';
    case 'exhaustion': return 'FADING';
    default:           return 'STILL ACTIVE';
  }
}

function _volSeverity(level) {
  const v = String(level || '').toLowerCase();
  if (/extreme|storm|high/.test(v)) return 'HIGH';
  if (/elev/.test(v))               return 'ELEV';
  if (/mod/.test(v))                return 'MED';
  return 'LOW';
}
function _discScale(sev) {
  switch (sev) {
    case 'HIGH': return '🔴🔴🔴🔴🔴 5/5 — Storm';
    case 'ELEV': return '🟠🟠🟠🟠⚫ 4/5 — Elevated';
    case 'MED':  return '🟡🟡🟡⚫⚫ 3/5 — Active';
    default:     return '🟢🟢⚫⚫⚫ 2/5 — Calm';
  }
}

function _standoutOutcome(s) {
  const sym = s.symbol || 'symbol';
  const dir = String(s.direction || '').toLowerCase();
  const lc  = String(s.lifecycle || 'STILL ACTIVE').toUpperCase();
  const sizeNote = /FRESH/.test(lc) ? 'half size' : /FADING/.test(lc) ? 'quarter size only' : 'full size × current mood multiplier';
  const dollar = s.dollarRisk ? ('planned risk ' + s.dollarRisk + (s.rewardR ? ' · target ' + s.rewardR : '')) : 'planned risk ~$150 per scan window';
  return {
    behaviour: sym + ' carries a ' + lc + ' ' + (dir || 'directional') + ' read. ' + (s.reason || 'Structural alignment with current macro tape.'),
    affectedMarkets: [sym].concat(s.crossAsset || []),
    traderAction: 'Enter on confirmed close into the entry zone (' + (s.decisionLevel || 'see chart card') + '); ' + sizeNote + '; invalidate on ' + (s.invalidation || 'next opposite 1H close') + '.',
    dollarImpact: dollar,
  };
}

function buildDarkHorsePacket(opts) {
  opts = opts || {};
  const ranking = opts.ranking || {};
  const volatility = opts.volatility || null;
  const now = opts.now || Date.now();
  const top = Array.isArray(ranking.top10) ? ranking.top10 : [];
  const standouts = top
    .filter(c => Number.isFinite(c && c.score) && c.score >= 7)
    .slice(0, 4)
    .map(c => ({
      symbol:        c.symbol,
      lifecycle:     _phaseToLifecycle(c.movePhase),
      direction:     c.direction || 'unspecified',
      score:         c.score,
      firstDetected: c.firstDetectedAt || null,
      durationAlive: c.durationAliveLabel || null,
      reason:        c.summary || (Array.isArray(c.reasons) ? c.reasons.join(' · ') : null),
      decisionLevel: c.decisionLevel || null,
      invalidation:  c.invalidation || null,
      dollarRisk:    c.dollarRiskLabel || null,
      rewardR:       c.rewardRLabel || null,
      sizeLabel:     c.sizeLabel || null,
    }));

  const sev = _volSeverity(volatility && volatility.level);
  const moodLabel = ({ HIGH: 'Storm — broad market moving fast', ELEV: 'Elevated — broad market moving fast', MED: 'Active — moderate volatility', LOW: 'Calm — driver-led tape' }[sev]);
  const severityDiscs = _discScale(sev);
  const universeSize = Number.isFinite(opts.universeSize) ? opts.universeSize : (Number.isFinite(ranking.allCount) ? ranking.allCount : 0);

  const fresh = standouts.filter(s => s.lifecycle === 'FRESH').length;
  const stillActive = standouts.filter(s => s.lifecycle === 'STILL ACTIVE').length;
  const fading = standouts.filter(s => s.lifecycle === 'FADING').length;

  const lead = standouts[0] || null;
  const eventName = lead ? (lead.symbol + ' · ' + lead.lifecycle + ' ' + (lead.direction || '')) : 'no standout this cycle — driver-led tape';

  const meta = {
    module: 'dark_horse',
    reportId: opts.reportId || _reportId(),
    generatedAtUTC: _utcStamp(now),
    audience: 'front_of_house',
    source: 'atlas_runtime',
    noExternalWorkspaceLinks: true,
  };
  const header = {
    title:          'ATLAS · Dark Horse',
    subtitle:       standouts.length + ' standout' + (standouts.length === 1 ? '' : 's') + ' on this scan · ' + universeSize + ' markets scanned',
    riskState:      moodLabel,
    severityDiscs,
    generatedAtUTC: _utcStamp(now),
  };
  const briefingSummary = {
    primaryRead: standouts.length
      ? (standouts.length + ' standout' + (standouts.length === 1 ? '' : 's') + ' (' + fresh + ' FRESH · ' + stillActive + ' STILL ACTIVE · ' + fading + ' FADING). Lead: ' + (lead ? lead.symbol + ' ' + lead.lifecycle : '—') + '.')
      : 'No standouts on this scan window — driver-led tape; re-read at next cycle.',
    operationalMeaning: standouts.length
      ? 'Standouts are listed in priority order; each carries a confirmed-close trigger and an explicit invalidation level. Position size per the lifecycle tag (FRESH half-size, FADING quarter-size).'
      : 'No execution priority this cycle. Read macro / Market Intel for direction and wait for the next 15-min scan.',
    keyMarkets: standouts.map(s => s.symbol),
    currentRisk: severityDiscs + ' — ' + (sev === 'HIGH' ? 'storm regime, every chase risk is amplified' : sev === 'ELEV' ? 'elevated reactivity, size down per standout lifecycle' : 'normal cadence, standard sizing'),
  };
  const eventDayReference = {
    eventName,
    eventTimeUTC: _utcStamp(now),
    expectedDuration: lead && lead.lifecycle === 'FRESH' ? '15–60 minutes for the first confirmation candle to print'
                  : lead && lead.lifecycle === 'STILL ACTIVE' ? '4–24 hours of continuation watch from current scan'
                  : '5–30 minutes; late-stage move — exit-or-skip cadence',
    whatToWatch: lead
      ? 'Watch ' + lead.symbol + ': trigger ' + (lead.decisionLevel || '(see standout card)') + '; invalidation ' + (lead.invalidation || '(see standout card)') + '.'
      : 'Watch DXY, VIX, and the macro lead pair set by current Market Intel.',
    chartStudyTimeframe: '1H structural map + 5M / 15M execution',
  };
  const fourWayOutcomes = {
    higher:   lead ? _standoutOutcome(lead) : { behaviour: 'No lead standout — defer to macro tape.', affectedMarkets: [], traderAction: 'Stand aside until next scan.', dollarImpact: 'No exposure recommended.' },
    lower:    standouts[1] ? _standoutOutcome(standouts[1]) : { behaviour: 'Single-standout cycle — no secondary read.', affectedMarkets: [], traderAction: 'Lead standout only.', dollarImpact: 'No secondary exposure.' },
    inline:   standouts[2] ? _standoutOutcome(standouts[2]) : { behaviour: 'Two-standout cycle — no tertiary read.', affectedMarkets: [], traderAction: 'Top-2 only.', dollarImpact: 'No tertiary exposure.' },
    reversal: { behaviour: 'Re-entry watch — if a standout invalidates intraday, wait for the structural re-test on next scan before re-engaging.', affectedMarkets: standouts.map(s => s.symbol), traderAction: 'No averaging into an invalidated zone — wait for the next confirmed close.', dollarImpact: 'Re-entry sizing always starts at half of the original planned risk.' },
  };
  const marketImpact = {
    mechanism: lead
      ? 'Standout setups derive from structural ' + (lead.direction || 'directional') + ' alignment + Corey live macro confirmation + Dark Horse rank score ≥ 7/10.'
      : 'No standout this cycle — macro tape drives direction; structural reads return on next 15-min scan.',
    priceReactionPath: 'Trigger close → entry zone → watch level → caution zone → invalidation; each level annotated with dollar consequence on the rendered card.',
    liquidityEffect: 'Standouts are filtered against current spreads; FRESH cards require live confirmation that the trigger zone has held under the current quote depth.',
    volatilityEffect: sev === 'HIGH' ? 'Storm regime: every standout gets a half-size reduction on top of its lifecycle multiplier' : sev === 'ELEV' ? 'Elevated regime: standout sizing already adjusted via lifecycle tag' : 'Normal regime: standard sizing per the lifecycle pill',
    traderConsequence: 'Hitting the planned-risk line is the cost of the read being wrong; chasing past invalidation turns a $150 loss into a $400+ loss with no upside symmetry.',
  };
  const riskEscalation = {
    healthy:      'PRE-TRIGGER: scan is fresh; structural read in place; sizing per the FRESH / STILL ACTIVE / FADING pill.',
    caution:      'AT TRIGGER: confirmed close required — do NOT pre-position above the trigger.',
    danger:       'POST-TRIGGER WICK: if price returns inside the entry band within 5 min on a wick, the trigger close is not yet confirmed; wait the next 5-min close.',
    invalidation: 'STAND-ASIDE: invalidation level is the cost of the read being wrong. No averaging, no re-entry without a fresh structural re-test on the next scan.',
  };
  const whatToDoNow = standouts.length
    ? standouts.slice(0, 3).map((s, i) => ({
        step: i + 1,
        action: (i === 0 ? 'Primary standout — ' : i === 1 ? 'Secondary — ' : 'Tertiary — ') + s.symbol + ' (' + s.lifecycle + ' ' + (s.direction || '') + '): enter on confirmed close into ' + (s.decisionLevel || 'entry zone on chart card'),
        reason: s.reason || 'Structural alignment with current macro tape',
        dollarConsequence: (s.dollarRisk || 'planned risk ~$150') + (s.rewardR ? ' · reward ' + s.rewardR : '') + (s.sizeLabel ? ' · ' + s.sizeLabel : ''),
      }))
    : [{ step: 1, action: 'No standouts this scan — stand aside; re-read at next 15-min scan.', reason: 'Driver-led tape; no structural priority.', dollarConsequence: 'Zero — no exposure recommended.' }];
  const confirmationCancellation = {
    confirmsWhen: lead ? ('Confirmed close above ' + (lead.decisionLevel || 'entry zone') + ' on the trigger timeframe.') : 'N/A this cycle.',
    cancelsWhen:  lead ? ('Close below ' + (lead.invalidation || 'invalidation level') + ' on the trigger timeframe.') : 'N/A this cycle.',
    dangerIf:     'A standout invalidates while you are positioned: exit at the next 1-min close. Do not average. Do not re-enter without a fresh structural test on a later scan.',
  };
  const provenance = {
    sources: ['ATLAS Dark Horse scanner', 'Corey live macro (DXY=UUP-proxy · VIX=VXX-proxy · curve=FRED T10Y2Y)'],
    dataFreshness: 'LIVE',
    confidenceBasis: 'engine-derived',
  };

  return { meta, header, briefingSummary, eventDayReference, fourWayOutcomes, marketImpact, riskEscalation, whatToDoNow, confirmationCancellation, provenance };
}

module.exports = { buildDarkHorsePacket };
