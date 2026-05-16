#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/staging_foh_image_renderer_smoke.js
//
// Generates sample PNGs for each FOH card kind into
// docs/proof/foh-images/. NO network calls.
//
// Optionally POSTs each PNG to a staging Discord webhook when
// both `--post` AND `--confirm-staging` are supplied AND the
// `ATLAS_STAGING_FOH_IMAGE_WEBHOOK` env var is set. The harness
// refuses to run when production env keys (`MARKET_INTEL_WEBHOOK`,
// `WEEKLY_DARKHORSES`, `DARKHORSE_STOCK`) are in the ambient
// environment.
//
// Usage:
//   # Dry-run (writes PNGs to docs/proof/foh-images/):
//   node scripts/staging_foh_image_renderer_smoke.js
//
//   # POST to staging Discord:
//   unset MARKET_INTEL_WEBHOOK WEEKLY_DARKHORSES DARKHORSE_STOCK
//   export ATLAS_STAGING_FOH_IMAGE_WEBHOOK="https://discord.com/api/webhooks/<id>/<token>"
//   node scripts/staging_foh_image_renderer_smoke.js --post --confirm-staging
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const foh = require(path.join(__dirname, '..', 'renderers', 'foh'));

const args = process.argv.slice(2);
const POST_MODE = args.includes('--post');
const CONFIRM   = args.includes('--confirm-staging');

// ── SAFETY RAIL 1: production env keys must be unset ──
const PROD_KEYS = ['MARKET_INTEL_WEBHOOK', 'WEEKLY_DARKHORSES', 'DARKHORSE_STOCK'];
const ambientHits = PROD_KEYS.filter(k => process.env[k] && process.env[k].length > 0);
if (ambientHits.length > 0) {
  console.error('[ABORT] Production env keys present in ambient environment:');
  for (const k of ambientHits) console.error('         ' + k + '   (must be unset for staging harness)');
  process.exit(2);
}

// ── SAFETY RAIL 2: both --post and --confirm-staging required ──
if (POST_MODE && !CONFIRM) {
  console.error('[ABORT] --post requires --confirm-staging.');
  process.exit(2);
}
if (!POST_MODE && CONFIRM) {
  console.error('[ABORT] --confirm-staging without --post is meaningless.');
  process.exit(2);
}

const STAGING_URL = process.env.ATLAS_STAGING_FOH_IMAGE_WEBHOOK || '';
if (POST_MODE) {
  if (!STAGING_URL) {
    console.error('[ABORT] --post requires ATLAS_STAGING_FOH_IMAGE_WEBHOOK env var.');
    process.exit(2);
  }
  if (!/^https:\/\/(canary\.)?discord\.com\/api\/webhooks\//.test(STAGING_URL)) {
    console.error('[ABORT] ATLAS_STAGING_FOH_IMAGE_WEBHOOK must be a Discord webhook URL.');
    process.exit(2);
  }
}

function urlHash(u) {
  if (!u) return '(none)';
  return crypto.createHash('sha256').update(u).digest('hex').slice(0, 12);
}

// ── FIXTURES ──
const FIXTURES = [
  {
    kind: 'market_intel',
    label: 'mi-pre-event-cpi-usd',
    caption: 'TEST RENDER PROOF — Market Intel · CPI (USD) · T-1H',
    payload: {
      kind: 'pre_event',
      headline: { title: 'CPI (USD)', currency: 'USD', country: 'US', impact: 'HIGH', time: '02:33 UTC / 10:33 AWST', stage: 'T-1H', lifecycle: 'STILL ACTIVE' },
      mood: { discs: '🟠🟠🟠🟠⚫', label: 'Elevated — approach window', severity: 'ELEV' },
      whyThisMatters: 'USD inflation cycle dominates this window. Rate-path expectations sit at the core of every cross-asset price — yields and the dollar lead, gold and risk indices follow on transmission.',
      marketImpact: 'cause: USD inflation surprise vs forecast → expectation: rate-path repricing in the front end → market reaction: USD and yields move first → asset impact: US Dollar Index direction sets gold / US-index reaction.',
      crossAsset: [
        { classLabel: 'FX', body: 'US Dollar Index · USD pairs (EURUSD, GBPUSD, USDJPY, USDCAD) — direction historically tracks the USD rate-path repricing first.' },
        { classLabel: 'Indices', body: 'US (NAS100, US500, US30) — rate-sensitivity favours the inverse of the yield reaction; risk-tone confirmation comes from VWAP hold / loss.' },
        { classLabel: 'Commodities', body: 'Metals (XAUUSD) — historically inverse to USD / yields; rejection or reclaim of the pre-release high / low is the read.' },
      ],
      operatorGuidance: {
        confirms: 'A confirmed candle close on 5M / 15M in surprise direction validates continuation. Cross-asset agreement required.',
        cancels:  'Post-release impulse retraces fully within 30 min, lead pair and USD-sensitive risk disagree, or 1H closes back inside pre-release range.',
      },
      nextWatch: '2026-05-16 02:33 UTC / 10:33 AWST event. First reaction 0–15 min post-release. Reassess at first 1H close.',
      historical: {
        rows: [
          { label: 'Apr 2026', actual: '3.5%', magnitude: '+0.2%', dir: 'above', reaction: 'USD bid, gold offered' },
          { label: 'Mar 2026', actual: '3.0%', magnitude: '0',     dir: 'in-line', reaction: 'mixed' },
          { label: 'Feb 2026', actual: '3.4%', magnitude: '+0.1%', dir: 'above', reaction: 'USD bid intraday' },
        ],
        basis: 'engine-derived',
        sampleN: 3,
      },
      terminology: ['Dovish', 'Hawkish', 'Yield curve', 'Risk-off', 'Liquidity sweep'],
      glossaryUrl: 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a',
      dashboardDownloadUrls: {
        png: 'https://atlas.fx/foh/download.png?card=' + Date.now(),
        pdf: 'https://atlas.fx/foh/download.pdf?card=' + Date.now(),
      },
      sourceNote: { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'engine-derived', macroNote: 'macro=ATLAS · UUP/VXX proxies live · FRED T10Y2Y normal' },
      briefingSummary: 'T-1H alert · CPI (USD). Macro is dollar-yield-led; cross-asset consequences cascade through US Dollar Index on direction of surprise. Working bias conditional until price confirms through structure.',
    },
  },
  {
    kind: 'market_intel',
    label: 'mi-weekend-monday-open',
    caption: 'TEST RENDER PROOF — Market Intel · Weekend / Monday Open Prep',
    payload: {
      kind: 'weekend',
      headline: { title: 'Weekly Macro Setup', currency: 'multi', impact: 'ELEV', time: '12:00 UTC Sat → Mon Asia open', stage: 'PRE-OPEN', lifecycle: 'NEW WATCH' },
      mood: { discs: '🟠🟠🟠🟠⚫', label: 'High — clustered catalyst exposure', severity: 'ELEV' },
      whyThisMatters: 'Three high-impact catalysts cluster early week (ECB Mon, CPI Wed, NFP Fri). USD inflation + EUR policy tone dominate; gold and US indices most sensitive.',
      marketImpact: 'cause: clustered catalyst window → expectation: front-end rate-path repricing on each release → market reaction: USD and EUR lead, JPY safe-haven flow secondary → asset impact: NAS100, XAUUSD, EURUSD highest beta.',
      crossAsset: [
        { classLabel: 'FX', body: 'EURUSD, USDJPY, GBPUSD — direction set by Mon ECB tone + Wed CPI surprise.' },
        { classLabel: 'Indices', body: 'NAS100, US500 — rate-sensitive; expect VWAP-led reversals on each catalyst.' },
        { classLabel: 'Commodities', body: 'XAUUSD inverse to USD/yields; XAGUSD follows.' },
      ],
      eventClusters: [
        { currency: 'EUR', country: 'EU', events: [
          { title: 'ECB Rate Decision', time: 'Mon 12:00 UTC', impactSeverity: 'HIGH' },
          { title: 'ECB Press Conference', time: 'Mon 12:45 UTC', impactSeverity: 'HIGH' },
        ]},
        { currency: 'USD', country: 'US', events: [
          { title: 'CPI (USD)', time: 'Wed 12:30 UTC', impactSeverity: 'HIGH' },
          { title: 'Core CPI (USD)', time: 'Wed 12:30 UTC', impactSeverity: 'HIGH' },
          { title: 'Non-Farm Payrolls', time: 'Fri 12:30 UTC', impactSeverity: 'HIGH' },
          { title: 'Fed Speakers', time: 'Thu 14:00 UTC', impactSeverity: 'MED' },
        ]},
        { currency: 'GBP', country: 'UK', events: [
          { title: 'BOE Rate Decision', time: 'Thu 11:00 UTC', impactSeverity: 'HIGH' },
          { title: 'UK CPI', time: 'Wed 06:00 UTC', impactSeverity: 'HIGH' },
        ]},
      ],
      operatorGuidance: {
        confirms: 'Live confirmation required after Mon Asia open. Watch the lead pair on first 1H close.',
        cancels:  'Geopolitical override before Mon open, or weekend gap fills inside 30 min on reopen.',
      },
      nextWatch: 'Asia reopen Sun 22:00 UTC. London 07:00 UTC Mon. NY 13:30 UTC Mon.',
      terminology: ['Dovish', 'Hawkish', 'Yield curve', 'Risk-off', 'Liquidity sweep', 'Confirmed candle close'],
      glossaryUrl: 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a',
      dashboardDownloadUrls: {
        png: 'https://atlas.fx/foh/download.png?card=' + Date.now(),
        pdf: 'https://atlas.fx/foh/download.pdf?card=' + Date.now(),
      },
      sourceNote: { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'engine-derived', macroNote: 'Preparation intelligence only — live confirmation required after market open.' },
      briefingSummary: 'Weekend prep · 3 currency blocks · 8 high-impact catalysts inside the week. USD inflation + EUR policy tone dominate. No execution authority until live price confirms after reopen.',
    },
  },
  {
    kind: 'dark_horse',
    label: 'dh-live-scan-3-standouts',
    caption: 'TEST RENDER PROOF — Dark Horse · 3 standouts (FRESH / STILL ACTIVE / FADING)',
    payload: {
      scanTime: '2026-05-13 12:00 UTC / 20:00 AWST',
      marketsScanned: 33,
      marketMood: { discs: '🟠🟠🟠🟠⚫', label: 'Elevated — broad market moving fast', severity: 'ELEV' },
      standouts: [
        { symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish', score: 9,
          firstDetected: '2026-05-13 12:00 UTC', durationAlive: 'first scan',
          reason: 'Structure 2/2 momentum 1/2 · Corey live macro USD weakening · matches early-stage FX major pattern.',
          decisionLevel: 'Above 1.0915 confirms continuation; entry zone 1.0925–1.0935',
          invalidation: 'Below 1.0890 voids the setup',
          dollarRisk: '~$40', rewardR: '5.7R', sizeLabel: 'half size for FRESH' },
        { symbol: 'XAUUSD', lifecycle: 'STILL ACTIVE', direction: 'Bullish', score: 8,
          firstDetected: '2026-05-13 09:30 UTC', durationAlive: '2h 30m',
          reason: 'Continuation watch · 1H close held above 2415 · cross-asset confirmation from US Dollar Index weakness.',
          decisionLevel: 'Above 2425 confirms breakout; entry zone 2418–2424',
          invalidation: 'Below 2408 voids the setup',
          dollarRisk: '~$92', rewardR: '3.0R', sizeLabel: 'full size × elevated mood reduction' },
        { symbol: 'NVDA', lifecycle: 'FADING', direction: 'Bullish', score: 7,
          firstDetected: '2026-05-12 14:00 UTC', durationAlive: '22h',
          reason: 'Late-stage move · momentum cooling on 4H · still structurally bullish but extension risk elevated.',
          decisionLevel: 'Above $980 only on confirmed close; entry zone $975–$978',
          invalidation: 'Below $965 voids the setup',
          dollarRisk: '~$59', rewardR: '1.3R', sizeLabel: 'quarter-size only because this is a FADING card' },
      ],
      riskReminder: 'Every zone above is what ATLAS sees right now. Live price moves, the zones move with it. Cross-check current price against the zone before acting.',
      terminology: ['Decision Level','Entry Zone','Watch Level','Caution Zone','Invalidation','Confirmed Candle Close','Dollar Risk','Reward-to-Risk','Fresh Setup','Still Active Setup','Fading Setup'],
      glossaryUrl: 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a',
      dashboardDownloadUrls: {
        png: 'https://atlas.fx/foh/download.png?card=' + Date.now(),
        pdf: 'https://atlas.fx/foh/download.pdf?card=' + Date.now(),
      },
      sourceNote: { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'engine-derived' },
      briefingSummary: '3 standouts today (1 FRESH, 1 STILL ACTIVE, 1 FADING). Market mood elevated. EURUSD cleanest reward-to-risk; XAUUSD highest conviction continuation; NVDA late-stage scalp.',
    },
  },
  {
    kind: 'macro',
    label: 'macro-monday-roadmap',
    caption: 'TEST RENDER PROOF — Macro · Monday institutional roadmap',
    payload: {
      dateLabel: '2026-05-18 (Mon) AWST',
      dominantBias: { score: 4, label: 'Risk-off lean dominant — USD bid, gold bid', arrows: '⬆️⬇️' },
      regime: { dxy: 'Bullish (28.4 mild-bid)', vix: 'Elevated (27.9)', yield: 'Flat T10Y2Y 0.50', riskEnv: 'Defensive' },
      marketOverview: [
        { heading: 'USD complex', body: 'US Dollar Index mild-bid into the week; rate-path repricing favours dollar strength.', arrow: '⬆️' },
        { heading: 'Risk assets', body: 'US indices defensive going into Mon ECB; rotation into safe havens visible.', arrow: '⬇️' },
        { heading: 'Gold / metals', body: 'XAUUSD trades alongside US Dollar Index inversely; structurally bullish on yield-fade risk.', arrow: '⬆️' },
      ],
      events: [
        { time: 'Mon 12:00 UTC', title: 'ECB Rate Decision', currency: 'EUR', impact: 'HIGH' },
        { time: 'Wed 12:30 UTC', title: 'CPI (USD)', currency: 'USD', impact: 'HIGH' },
        { time: 'Thu 11:00 UTC', title: 'BOE Rate Decision', currency: 'GBP', impact: 'HIGH' },
        { time: 'Fri 12:30 UTC', title: 'Non-Farm Payrolls', currency: 'USD', impact: 'HIGH' },
      ],
      historical: [
        { heading: 'CPI prior 3', body: 'Apr 3.5% (+0.2 above) → USD bid · Mar 3.0% (in-line) · Feb 3.4% (+0.1 above) → USD bid intraday.', arrow: '⬆️' },
        { heading: 'NFP prior 3', body: 'Apr 220k (+40k above) → USD bid · Mar 195k · Feb 240k (+60k above) → USD bid + risk-off rotation.', arrow: '⬆️' },
      ],
      executionLogic: [
        'IF US Dollar Index holds 28.0 AND CPI prints above forecast THEN continuation long USD / short gold favoured.',
        'IF CBOE Volatility Index breaks above 30 THEN safe-haven rotation accelerates — risk indices favoured short.',
        'IF yield curve un-flattens above 0.60 THEN cyclical rotation favoured over defensives.',
      ],
      validity: 'Validity window: Monday 2026-05-18 Asia open through Friday 2026-05-22 NY close. Reassess after each clustered catalyst (ECB, CPI, BOE, NFP).',
      roadmapUrl: 'https://atlas.fx/roadmap/2026-05-18',
      terminology: ['Dovish','Hawkish','Yield curve','Risk-off','Confirmed candle close','Structure break','Liquidity sweep'],
      glossaryUrl: 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a',
      dashboardDownloadUrls: {
        png: 'https://atlas.fx/foh/download.png?card=' + Date.now(),
        pdf: 'https://atlas.fx/foh/download.pdf?card=' + Date.now(),
      },
      sourceNote: { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'historically sourced' },
    },
  },
];

(async function main() {
  const outDir = path.join(__dirname, '..', 'docs', 'proof', 'foh-images');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('=== STAGING HARNESS — FOH IMAGE RENDERER ===');
  console.log('mode:           ' + (POST_MODE ? 'POST (staging)' : 'DRY-RUN (write PNGs to disk)'));
  console.log('staging urlHash: ' + urlHash(STAGING_URL));
  console.log('fixtures:       ' + FIXTURES.length);
  console.log('output dir:     ' + outDir);
  console.log('');

  let okCount = 0, failCount = 0;
  for (const f of FIXTURES) {
    const t0 = Date.now();
    // Render BOTH PNG + PDF in a single Puppeteer launch. PNG is
    // the Discord preview, PDF is the downloadable carry-around.
    const rendered = await foh.renderFohExport({ kind: f.kind, payload: f.payload });
    const elapsedMs = Date.now() - t0;
    if (!rendered.ok) {
      failCount++;
      console.error('[' + f.label + '] RENDER FAIL — reason=' + rendered.reason + ' error=' + rendered.error);
      continue;
    }
    okCount++;
    const pngPath = path.join(outDir, f.label + '.png');
    const pdfPath = path.join(outDir, f.label + '.pdf');
    if (rendered.png) fs.writeFileSync(pngPath, rendered.png);
    if (rendered.pdf) fs.writeFileSync(pdfPath, rendered.pdf);
    const pngLine = rendered.png ? Math.round(rendered.pngBytes / 1024) + ' KB' : '(failed: ' + rendered.pngError + ')';
    const pdfLine = rendered.pdf ? Math.round(rendered.pdfBytes / 1024) + ' KB' : '(failed: ' + (rendered.pdfError || 'no-pdf') + ')';
    console.log('[' + f.label + '] OK — ' + rendered.width + 'x' + rendered.height + ' @' + rendered.devicePixelRatio + 'x · ' + elapsedMs + 'ms');
    console.log('  PNG: ' + pngLine + (rendered.png ? '  → ' + pngPath : ''));
    console.log('  PDF: ' + pdfLine + (rendered.pdf ? '  → ' + pdfPath : ''));

    if (POST_MODE) {
      const sent = await foh.postFohExportToDiscord({
        kind: f.kind, payload: f.payload, webhookUrl: STAGING_URL,
        caption: f.caption, dashboardUrl: f.payload.glossaryUrl,
      });
      if (sent.ok) {
        const attached = (sent.attachments || []).map(a => a.contentType + ' ' + Math.round(a.bytes / 1024) + 'KB').join(' + ');
        const pdfFlag = sent.pdfSkipped ? ' [pdf-skipped: ' + sent.pdfSkipReason + ']' : '';
        console.log('  [POST] urlHash=' + urlHash(STAGING_URL) + ' status=' + sent.status + ' attached=[' + attached + ']' + pdfFlag);
      } else {
        console.error('  [POST FAIL] reason=' + sent.reason + ' error=' + sent.error + ' fallback=' + sent.fallback);
      }
    }
  }

  console.log('');
  console.log('Summary: ' + okCount + '/' + FIXTURES.length + ' rendered ok' + (failCount ? ' (' + failCount + ' failed)' : ''));
  if (!POST_MODE) {
    console.log('[DRY-RUN] No network calls. Re-run with --post --confirm-staging + ATLAS_STAGING_FOH_IMAGE_WEBHOOK to deliver.');
  }
  process.exit(failCount ? 4 : 0);
})().catch(e => {
  console.error('[STAGING ERROR] ' + e.message);
  process.exit(5);
});
