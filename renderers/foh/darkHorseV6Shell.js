'use strict';

// ============================================================
// renderers/foh/darkHorseV6Shell.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Prototype shell renderer for Dark Horse v6. Same contract as
// the Market Intel shell. Owns LAYOUT ONLY.
//
// Issue #159 (2026-05-19): Dark Horse Discord text no longer
// inherits the Market Intel shell's summary (which forced a
// "🔥 THE CALL" header onto a non-calendar surface). The text
// is built by buildDarkHorseDiscordText below, which leads with
// the operator-spec CURRENT MARKET SNAPSHOT / CONDITIONS / READ
// NOW sections and replaces the banned generic phrases with
// concrete what/why/evidence/changes-if copy.
// ============================================================

const protoShell = require('./protoShell');
const dhAdapter = require('./darkHorseV6Adapter');
const { renderHtmlsToPngs, renderHtmlToPdf } = require('./pngRenderer');
const { RENDER_PARAMETERS } = require('./marketIntelV3Shell');

function _scrubExternalLinks(html) {
  if (typeof html !== 'string' || !html.length) return html;
  return html
    .replace(/https?:\/\/(www\.)?notion\.(so|com|site)\/[^\s)"'\]]*/gi, '#')
    .replace(/<a\s+([^>]*?)href=["']#["']([^>]*)>(.*?)<\/a>/gi, '$3');
}

// ============================================================
// ISSUE #159 — Dark Horse Discord text terminology cleanup
// (operator brief 2026-05-19). Replaces the inherited Market
// Intel buildDiscordTextSummary call for Dark Horse so the
// surface never carries "THE CALL", "risk basis unavailable",
// "FRESH cards", "freshness: LIVE", "macro tape drives
// direction", or "No execution priority this cycle".
// ============================================================

const DH_BANNED_PHRASES_USERFACING = Object.freeze([
  /🔥 \*\*THE CALL\*\*/g,
  /\bTHE CALL\b/g,
  /risk basis unavailable/gi,
  /\bFRESH cards\b/g,
  /freshness: LIVE/gi,
  /macro tape drives direction/gi,
  /No execution priority this cycle/gi,
]);

function _scrubDarkHorseGenericAdvice(text) {
  let out = String(text || '');
  for (const re of DH_BANNED_PHRASES_USERFACING) out = out.replace(re, '');
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _readAgeLabel(generatedAtUTC, nowMs) {
  if (!generatedAtUTC) return 'read age unknown';
  const stamp = Date.parse(String(generatedAtUTC).replace(' UTC', 'Z').replace(' ', 'T'));
  if (!Number.isFinite(stamp)) return 'read age unknown';
  const ageMin = Math.max(0, Math.round(((nowMs || Date.now()) - stamp) / 60000));
  if (ageMin <= 1)  return ageMin + ' minute old · live';
  if (ageMin <= 5)  return ageMin + ' minutes old · usable';
  if (ageMin <= 15) return ageMin + ' minutes old · ageing';
  return ageMin + ' minutes old · stale — wait for the next 15-min scan';
}

function _summariseInternalCandidates(viewModel) {
  // sendDarkHorseFoh attaches `standouts: _liveStandoutsFromRanking(ranking)` —
  // for 0-standout the live array is empty. Internal candidates (score 5–7)
  // live on the ranking object, not the VM. Caller threads them through
  // viewModel.internalCandidates when available; honest-pending otherwise.
  const arr = Array.isArray(viewModel && viewModel.internalCandidates) ? viewModel.internalCandidates : [];
  if (!arr.length) return 'no internal candidates surfaced; entire scan universe below WATCH threshold';
  const sample = arr.slice(0, 4).map(c => (c.symbol || 'unknown') + ' ' + (c.score != null ? c.score + '/10' : '?')).join(', ');
  const gap = arr[0] && Number.isFinite(arr[0].score) ? ' · top internal sits ' + (8 - arr[0].score) + ' point' + (8 - arr[0].score === 1 ? '' : 's') + ' below the WATCH threshold (8/10)' : '';
  return sample + gap;
}

function _conditionsWhy(severityLabel, volatility) {
  const sev = String((severityLabel || (volatility && volatility.level) || '')).toUpperCase();
  if (sev.indexOf('EXTREME') >= 0 || sev.indexOf('STORM') >= 0) return 'storm regime — broad market is moving fast; every chase is amplified.';
  if (sev.indexOf('HIGH') >= 0)  return 'storm regime — broad market is moving fast; every chase is amplified.';
  if (sev.indexOf('ELEV') >= 0)  return 'elevated reactivity — size down per any future standout lifecycle.';
  if (sev.indexOf('MED') >= 0)   return 'normal-to-medium volatility — standard sizing if a standout prints.';
  if (sev.indexOf('LOW') >= 0 || sev.indexOf('CALM') >= 0) return 'calm tape — driver-led; lower probability of a structural break this scan.';
  return 'risk state pending; scanner has not surfaced a regime label this cycle.';
}

function _sourceProvenanceLine(provenance, generatedAtUTC, nowMs) {
  const srcs = Array.isArray(provenance && provenance.sources)
    ? provenance.sources.join(' · ')
    : 'ATLAS Dark Horse scanner';
  return [
    'LAST UPDATED: ' + (generatedAtUTC || 'unknown'),
    'READ AGE: '     + _readAgeLabel(generatedAtUTC, nowMs),
    'STILL VALID: '  + 'until next 15-min Dark Horse scan or manual re-read',
    'NEXT RE-CHECK: ' + 'next Dark Horse scan',
    'source: '       + srcs,
  ].join(' · ');
}

function _truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

function buildDarkHorseDiscordText(packet, viewModel, opts) {
  opts = opts || {};
  packet = packet || {};
  viewModel = viewModel || {};
  // Codex review P1 (PR #160): `_liveStandoutsFromRanking` widens
  // viewModel.standouts to score ≥ 7 so the prototype shell cards
  // can preview near-WATCH candidates. The Discord copy must use
  // the engine's actual WATCH / publication threshold (score ≥ 8)
  // — anything weaker is internal-only and must not be rendered as
  // a live standout. Filter here before deciding `isZero` so a
  // score-7 INTERNAL candidate cannot mis-render as `1 live
  // standout` / `WATCH=1`.
  const WATCH_PUBLICATION_THRESHOLD = 8;
  const rawStandouts = Array.isArray(viewModel.standouts) ? viewModel.standouts : [];
  const standouts = rawStandouts.filter(s => Number.isFinite(s && s.score) && s.score >= WATCH_PUBLICATION_THRESHOLD);
  // Any near-WATCH (score 7) entries that came in through standouts
  // belong in the internal-candidate evidence — fold them in so the
  // 0-standout case still surfaces them under WATCH=0.
  const nearWatch = rawStandouts.filter(s => Number.isFinite(s && s.score) && s.score === WATCH_PUBLICATION_THRESHOLD - 1);
  const isZero = standouts.length === 0;
  const header = packet.header || {};
  const bs = packet.briefingSummary || {};
  const mi = packet.marketImpact || {};
  const cc = packet.confirmationCancellation || {};
  const prov = packet.provenance || {};
  const generatedAtUTC = header.generatedAtUTC || (packet.meta && packet.meta.generatedAtUTC) || viewModel.GENERATED_AT_UTC;
  const nowMs = (viewModel.now || opts.now || Date.now());
  const universeSize = Number.isFinite(viewModel.marketsScanned) ? viewModel.marketsScanned : 0;
  // Codex review P1: near-WATCH (score 7) entries that came in
  // through viewModel.standouts must be counted under INTERNAL,
  // not WATCH. Add them to the wired internal count if the engine
  // hasn't already accounted for them.
  const wiredInternalCount = Number.isFinite(viewModel.internalCount)
    ? viewModel.internalCount
    : (Array.isArray(viewModel.internalCandidates) ? viewModel.internalCandidates.length : 0);
  const wiredInternalSyms = new Set((viewModel.internalCandidates || []).map(c => c && c.symbol).filter(Boolean));
  const nearWatchAddl = nearWatch.filter(s => s && s.symbol && !wiredInternalSyms.has(s.symbol));
  const internalCount = wiredInternalCount + nearWatchAddl.length;
  const ignoredCount = Number.isFinite(viewModel.ignoredCount) ? viewModel.ignoredCount : Math.max(0, universeSize - internalCount - standouts.length);
  // Fold near-WATCH symbols into the evidence-list view-model used
  // by _summariseInternalCandidates so they appear with their score.
  const effectiveVm = nearWatchAddl.length
    ? Object.assign({}, viewModel, {
        internalCandidates: [].concat(
          viewModel.internalCandidates || [],
          nearWatchAddl.map(s => ({ symbol: s.symbol, score: s.score })),
        ),
      })
    : viewModel;
  const vixState = (viewModel.marketMood && viewModel.marketMood.label) || header.riskState || 'pending';
  const severity = header.severityDiscs || viewModel.RISK_STATE_DISC_SCALE || 'risk state pending';

  const sectionSnapshot = [
    '📊 **CURRENT MARKET SNAPSHOT**',
    'Dark Horse scan complete · ' + standouts.length + ' live standout' + (standouts.length === 1 ? '' : 's') + ' · ' + universeSize + ' market' + (universeSize === 1 ? '' : 's') + ' scanned',
    'LAST UPDATED: '   + (generatedAtUTC || 'unknown'),
    'READ AGE: '       + _readAgeLabel(generatedAtUTC, nowMs),
    'STILL VALID?: '   + 'valid until next 15-minute scan or manual re-read',
    'NEXT RE-CHECK: '  + 'next Dark Horse scan',
  ].join('\n');

  const sectionConditions = [
    '🌐 **CURRENT MARKET CONDITIONS**',
    'Risk state: '     + severity,
    'Why: '            + _conditionsWhy(header.riskState, opts.volatility),
    'Evidence: WATCH=' + standouts.length + ', INTERNAL=' + internalCount + ', IGNORED=' + ignoredCount + ', VIX=' + vixState + ', source=ATLAS Dark Horse scanner',
  ].join('\n');

  const sectionReadNow = isZero
    ? [
        '🎯 **MARKET READ NOW**',
        'Action state: '   + 'No live standout this cycle',
        'Why: '            + 'no symbol cleared the WATCH / publication threshold (score ≥ 8/10); the highest internal candidates remain below the publication threshold.',
        'Evidence: '       + _summariseInternalCandidates(effectiveVm),
        'Changes if: '     + 'a candidate clears the WATCH threshold on the next scan, or volatility / session conditions change.',
      ].join('\n')
    : [
        '🎯 **MARKET READ NOW**',
        'Action state: '   + standouts.length + ' live standout' + (standouts.length === 1 ? '' : 's') + ' tracked',
        'Why: '            + (bs.primaryRead || 'standout(s) cleared the publication threshold this cycle.'),
        'Evidence: '       + standouts.slice(0, 4).map(s => (s.symbol || 'unknown') + ' ' + (s.lifecycle || 'tracked') + ' ' + (s.direction || 'directional')).join(', '),
        'Changes if: '     + (cc.cancelsWhen || 'a standout closes through its published invalidation / exit on the trigger timeframe.'),
      ].join('\n');

  // Codex review P1 (PR #160): when a score-7 entry slips through
  // viewModel.standouts, buildDarkHorsePacket still computes a
  // `lead` and emits the live-standout mechanism string. Override
  // here when the publication-grade count is zero so the text
  // matches the WATCH=0 reality.
  const mechanismForZero = 'No live standout cleared the publication threshold this cycle. Internal candidates exist but remain below the publication grade (score < 8/10). Volatility / risk state may be elevated; the next 15-min scan re-checks the candidate set.';
  const sectionMarketImpact = isZero
    ? [
        '🌍 **MARKET IMPACT**',
        mechanismForZero,
      ].join('\n')
    : [
        '🌍 **MARKET IMPACT**',
        mi.mechanism || 'mechanism pending',
        mi.priceReactionPath || '',
        mi.liquidityEffect || '',
        mi.volatilityEffect || '',
        mi.traderConsequence || '',
      ].filter(Boolean).join('\n');

  const sectionSourceProvenance = [
    '🔗 **SOURCE / PROVENANCE**',
    _sourceProvenanceLine(prov, generatedAtUTC, nowMs),
  ].join('\n');

  const sectionStandoutCards = isZero ? null : [
    '⭐ **STANDOUTS**',
    standouts.slice(0, 4).map((s, i) => '  ' + (i + 1) + '. ' + (s.symbol || 'unknown') + ' · ' + (s.lifecycle || 'tracked') + ' · ' + (s.direction || 'directional') + ' · score ' + (s.score != null ? s.score + '/10' : '?')).join('\n'),
  ].join('\n');

  // Codex review P1: rebuild the top-line subtitle from the
  // publication-grade count so it never drifts from the SNAPSHOT.
  const topSubtitle = standouts.length + ' standout' + (standouts.length === 1 ? '' : 's') + ' on this scan · ' + universeSize + ' market' + (universeSize === 1 ? '' : 's') + ' scanned';
  const lines = [
    '**' + (header.title || 'ATLAS · Dark Horse') + ' · ' + topSubtitle + '**',
    'Generated: ' + (generatedAtUTC || 'unknown'),
    '',
    sectionSnapshot,
    '',
    sectionConditions,
    '',
    sectionReadNow,
    '',
    sectionMarketImpact,
    '',
    sectionSourceProvenance,
  ];
  if (sectionStandoutCards) {
    lines.splice(lines.indexOf(sectionReadNow) + 1, 0, '', sectionStandoutCards);
  }

  const maxChars = Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : RENDER_PARAMETERS.maxDiscordChunkChars;
  return _truncate(_scrubDarkHorseGenericAdvice(lines.join('\n')), maxChars);
}

async function render({ packet, viewModel, opts }) {
  opts = Object.assign({}, RENDER_PARAMETERS, opts || {});

  let html = protoShell.getDarkHorseV6Html();

  // Live production must render from the current FOH view model.
  // The previous path preferred opts.legacyPayload, which allowed stale
  // prototype/sample candidate content to survive in live no-standout PDFs.
  const liveViewModel = viewModel || packet || {};
  html = dhAdapter.adapt(html, liveViewModel);
  html = _scrubExternalLinks(html);

  const cards = protoShell.buildDarkHorseV6Cards(html).map(c => ({ ...c, html: _scrubExternalLinks(c.html) }));
  const [pngBatch, pdfSingle] = await Promise.all([
    renderHtmlsToPngs(cards.map(c => c.html)),
    renderHtmlToPdf(html),
  ]);
  const pngs = (pngBatch && pngBatch.pngs ? pngBatch.pngs : []).map((p, i) => Object.assign({ label: cards[i] && cards[i].label }, p));
  const discordText = buildDarkHorseDiscordText(packet, viewModel, opts);

  return {
    discordText,
    pngs,
    pdf: pdfSingle && pdfSingle.ok ? pdfSingle.pdf : null,
    pdfBytes: pdfSingle && pdfSingle.ok ? (pdfSingle.bytes || (pdfSingle.pdf && pdfSingle.pdf.length) || 0) : 0,
    pdfError: pdfSingle && !pdfSingle.ok ? pdfSingle.error : null,
    htmlPreview: opts.includeRawHtml ? html : null,
    params: RENDER_PARAMETERS,
  };
}

module.exports = {
  render,
  buildDarkHorseDiscordText,
  RENDER_PARAMETERS,
  _private: {
    DH_BANNED_PHRASES_USERFACING,
    _scrubDarkHorseGenericAdvice,
    _readAgeLabel,
    _conditionsWhy,
    _sourceProvenanceLine,
    _summariseInternalCandidates,
  },
};
