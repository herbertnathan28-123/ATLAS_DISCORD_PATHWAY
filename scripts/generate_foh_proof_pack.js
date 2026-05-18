#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/generate_foh_proof_pack.js
//
// Operator directive 2026-05-17 — Emits the PR proof-pack
// artefacts under docs/proof/foh-pipeline/:
//   - sample-mi-engine.json          (upstream engine input)
//   - sample-mi-packet.json          (fixed-contract FOH packet)
//   - sample-mi-viewmodel.json       (named-anchor view model)
//   - sample-mi-discord-text.txt     (Discord post body)
//   - sample-mi-card-{1..6}.png      (rendered prototype cards)
//   - sample-mi-full.pdf             (full-document PDF)
//   - sample-dh-* equivalents
// ============================================================

const fs = require('fs');
const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const miShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));
const dhShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Shell'));

const OUT_DIR = path.join(__dirname, '..', 'docs', 'proof', 'foh-pipeline');

function _writeJson(name, obj) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  console.log('  wrote ' + path.relative(process.cwd(), p) + ' (' + fs.statSync(p).size + ' bytes)');
}
function _writeBuf(name, buf) {
  if (!buf) { console.log('  skip ' + name + ' (no data)'); return; }
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, buf);
  console.log('  wrote ' + path.relative(process.cwd(), p) + ' (' + fs.statSync(p).size + ' bytes)');
}
function _writeText(name, s) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, s);
  console.log('  wrote ' + path.relative(process.cwd(), p) + ' (' + fs.statSync(p).size + ' bytes)');
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── MI ─────────────────────────────────────────────────────
  const miEngine = {
    kind: 'daily',
    mood: { severity: 'HIGH', label: 'High — clustered catalyst exposure', discs: '🟠🟠🟠🟠⚫' },
    eventClusters: [
      { currency: 'USD', severity: 'HIGH', events: [
        { title: 'CPI (USD)', severity: 'HIGH', time: '12:30 AWST · 04:30 UTC', currency: 'USD' },
        { title: 'Non Farm Payrolls', severity: 'HIGH', time: '14:30 AWST · 06:30 UTC', currency: 'USD' },
      ]},
      { currency: 'EUR', severity: 'HIGH', events: [
        { title: 'ECB Rate Decision', severity: 'HIGH', time: '20:30 AWST · 12:30 UTC', currency: 'EUR' },
      ]},
    ],
    marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' },
    sourceNote: { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'engine-derived' },
    briefingSummary: 'Three high-impact catalysts cluster early week — USD inflation + EUR policy tone dominate; gold and US indices most sensitive.',
  };
  console.log('\n[MI proof pack]');
  _writeJson('sample-mi-engine.json', miEngine);
  const miPacket = buildMarketIntelPacket({ engine: miEngine });
  _writeJson('sample-mi-packet.json', miPacket);
  const miVM = miViewModel.toViewModel(miPacket);
  _writeJson('sample-mi-viewmodel.json', miVM);
  const miText = miShell.buildDiscordTextSummary(miVM, { surface: 'market_intel' });
  _writeText('sample-mi-discord-text.txt', miText);
  const miRender = await miShell.render({ packet: miPacket, viewModel: miVM, opts: { legacyPacket: miEngine, includeRawHtml: true } });
  miRender.pngs.forEach((p, i) => _writeBuf('sample-mi-card-' + (i + 1) + '-' + (p.label || ('card-' + (i + 1))) + '.png', p.png));
  _writeBuf('sample-mi-full.pdf', miRender.pdf);
  if (miRender.htmlPreview) _writeText('sample-mi-html-preview.html', miRender.htmlPreview);

  // ── DH ─────────────────────────────────────────────────────
  const dhRanking = {
    top10: [
      { symbol: 'EURUSD', movePhase: 'early', score: 9, direction: 'Bullish', summary: 'Structure 2/2, Corey live macro USD weakening, FRESH on this scan.', decisionLevel: 'Above 1.0915 confirms; entry 1.0925–1.0935', invalidation: 'Below 1.0890', dollarRiskLabel: '~$40', rewardRLabel: '5.7R', sizeLabel: 'half size for FRESH' },
      { symbol: 'XAUUSD', movePhase: 'mid',   score: 8, direction: 'Bullish', summary: 'Continuation watch · 1H close held above 2415.', decisionLevel: 'Above 2425 confirms', invalidation: 'Below 2408', dollarRiskLabel: '~$92', rewardRLabel: '3.0R', sizeLabel: 'full size × mood reduction', durationAliveLabel: '2h 30m' },
      { symbol: 'NVDA',   movePhase: 'late',  score: 7, direction: 'Bullish', summary: 'Late-stage move · momentum cooling on 4H.', decisionLevel: 'Above $980 only on confirmed close', invalidation: 'Below $965', dollarRiskLabel: '~$59', rewardRLabel: '1.3R', sizeLabel: 'quarter-size only — FADING card' },
    ],
    allCount: 33,
  };
  console.log('\n[DH proof pack]');
  _writeJson('sample-dh-ranking.json', dhRanking);
  const dhPacket = buildDarkHorsePacket({ ranking: dhRanking, volatility: { level: 'ELEV' }, universeSize: 33 });
  _writeJson('sample-dh-packet.json', dhPacket);
  const dhVM = dhViewModel.toViewModel(dhPacket);
  _writeJson('sample-dh-viewmodel.json', dhVM);
  const dhText = miShell.buildDiscordTextSummary(dhVM, { surface: 'dark_horse' });
  _writeText('sample-dh-discord-text.txt', dhText);
  const legacyDhPayload = {
    now: Date.parse('2026-05-16T12:00:00Z'),
    marketsScanned: 33,
    marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' },
    standouts: [
      { symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish' },
      { symbol: 'XAUUSD', lifecycle: 'STILL ACTIVE', direction: 'Bullish', durationAlive: '2h 30m' },
      { symbol: 'NVDA',   lifecycle: 'FADING', direction: 'Bullish' },
    ],
  };
  const dhRender = await dhShell.render({ packet: dhPacket, viewModel: dhVM, opts: { legacyPayload: legacyDhPayload, includeRawHtml: true } });
  dhRender.pngs.forEach((p, i) => _writeBuf('sample-dh-card-' + (i + 1) + '-' + (p.label || ('card-' + (i + 1))) + '.png', p.png));
  _writeBuf('sample-dh-full.pdf', dhRender.pdf);
  if (dhRender.htmlPreview) _writeText('sample-dh-html-preview.html', dhRender.htmlPreview);

  console.log('\n[PROOF PACK GENERATED] → ' + path.relative(process.cwd(), OUT_DIR));
})().catch(e => { console.error('FATAL ' + e.message); console.error(e.stack); process.exit(1); });
