#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));
const { buildDarkHorsePacket } = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const { renderDarkHorseSurface } = require(path.join(__dirname, '..', 'foh', 'surfaces', 'darkHorseText'));

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dailyCandles(n, base) {
  const out = [];
  let p = base;
  const startTs = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  const step = base >= 1000 ? 0.6 : base >= 100 ? 0.8 : base >= 10 ? 0.2 : 0.00025;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p + step;
    out.push({
      open: o,
      high: c + step * 0.7,
      low: o - step * 0.5,
      close: c,
      time: startTs + i * 86400,
    });
    p = c;
  }
  return out;
}

function mk(symbol, score, direction, section, base, phase) {
  const enriched = rank.enrichCandidate(
    { symbol, score, direction, summary: 'higher highs and higher lows', reasons: ['structure 2/2', 'momentum 1/2'] },
    dailyCandles(25, base),
    6,
    { watchThreshold: 8 }
  );
  enriched.section = section;
  enriched.sectionLabel = rank.SECTION_LABEL[section];
  enriched.movePhase = phase;
  return enriched;
}

function wrapLine(line, max) {
  if (line.length <= max) return [line];
  const out = [];
  let rest = line;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < 30) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

async function main() {
  const top10 = [
    mk('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early'),
    mk('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400, 'mid'),
    mk('NVDA', 7, 'Bullish', rank.SECTIONS.EQUITIES, 900, 'late'),
  ];
  const packet = buildDarkHorsePacket({
    ranking: { top10, allCount: 33 },
    volatility: { level: 'elevated' },
    now: Date.parse('2026-05-18T17:28:00Z'),
    reportId: 'DH-PROTOTYPE-PARITY-PROOF',
  });
  const viewModel = dhViewModel.toViewModel(packet);
  const discordText = renderDarkHorseSurface(viewModel, {
    reportId: packet.meta.reportId,
    maxDiscordChunkChars: 5000,
    nextReviewUTC: '2026-05-18 17:43 UTC',
  });

  const proofDir = path.join(__dirname, '..', 'docs', 'proof', 'dark-horse-prototype-parity');
  fs.mkdirSync(proofDir, { recursive: true });
  const textPath = path.join(proofDir, 'dark-horse-live-output-proof.txt');
  const pngPath = path.join(proofDir, 'dark-horse-live-output-proof.png');
  fs.writeFileSync(textPath, discordText + '\n', 'utf8');

  const wrapped = [];
  for (const line of discordText.split('\n')) {
    if (!line) wrapped.push('');
    else wrapped.push(...wrapLine(line, 108));
  }
  const lineHeight = 23;
  const width = 1500;
  const height = Math.max(900, 90 + wrapped.length * lineHeight);
  const textSvg = wrapped.map((line, i) => {
    const y = 72 + i * lineHeight;
    return '<text x="32" y="' + y + '">' + escapeXml(line) + '</text>';
  }).join('');
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">',
    '<rect width="100%" height="100%" fill="#313338"/>',
    '<rect x="18" y="18" width="' + (width - 36) + '" height="' + (height - 36) + '" rx="18" fill="#2B2D31" stroke="#5865F2" stroke-width="2"/>',
    '<text x="32" y="42" fill="#F2F3F5" font-family="Arial, sans-serif" font-size="20" font-weight="700">Dark Horse visible Discord output proof</text>',
    '<g fill="#DBDEE1" font-family="DejaVu Sans Mono, Noto Color Emoji, monospace" font-size="18">',
    textSvg,
    '</g>',
    '</svg>',
  ].join('');

  await sharp(Buffer.from(svg, 'utf8')).png().toFile(pngPath);
  console.log('[DARK-HORSE-PROOF] text=' + path.relative(path.join(__dirname, '..'), textPath));
  console.log('[DARK-HORSE-PROOF] screenshot=' + path.relative(path.join(__dirname, '..'), pngPath));
  console.log('[DARK-HORSE-PROOF] chars=' + discordText.length);
}

main().catch(err => {
  console.error('[DARK-HORSE-PROOF] FAIL ' + (err && err.stack || err));
  process.exit(1);
});
