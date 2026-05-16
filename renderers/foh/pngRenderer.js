'use strict';

// ============================================================
// renderers/foh/pngRenderer.js
//
// Puppeteer driver — converts an HTML string into a PNG Buffer.
// Used by every FOH card renderer (marketIntelCard / darkHorseCard
// / macroCard).
//
// Hard contract:
//   - Safe-fail. Never throws. On Puppeteer launch failure,
//     missing-browser, OOM, or any render exception, returns
//     `{ ok: false, error, reason }` so callers can fall back
//     to the existing text payload.
//   - Auto-sizes the viewport to the rendered content height so
//     the card never gets clipped or padded with empty space.
//   - Operates with `--no-sandbox` (Render Standard plan +
//     Docker-style envs typically need this). DPR 2 by default
//     for retina-quality output.
// ============================================================

let _puppeteer = null;
function _puppeteerLazy() {
  if (_puppeteer) return _puppeteer;
  try {
    _puppeteer = require('puppeteer');
    return _puppeteer;
  } catch (e) {
    return null;
  }
}

async function renderHtmlToPng(html, opts) {
  opts = opts || {};
  const width  = Number.isFinite(opts.width) ? opts.width : 1080;
  const dpr    = Number.isFinite(opts.deviceScaleFactor) ? opts.deviceScaleFactor : 2;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 20000;

  const puppeteer = _puppeteerLazy();
  if (!puppeteer) {
    return { ok: false, reason: 'puppeteer_unavailable', error: 'puppeteer module not installed in this environment' };
  }

  let browser = null;
  const start = Date.now();
  try {
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
        '--disable-gpu',
      ],
      headless: 'new',
      timeout: timeoutMs,
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height: 1, deviceScaleFactor: dpr });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Wait for any web fonts to settle so headings render at intended weight
    try {
      await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve());
    } catch (_e) { /* ignore — render with fallback font */ }

    // Measure rendered content height (clip the screenshot to the
    // card's exact bounding box so no empty space pads the PNG).
    const height = await page.evaluate(() => {
      const root = document.querySelector('.foh-card') || document.body;
      const rect = root.getBoundingClientRect();
      // Include outer padding on body to give a small breathing margin
      const bodyStyle = getComputedStyle(document.body);
      const padTop    = parseInt(bodyStyle.paddingTop, 10)    || 0;
      const padBottom = parseInt(bodyStyle.paddingBottom, 10) || 0;
      return Math.ceil(rect.height + padTop + padBottom);
    });
    await page.setViewport({ width, height: Math.max(height, 600), deviceScaleFactor: dpr });

    const png = await page.screenshot({ type: 'png', omitBackground: false, fullPage: false });
    const elapsedMs = Date.now() - start;
    return { ok: true, png, width, height, devicePixelRatio: dpr, elapsedMs, bytes: png.length };
  } catch (e) {
    return { ok: false, reason: 'render_failed', error: e.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_e) { /* swallow */ }
    }
  }
}

module.exports = { renderHtmlToPng };
