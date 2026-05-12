'use strict';
// Dark Horse — first-detection tracker (Lane 2 prototype).
//
// Purpose
// -------
// When the engine reports moveAge = 0 or null, plainTrendAge falls
// back to "no confirmed higher-timeframe <direction> bar yet". The
// operator wants more context in that fallback case: when ATLAS
// FIRST saw the symbol going in that direction, how long ago that
// was, and across how many scan cycles ATLAS has been tracking it.
//
// This module is a tiny in-memory tracker that records:
//   - firstDetectedAt   ms timestamp of the first scan that surfaced
//                       (symbol, direction)
//   - lastSeenAt        ms timestamp of the most recent scan
//   - scanCycles        number of scans where this (symbol, direction)
//                       appeared
//
// Hard boundaries (Lane 2)
// ------------------------
//   - Presentation state only. Does NOT influence scoring, thresholds,
//     ranking order, scheduler cadence, transport, cooldowns, or any
//     other engine decision.
//   - In-memory only. Resets when the process restarts. That matches
//     the existing cooldown/state pattern (also in-memory).
//   - Self-contained. No external dependencies.
//
// Garbage collection
// ------------------
// Keys are pruned when they haven't been seen for `staleMs` (default
// 14 days). Without pruning the map would grow unbounded across long
// uptime; with it the working set is bounded by the universe size.

const DEFAULT_STALE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const _state = new Map();
let _staleMs = DEFAULT_STALE_MS;

function _key(symbol, direction) {
  return `${symbol || ''}::${direction || 'neutral'}`;
}

// Record a sighting and return the post-tick snapshot. If a previous
// snapshot already existed for this (symbol, direction) we increment
// scanCycles and refresh lastSeenAt; otherwise we initialise.
function track(symbol, direction, now) {
  if (!symbol || !direction) return null;
  const t = Number.isFinite(now) ? now : Date.now();
  const k = _key(symbol, direction);
  const prior = _state.get(k);
  if (!prior) {
    const fresh = { firstDetectedAt: t, lastSeenAt: t, scanCycles: 1 };
    _state.set(k, fresh);
    return Object.assign({}, fresh);
  }
  prior.lastSeenAt = t;
  prior.scanCycles = (prior.scanCycles || 0) + 1;
  return Object.assign({}, prior);
}

// Read-only snapshot — never mutates the tracker. Returns null when
// the key has not been tracked yet.
function getSnapshot(symbol, direction) {
  if (!symbol || !direction) return null;
  const snap = _state.get(_key(symbol, direction));
  if (!snap) return null;
  return Object.assign({}, snap);
}

// Bulk tick for an entire scan. Useful to call once with the full
// ranked candidate set so the engine doesn't need to loop.
function trackMany(records, now) {
  if (!Array.isArray(records)) return [];
  return records.map((r) => track(r && r.symbol, r && r.direction, now));
}

// Garbage-collect stale entries. Run opportunistically from the
// engine after each scan; cheap because the map is small.
function pruneStale(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  for (const [k, v] of _state.entries()) {
    if (!v || !Number.isFinite(v.lastSeenAt)) {
      _state.delete(k);
      continue;
    }
    if (t - v.lastSeenAt > _staleMs) {
      _state.delete(k);
    }
  }
}

function size() {
  return _state.size;
}

// Test hooks. Production callers should not touch these.
function _resetForTests() {
  _state.clear();
  _staleMs = DEFAULT_STALE_MS;
}
function _setStaleMsForTests(ms) {
  _staleMs = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_STALE_MS;
}

// -----------------------------------------------------------------
// Presentation helper — format a snapshot as the "first detected"
// scaffolding sentence. Returns null when no snapshot. The fragment
// is designed to be appended to plainTrendAge's fallback string by
// the presenter.
//
// Output shape:
//   "first detected 2026-05-12 20:35 UTC (12m ago, tracked across 5 scan cycles)"
// -----------------------------------------------------------------

function _pad2(n) { return (n < 10 ? '0' : '') + n; }

function _fmtUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${_pad2(d.getUTCMonth() + 1)}-${_pad2(d.getUTCDate())} ` +
         `${_pad2(d.getUTCHours())}:${_pad2(d.getUTCMinutes())} UTC`;
}

function _fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min - hr * 60}m ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr - day * 24}h ago`;
}

function formatFirstDetectionFragment(snapshot, now) {
  if (!snapshot || !Number.isFinite(snapshot.firstDetectedAt)) return null;
  const t = Number.isFinite(now) ? now : Date.now();
  const cycles = Number.isFinite(snapshot.scanCycles) ? snapshot.scanCycles : 1;
  const cycleWord = cycles === 1 ? 'scan cycle' : 'scan cycles';
  return `first detected ${_fmtUtc(snapshot.firstDetectedAt)} ` +
         `(${_fmtElapsed(t - snapshot.firstDetectedAt)}, tracked across ${cycles} ${cycleWord})`;
}

module.exports = {
  track,
  trackMany,
  getSnapshot,
  pruneStale,
  size,
  formatFirstDetectionFragment,
  _resetForTests,
  _setStaleMsForTests,
  DEFAULT_STALE_MS,
};
