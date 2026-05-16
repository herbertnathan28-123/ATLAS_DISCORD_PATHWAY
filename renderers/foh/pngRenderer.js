'use strict';

// ============================================================
// renderers/foh/pngRenderer.js
//
// Puppeteer driver — converts an HTML string into a PNG and/or
// PDF Buffer. Used by every FOH card renderer (marketIntelCard
// / darkHorseCard / macroCard).
//
// Hard contract:
//   - Safe-fail. Never throws. On Puppeteer launch failure,
//     missing-browser, OOM, or any render exception, returns
//     `{ ok: false, error, reason }` so callers can fall back
//     to the existing text payload.
//   - Auto-sizes the viewport to the rendered content height so
//     the card never gets clipped or padded with empty space.
//   - PDF export uses Puppeteer's built-in `page.pdf()` —
//     produces a vector-text PDF with the same visual layout as
//     the PNG, ideal for downloadable carry-around copy.
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

// Internal helper — share the page setup between PNG and PDF
// captures so a single browser launch can produce both formats.
async function _withRenderedPage(html, opts, callback) {
  opts = opts || {};
  const width  = Number.isFinite(opts.width) ? opts.width : 1080;
  const dpr    = Number.isFinite(opts.deviceScaleFactor) ? opts.deviceScaleFactor : 2;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 30000;

  const puppeteer = _puppeteerLazy();
  if (!puppeteer) {
    return { ok: false, reason: 'puppeteer_unavailable', error: 'puppeteer module not installed in this environment' };
  }

  let browser = null;
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
    try {
      await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve());
    } catch (_e) { /* ignore */ }

    const height = await page.evaluate(() => {
      const root = document.querySelector('.foh-card') || document.body;
      const rect = root.getBoundingClientRect();
      const bodyStyle = getComputedStyle(document.body);
      const padTop    = parseInt(bodyStyle.paddingTop, 10)    || 0;
      const padBottom = parseInt(bodyStyle.paddingBottom, 10) || 0;
      return Math.ceil(rect.height + padTop + padBottom);
    });
    await page.setViewport({ width, height: Math.max(height, 600), deviceScaleFactor: dpr });

    const result = await callback(page, { width, height, dpr });
    return result;
  } catch (e) {
    return { ok: false, reason: 'render_failed', error: e.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_e) { /* swallow */ }
    }
  }
}

async function renderHtmlToPng(html, opts) {
  const start = Date.now();
  return _withRenderedPage(html, opts, async (page, dims) => {
    const png = await page.screenshot({ type: 'png', omitBackground: false, fullPage: false });
    return {
      ok: true,
      png,
      width: dims.width,
      height: dims.height,
      devicePixelRatio: dims.dpr,
      elapsedMs: Date.now() - start,
      bytes: png.length,
    };
  });
}

async function renderHtmlToPdf(html, opts) {
  const start = Date.now();
  return _withRenderedPage(html, opts, async (page, dims) => {
    // PDF uses CSS-pixel dimensions (no DPR). Width matches the
    // card viewport, height matches the measured content. Vector
    // text — typically 30-70% smaller than the rasterised PNG.
    const pdf = await page.pdf({
      width:  dims.width + 'px',
      height: dims.height + 'px',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return {
      ok: true,
      pdf,
      width: dims.width,
      height: dims.height,
      elapsedMs: Date.now() - start,
      bytes: pdf.length,
    };
  });
}

// Render BOTH PNG and PDF in a single Puppeteer launch — saves
// ~60% wall-clock vs two separate launches. Returns
// `{ ok, png, pdf, width, height, devicePixelRatio, elapsedMs }`
// or `{ ok: false, reason, error }`. If only one of the two
// captures fails, the other is still returned with a per-format
// flag so callers can attach whatever succeeded.
async function renderHtmlBoth(html, opts) {
  const start = Date.now();
  return _withRenderedPage(html, opts, async (page, dims) => {
    let png = null, pngErr = null;
    let pdf = null, pdfErr = null;
    try {
      png = await page.screenshot({ type: 'png', omitBackground: false, fullPage: false });
    } catch (e) { pngErr = e.message; }
    try {
      pdf = await page.pdf({
        width:  dims.width + 'px',
        height: dims.height + 'px',
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } catch (e) { pdfErr = e.message; }
    if (!png && !pdf) {
      return { ok: false, reason: 'both_renders_failed', error: 'png:' + pngErr + ' · pdf:' + pdfErr };
    }
    return {
      ok: true,
      png,
      pdf,
      pngError: pngErr,
      pdfError: pdfErr,
      width: dims.width,
      height: dims.height,
      devicePixelRatio: dims.dpr,
      elapsedMs: Date.now() - start,
      pngBytes: png ? png.length : 0,
      pdfBytes: pdf ? pdf.length : 0,
    };
  });
}

module.exports = { renderHtmlToPng, renderHtmlToPdf, renderHtmlBoth };
