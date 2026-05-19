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
const { buildPlanFromEvidence } = require('./darkHorsePricePoints');
// Plain-English jargon scrubber — keeps HH/HL / LH/LL / HTF / LTF
// out of user-facing FOH copy (operator brief 2026-05-18). The
// upstream scoring engine legitimately uses the chart-shorthand in
// `r.reason` / `r.reasons`, so we translate at the FOH output
// boundary rather than touching scoring logic.
const { _translateChartJargon } = require('../darkHorseRanking');
function _scrubJargon(text) {
  return typeof _translateChartJargon === 'function' ? _translateChartJargon(text) : text;
}

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
// Operator brief 2026-05-17: colour-coded severity discs.
//   EXTREME = full red (5/5)
//   HIGH    = red (4/5)
//   ELEV    = orange (4/5)
//   MED     = orange (3/5)
//   LOW     = blue / cyan (2/5)
function _discScale(sev) {
  switch (String(sev || '').toUpperCase()) {
    case 'EXTREME':
    case 'STORM': return '🔴🔴🔴🔴🔴 5/5 — Extreme';
    case 'HIGH':  return '🔴🔴🔴🔴⚫ 4/5 — High';
    case 'ELEV':  return '🟠🟠🟠🟠⚫ 4/5 — Elevated';
    case 'MED':   return '🟠🟠🟠⚫⚫ 3/5 — Medium';
    case 'LOW':   return '🔵🔵⚫⚫⚫ 2/5 — Low';
    default:      return '🔵⚫⚫⚫⚫ 1/5 — Calm';
  }
}

// Operationally-anchored directional doctrine (operator 2026-05-17).
// Same 6-element shape as the MI packet's _anchoredAction.
function _anchoredAction(opts) {
  return {
    instrument:              opts.instrument               || '—',
    priceLevel:              opts.priceLevel               || '—',
    behavioralExplanation:   opts.behavioralExplanation    || '—',
    confirmsContinuation:    Array.isArray(opts.confirmsContinuation)    && opts.confirmsContinuation.length    ? opts.confirmsContinuation    : ['—'],
    invalidatesContinuation: Array.isArray(opts.invalidatesContinuation) && opts.invalidatesContinuation.length ? opts.invalidatesContinuation : ['—'],
    probableNextPath:        Array.isArray(opts.probableNextPath)        && opts.probableNextPath.length        ? opts.probableNextPath        : ['—'],
    probableFailurePath:     Array.isArray(opts.probableFailurePath)     && opts.probableFailurePath.length     ? opts.probableFailurePath     : ['—'],
  };
}

function _standoutOutcome(s) {
  const sym = s.symbol || 'symbol';
  const dir = String(s.direction || '').toLowerCase();
  const lc  = String(s.lifecycle || 'STILL ACTIVE').toUpperCase();
  const sizeNote = /FRESH/.test(lc) ? 'fresh-card account-risk cap' : /FADING/.test(lc) ? 'late-stage account-risk cap' : 'standard account-risk cap after confirmation';
  const trigger = s.decisionLevel || 'entry zone on chart card';
  const invalid = s.invalidation || 'next opposite 1H close';
  const plan = s.pricePointPlan || null;
  const entryReference = plan ? plan.entryReferencePrice : trigger;
  const invalidationExit = plan ? plan.invalidationExitPrice : invalid;
  const confirmation = plan ? plan.confirmationCondition : ('confirmed close in the ' + (dir || 'directional') + ' direction through ' + trigger);
  const accountRisk = plan ? plan.riskBasis : 'Account-percentage risk only; size so loss at invalidation remains inside the card risk cap.';
  const directionWord = /bear|short|down/.test(dir) ? 'downside' : 'upside';
  const oppositeWord = directionWord === 'downside' ? 'upside' : 'downside';
  return {
    behaviour: sym + ' carries a ' + lc + ' ' + (dir || 'directional') + ' read. ' + _scrubJargon(s.reason || 'Structural alignment with current macro tape.'),
    affectedMarkets: [sym].concat(s.crossAsset || []),
    traderAction: _anchoredAction({
      instrument: sym,
      priceLevel: 'Entry reference ' + entryReference + ' · invalidation / exit ' + invalidationExit + ' (' + sizeNote + ')',
      behavioralExplanation: sym + ' ' + directionWord + ' participation is considered only after this confirmation condition: ' + confirmation + ' ' + accountRisk,
      confirmsContinuation: [
        confirmation,
        'next candle holds the trigger as new support/resistance without retracing back inside',
        'momentum expands in the ' + directionWord + ' direction on the confirmation candle',
      ],
      invalidatesContinuation: [
        'price closes through invalidation / exit ' + invalidationExit + ' on the trigger timeframe',
        'candle bodies shrinking after the initial confirmation — momentum exhausting',
        'cross-asset (DXY / VIX / lead pair) loses confirmation alignment',
      ],
      probableNextPath: [
        'price extends ' + directionWord + ' toward the next liquidity zone after entry reference ' + entryReference,
        'standout stays valid through the next 15-min scan window if structure holds',
        plan ? 'technical distance: ' + plan.technicalDistance + ' · Minimum ATLAS Buffer: ' + plan.minimumAtlasBuffer : 'technical distance and Minimum ATLAS Buffer shown on card when anchors are available',
      ],
      probableFailurePath: [
        'confirmation candle gets faded inside the next 15 minutes',
        'price returns inside the entry band, invalidating the ' + directionWord + ' read',
        'standout drops to ' + oppositeWord + ' watch on the next ATLAS scan — re-entry only after a fresh structural test',
      ],
    }),
    dollarImpact: plan
      ? 'Account-risk cap: ' + plan.riskCap.text + ' · technical distance ' + plan.technicalDistance + ' · unit type ' + plan.unitType + ' · buffer reason: ' + plan.bufferReason
      : 'Account-risk cap applies only after entry, confirmation, and invalidation / exit are published.',
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
    .map(c => {
      const lifecycle = _phaseToLifecycle(c.movePhase);
      const pricePointPlan = buildPlanFromEvidence(c, volatility, { stage: lifecycle });
      return {
        symbol:        c.symbol,
        lifecycle,
        direction:     c.direction || 'unspecified',
        score:         c.score,
        firstDetected: c.firstDetectedAt || null,
        durationAlive: c.durationAliveLabel || null,
        reason:        _scrubJargon(c.summary || (Array.isArray(c.reasons) ? c.reasons.join(' · ') : null)),
        decisionLevel: pricePointPlan ? pricePointPlan.entryReferencePrice : (c.decisionLevel || null),
        invalidation:  pricePointPlan ? pricePointPlan.invalidationExitPrice : (c.invalidation || null),
        dollarRisk:    c.dollarRiskLabel || null,
        rewardR:       c.rewardRLabel || null,
        sizeLabel:     c.sizeLabel || null,
        pricePointPlan,
      };
    });

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
      : 'No standouts on this scan window — no symbol cleared publication threshold; re-read at the next 15-min scan.',
    operationalMeaning: standouts.length
      ? 'Standouts are listed in priority order; each carries a confirmed-close trigger and an explicit invalidation level. Position size per the lifecycle tag (FRESH half-size, FADING quarter-size).'
      : 'No live standout this cycle. Why: no symbol cleared the WATCH / publication threshold (score ≥ 8/10); strongest candidates remain watch-band only. Changes if: a candidate clears the WATCH threshold on the next 15-min scan, or volatility / session conditions change.',
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
  // Operationally-anchored stub used when a slot has no standout
  // — still emits all 6 doctrine elements so the contract holds
  // (operator 2026-05-17). The view-model adapter renders it into
  // the same 6-element block as a live standout slot.
  const _emptyAnchored = (note) => _anchoredAction({
    instrument: 'no instrument this slot',
    priceLevel: 'no anchor — defer to next ATLAS scan (15 min cadence)',
    behavioralExplanation: note + ' Stand aside until a structural read prints on the next scan.',
    confirmsContinuation: ['next ATLAS scan publishes a fresh standout in this slot', 'cross-asset macro tape confirms a directional read', 'volatility regime stays inside current band'],
    invalidatesContinuation: ['no standout prints on the next scan', 'macro tape flips regime inside the window', 'volatility breaks out of the current band'],
    probableNextPath: ['driver-led tape continues until the next standout prints', 'macro / Market Intel surface carries the directional anchor'],
    probableFailurePath: ['premature re-entry without a fresh structural test', 'sizing up into thin liquidity ahead of the next scan'],
  });
  const fourWayOutcomes = {
    higher:   lead ? _standoutOutcome(lead) : { behaviour: 'No lead standout — defer to macro tape.', affectedMarkets: [], traderAction: _emptyAnchored('No lead standout this scan cycle.'), dollarImpact: 'No exposure recommended.' },
    lower:    standouts[1] ? _standoutOutcome(standouts[1]) : { behaviour: 'Single-standout cycle — no secondary read.', affectedMarkets: [], traderAction: _emptyAnchored('Lead standout only this scan cycle.'), dollarImpact: 'No secondary exposure.' },
    inline:   standouts[2] ? _standoutOutcome(standouts[2]) : { behaviour: 'Two-standout cycle — no tertiary read.', affectedMarkets: [], traderAction: _emptyAnchored('Top-2 standouts only this scan cycle.'), dollarImpact: 'No tertiary exposure.' },
    reversal: {
      behaviour: 'Re-entry watch — if a standout invalidates intraday, wait for the structural re-test on next scan before re-engaging.',
      affectedMarkets: standouts.map(s => s.symbol),
      traderAction: _anchoredAction({
        instrument: lead ? lead.symbol : 'any standout that invalidates intraday',
        priceLevel: lead ? ((lead.pricePointPlan ? lead.pricePointPlan.invalidationExitPrice : lead.invalidation) || 'invalidation / exit level on the chart card') + ' (re-entry only on a fresh structural test)' : 'invalidation / exit level on the chart card',
        behavioralExplanation: 'When a standout closes through its invalidation level, the original read is OFF. Re-entry is only valid AFTER price returns to and respects the level on a FRESH 15-min close — not on a wick, not on the same scan.',
        confirmsContinuation: [
          '15-min candle closes back through the invalidation level in the original direction',
          'next 15-min candle holds the level as new support/resistance',
          'cross-asset (DXY / VIX) re-aligns with the original direction',
        ],
        invalidatesContinuation: [
          'price stays on the wrong side of the invalidation level for two consecutive 15-min closes',
          'standout drops off the next ATLAS scan',
          'opposite-direction standout appears on the next scan',
        ],
        probableNextPath: [
          're-entry sizing always starts at half the original account-risk cap',
          'standout re-rates back into FRESH on the next clean structural test',
        ],
        probableFailurePath: [
          'averaging into the invalidated zone before the structural re-test',
          'doubling planned risk to "win back" the original loss',
          'taking the same trade three times in one session before ATLAS publishes a fresh read',
        ],
      }),
      dollarImpact: 'Re-entry sizing always starts at half of the original account-risk cap.',
    },
  };
  const marketImpact = {
    mechanism: lead
      ? 'Standout setups derive from structural ' + (lead.direction || 'directional') + ' alignment + Corey live macro confirmation + Dark Horse rank score ≥ 7/10.'
      : 'No live standout cleared the publication threshold this cycle. Internal candidates exist but remain below the publication grade (score < 8/10). Volatility / risk state may be elevated; the next 15-min scan re-checks the candidate set.',
    priceReactionPath: 'Confirmation close → entry reference → watch level → caution zone → invalidation / exit; each card separates account-risk cap from technical distance.',
    liquidityEffect: standouts.length
      ? 'Standouts are filtered against current spreads; newly-promoted standouts require live confirmation that the trigger zone has held under current quote depth.'
      : 'No standouts to filter against current spreads this cycle.',
    volatilityEffect: sev === 'HIGH' ? 'Storm regime: every standout gets a half-size reduction on top of its lifecycle multiplier' : sev === 'ELEV' ? 'Elevated regime: standout sizing already adjusted via lifecycle tag' : 'Normal regime: standard sizing per the lifecycle pill',
    traderConsequence: 'Hitting the account-percentage planned-risk line is the cost of the read being wrong; chasing past invalidation breaks the account-risk cap and removes upside symmetry.',
  };
  const riskEscalation = {
    healthy:      'PRE-TRIGGER: scan is fresh; structural read in place; sizing per the FRESH / STILL ACTIVE / FADING pill.',
    caution:      'AT TRIGGER: confirmed close required — do NOT pre-position above the trigger.',
    danger:       'POST-TRIGGER WICK: if price returns inside the entry band within 5 min on a wick, the trigger close is not yet confirmed; wait the next 5-min close.',
    invalidation: 'STAND-ASIDE: invalidation level is the cost of the read being wrong. No averaging, no re-entry without a fresh structural re-test on the next scan.',
  };
  // Per-item required fields are locked by foh/config/fohOutputContract.js
  // (ACTION_BLOCK_RULES + REQUIRED_ARRAYS.whatToDoNow). Each Dark Horse
  // standout fills the same 7-field shape Market Intel uses: step, action,
  // why, ifIgnored, confirmation, actionChangesWhen, dollarConsequence.
  // Honest "pending" content surfaces where price-point planning has not
  // yet emitted the anchored level; the field is never omitted silently
  // per the operator brief.
  const whatToDoNow = standouts.length
    ? standouts.slice(0, 3).map((s, i) => {
        const rank = i === 0 ? 'Primary standout — ' : i === 1 ? 'Secondary — ' : 'Tertiary — ';
        const lifecycle = s.lifecycle || 'tracked';
        const dir = s.direction || 'directional';
        const entryRef = s.pricePointPlan ? s.pricePointPlan.entryReferencePrice : (s.decisionLevel || 'pending');
        const confirmCond = s.pricePointPlan ? s.pricePointPlan.confirmationCondition : 'pending until price anchors are published';
        const invalidation = s.pricePointPlan ? s.pricePointPlan.invalidationExitPrice : (s.invalidation || 'pending');
        return {
          step: i + 1,
          action: rank + s.symbol + ' (' + lifecycle + ' ' + dir + '): entry reference ' + entryRef + '; confirmation condition ' + confirmCond + '; invalidation / exit ' + invalidation,
          why: _scrubJargon(s.reason || 'Structural alignment with current macro tape — Dark Horse surfaced this standout because the price action carries momentum + structure in the same direction on the trigger timeframe.'),
          ifIgnored: 'Acting on the wick or chasing into the standout without waiting for the listed confirmation condition typically catches the false break — the same setup post-confirmation pays in the agreement direction.',
          confirmation: confirmCond + (s.pricePointPlan ? '' : ' (price anchors will publish on a later scan once structure clarifies)'),
          actionChangesWhen: 'Lifecycle moves from ' + lifecycle + ' to a stronger or weaker phase, OR price closes through the invalidation / exit level on the trigger timeframe.',
          dollarConsequence: s.pricePointPlan
            ? s.pricePointPlan.riskBasis + ' Technical distance: ' + s.pricePointPlan.technicalDistance + '. Minimum ATLAS Buffer: ' + s.pricePointPlan.minimumAtlasBuffer + ' (' + s.pricePointPlan.unitType + '). Buffer reason: ' + s.pricePointPlan.bufferReason
            : 'Account-percentage risk cap applies only after entry reference, confirmation, and invalidation / exit are published. Until then dollar exposure is zero by design.',
        };
      })
    : [{
        step: 1,
        action: 'No standouts this scan — stand aside; re-read at next 15-min scan.',
        why: 'Driver-led tape; no structural priority. The scanner did not surface any candidate above the publication threshold.',
        ifIgnored: 'Forcing exposure into a driver-led tape without a structural standout typically lands on a marginal setup that gets stopped on the next regime shift.',
        confirmation: 'A future 15-min scan publishes at least one candidate at the publication-grade threshold.',
        actionChangesWhen: 'Next 15-min Dark Horse scan completes and at least one candidate clears the publication threshold.',
        dollarConsequence: 'Zero — no exposure recommended this cycle.',
      }];
  const confirmationCancellation = {
    confirmsWhen: lead ? (lead.pricePointPlan ? lead.pricePointPlan.confirmationCondition : ('Confirmed close through ' + (lead.decisionLevel || 'entry zone') + ' on the trigger timeframe.')) : 'N/A this cycle.',
    cancelsWhen:  lead ? (lead.pricePointPlan ? lead.pricePointPlan.invalidationCondition : ('Close through ' + (lead.invalidation || 'invalidation / exit level') + ' on the trigger timeframe.')) : 'N/A this cycle.',
    dangerIf:     'A standout invalidates while you are positioned: flatten by the published invalidation / exit price. Do not average. Do not re-enter without a fresh structural test on a later scan.',
  };
  const provenance = {
    sources: ['ATLAS Dark Horse scanner', 'Corey live macro (DXY=UUP-proxy · VIX=VXX-proxy · curve=FRED T10Y2Y)'],
    dataFreshness: 'LIVE',
    confidenceBasis: 'engine-derived',
  };

  return { meta, header, briefingSummary, eventDayReference, fourWayOutcomes, marketImpact, riskEscalation, whatToDoNow, confirmationCancellation, provenance };
}

module.exports = { buildDarkHorsePacket };
