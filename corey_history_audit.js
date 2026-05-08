'use strict';

/**
 * ATLAS FX — Corey Clone Phase D audit logger.
 *
 * Structured logging for the historical-cache subsystem. All log lines
 * carry the [COREY-HISTORY] prefix and a structured payload. No secrets,
 * no API keys, no full URLs are ever logged. Endpoint paths are sanitised
 * so apikey query params are stripped.
 */

function ts() { return new Date().toISOString(); }

function sanitiseEndpoint(url) {
  if (typeof url !== 'string' || !url) return '';
  // Strip query string entirely. Keep only the bare URL.
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function sanitiseError(err) {
  if (!err) return '';
  const msg = (err && err.message) ? err.message : String(err);
  // Defensive: strip anything that looks like an api key.
  return msg.replace(/apikey=[^&\s]+/gi, 'apikey=[REDACTED]');
}

function emit(level, event, fields) {
  const payload = Object.assign({}, fields || {});
  // Ensure we never accidentally print a key
  if (payload && typeof payload === 'object') {
    for (const k of Object.keys(payload)) {
      if (/api[_-]?key|secret|token/i.test(k)) payload[k] = '[REDACTED]';
    }
  }
  const line = `[${ts()}] [COREY-HISTORY-${level}] ${event}`;
  const json = JSON.stringify(payload);
  if (level === 'ERROR') console.error(line, json);
  else                   console.log(line, json);
}

const audit = {
  info(event, fields)  { emit('INFO',  event, fields); },
  warn(event, fields)  { emit('WARN',  event, fields); },
  error(event, fields) { emit('ERROR', event, fields); },
  sanitiseEndpoint,
  sanitiseError,
};

module.exports = audit;
