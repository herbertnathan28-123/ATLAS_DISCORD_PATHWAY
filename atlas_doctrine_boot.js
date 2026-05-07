'use strict';

/**
 * ATLAS Foundation Repair v1.0.1 — doctrine pipeline boot.
 *
 * Owns the wiring of the orchestrator + output surfaces into the existing
 * HTTP server. Lives in its own file so the static doctrine audit can
 * cleanly detect that runAnalysis / deliverToDiscord / publishToDashboard
 * are CALLED from a file reachable from the entry point.
 *
 * No business logic here — pure wiring. Output surfaces consume the Jane
 * decision packet only; this file does not import any evidence engine.
 */

const { runAnalysis } = require('./orchestrator');
const { deliverToDiscord } = require('./discord_output');
const { publishToDashboard } = require('./dashboard_session');

/**
 * Handle a POST /atlas/run request on the existing http server.
 * Returns true if handled, false otherwise. Accepts {symbol} in body or
 * ?symbol=... in query string.
 */
async function handleAtlasRun(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let symbol = null;
  try {
    const raw = JSON.parse(body || '{}');
    symbol = raw.symbol || raw.ticker || null;
  } catch (_e) { /* allow query */ }

  if (!symbol) {
    const q = req.url.indexOf('?');
    if (q >= 0) {
      const params = new URLSearchParams(req.url.slice(q + 1));
      symbol = params.get('symbol');
    }
  }

  if (!symbol) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'symbol required' }));
    return;
  }

  try {
    const decision = await runAnalysis(symbol);

    // Fan out to consume-only surfaces. Errors are isolated per surface so
    // one delivery failure cannot poison the others.
    const discordResult = await deliverToDiscord(decision).catch(e => {
      console.error('[atlas-doctrine-boot] discord delivery error:', e.message);
      return { error: e.message };
    });
    const dashboardResult = await publishToDashboard(decision).catch(e => {
      console.error('[atlas-doctrine-boot] dashboard publish error:', e.message);
      return { error: e.message };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      decision,
      delivery: { discord: discordResult, dashboard: dashboardResult },
    }));
  } catch (err) {
    console.error('[atlas-doctrine-boot] runAnalysis failed:', err && err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err && err.message }));
  }
}

/**
 * Direct invocation helper (used by background tasks / Discord commands /
 * tests). Calls the full pipeline and the consume-only surfaces.
 */
async function runDoctrinePipeline(symbol) {
  const decision = await runAnalysis(symbol);
  await deliverToDiscord(decision).catch(e => {
    console.error('[atlas-doctrine-boot] discord delivery error:', e.message);
  });
  await publishToDashboard(decision).catch(e => {
    console.error('[atlas-doctrine-boot] dashboard publish error:', e.message);
  });
  return decision;
}

module.exports = {
  handleAtlasRun,
  runDoctrinePipeline,
};
