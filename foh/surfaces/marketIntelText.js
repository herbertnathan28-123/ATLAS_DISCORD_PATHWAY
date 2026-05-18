'use strict';

const HARD_BOUNDARY = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function _truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

function _truncateSurfaceText(s, n, sourceMarker) {
  if (typeof s !== 'string') return '';
  if (!Number.isFinite(n) || s.length <= n) return s;
  const marker = sourceMarker || '🔵 SOURCE NOTE';
  const sourceIdx = s.lastIndexOf(marker);
  if (sourceIdx > 0) {
    const tailStart = Math.max(0, s.lastIndexOf('\n', sourceIdx - 1) + 1);
    const tail = s.slice(tailStart).trimStart();
    const headMax = Math.max(300, n - tail.length - 8);
    if (headMax > 0 && tail.length < n - 100) {
      return s.slice(0, headMax).trimEnd() + '\n…\n' + tail;
    }
  }
  return _truncate(s, n);
}

function _safeLine(s, fallback) {
  const out = String(s || '').replace(/\s+/g, ' ').trim();
  return out || fallback || 'Pending';
}

function _firstLines(text, count) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .join('\n');
}

function _sourceNoteLine(text, fallback) {
  const raw = _safeLine(text, fallback || 'Source: ATLAS runtime · freshness: LIVE');
  const source = raw.match(/Source:\s*([^·\n]+)/i);
  const fresh = raw.match(/freshness:\s*([^·\n]+)/i);
  const confidence = raw.match(/confidence:\s*([^·\n]+)/i);
  if (source || fresh || confidence) {
    return [
      'Source: ' + _safeLine(source && source[1], 'ATLAS runtime'),
      'freshness: ' + _safeLine(fresh && fresh[1], 'LIVE'),
    ].join(' · ');
  }
  return _truncate(raw, 120);
}

function _sectionLines(text, count, maxEach) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .map(line => maxEach ? _truncate(line, maxEach) : line)
    .join('\n');
}

function _fieldFromBlock(block, label) {
  const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'im');
  const match = String(block || '').match(re);
  return match ? _safeLine(match[1], '') : '';
}

function _affectedMarketsControl(viewModel) {
  const raw = String(viewModel.AFFECTED_MARKETS_EXPANDED || '');
  const symbols = [];
  for (const match of raw.matchAll(/(?:^|\n)-?\s*([^—\n]+?)\s+—/g)) {
    const s = _safeLine(match[1], '');
    if (s && !symbols.includes(s)) symbols.push(s);
  }
  if (!symbols.length) {
    const fallback = String(viewModel.PRIMARY_EVENT_FOCUS || '').match(/Affected markets:\s*([^\n]+)/i);
    if (fallback) symbols.push(...fallback[1].split(/[·,]/).map(s => s.trim()).filter(Boolean));
  }
  const primary = symbols.slice(0, 4).join(' · ') || 'Mapped markets pending';
  const secondary = symbols.slice(4, 6).join(' · ') || 'Full Brief';
  return [
    '🎯 AFFECTED MARKETS',
    'Primary: ' + primary,
    'Secondary: ' + secondary,
    'More: Full Brief',
  ].join('\n');
}

function _compactAffectedGuidance(viewModel, maxRows) {
  const raw = String(viewModel.AFFECTED_MARKETS_EXPANDED || '').trim();
  const rows = raw ? raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean) : [];
  if (!rows.length) return _affectedMarketsControl(viewModel);
  const out = rows.slice(0, maxRows || 2).map(block => {
    const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
    const instrument = _safeLine(lines[0], 'Mapped market');
    const stronger = _fieldFromBlock(block, 'STRONGER-THAN-EXPECTED') || _fieldFromBlock(block, 'STRONGER') || 'support path pending';
    const weaker = _fieldFromBlock(block, 'WEAKER-THAN-EXPECTED') || _fieldFromBlock(block, 'WEAKER') || 'pressure path pending';
    const confirm = _fieldFromBlock(block, 'CONFIRMATION') || 'validation pending';
    const invalid = _fieldFromBlock(block, 'INVALIDATION') || 'invalidation pending';
    return '• ' + instrument + ' — support: ' + _truncate(stronger, 30) + '; pressure: ' + _truncate(weaker, 30) + '; validate: ' + _truncate(confirm, 28) + '; invalidate: ' + _truncate(invalid, 26) + '.';
  });
  return [
    '🎯 AFFECTED MARKETS — SUPPORT / PRESSURE GUIDE',
    out.join('\n'),
  ].join('\n');
}

function _compactRoadmapSequence(viewModel) {
  const eventLines = String(viewModel.NEXT_24_TO_72_HOURS || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^(expected sensitivity|prep):/i.test(line))
    .slice(0, 2)
    .map(line => _truncate(line, 88))
    .join('\n');
  const seq = eventLines || _sectionLines(viewModel.NEXT_24_TO_72_HOURS, 2, 88);
  return seq || 'No 24–72h sequence published this cycle; monitor the next ranked release window.';
}

function _compactScenarioPaths(viewModel) {
  const focus = _fieldFromBlock(viewModel.PRIMARY_EVENT_FOCUS, 'Event') || 'Primary event pending';
  const why = _fieldFromBlock(viewModel.MARKET_IMPACT, 'Market impact') || _firstLines(viewModel.MARKET_IMPACT, 1) || 'market impact pending';
  const stronger = _fieldFromBlock(viewModel.FOUR_WAY_HIGHER, 'Behaviour') || 'stronger-than-expected path pending';
  const weaker = _fieldFromBlock(viewModel.FOUR_WAY_LOWER, 'Behaviour') || 'weaker-than-expected path pending';
  return [
    'Event: ' + _truncate(focus, 72),
    'Why it matters: ' + _truncate(why, 82),
    'Stronger-than-expected path: ' + _truncate(stronger, 82),
    'Weaker-than-expected path: ' + _truncate(weaker, 82),
  ].join('\n');
}

function _compactCalendar(text) {
  const line = _firstLines(text, 1);
  if (!line) return '';
  const parts = line.split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 4) return parts.slice(0, 4).join(' | ');
  return _truncate(line, 110);
}

function _reportId(viewModel, opts, prefix) {
  return (opts && opts.reportId) || viewModel.REPORT_ID || (prefix + '-pending');
}

function _controlBlock(mode) {
  if (mode === 'rendered') {
    return [
      '🧭 Controls: PNG/PDF · Full Calendar · Terms · Full Briefs Available / Brief Pending',
    ].join('\n');
  }
  return [
    '🧭 Controls: Full Calendar · Terms · Full Briefs Brief Pending · PNG/PDF pending.',
  ].join('\n');
}

function renderMarketIntelSurface(viewModel, opts) {
  opts = opts || {};
  viewModel = viewModel || {};
  const reportId = _reportId(viewModel, opts, 'MI');
  const generated = viewModel.GENERATED_AT_UTC || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const nextRefresh = opts.nextRefreshUTC || 'next scheduled refresh';
  const controlsMode = opts.controlsMode === 'pending' ? 'pending' : 'rendered';
  const calendar = _compactCalendar(viewModel.RANKED_EVENT_CALENDAR) || 'No ranked high-impact events available · Brief Pending';
  const roadmap = _compactRoadmapSequence(viewModel);
  const scenarioPaths = _compactScenarioPaths(viewModel);
  const briefLine = /Brief Pending/i.test(calendar) ? '🔗 FULL BRIEF: Brief Pending' : '🔗 FULL BRIEF: Available where linked';
  const confirms = _safeLine(viewModel.CONFIRMS_WHEN, 'Validation condition pending.');
  const cancels = _safeLine(viewModel.CANCELS_WHEN, 'Invalidation condition pending.');
  const structure = _sectionLines(viewModel.STRUCTURE_SNAPSHOT, 3, 96) || 'Structure status: NOT_INVOKED — structure read not supplied to this packet.';
  const clone = _sectionLines(viewModel.HISTORICAL_ANALOGUE, 5, 96) || 'Corey Clone status: NOT_INVOKED — historical analogue read not supplied to this packet.';
  const lines = [
    HARD_BOUNDARY,
    '🟨 NEW MARKET INTEL REPORT',
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    'Part: 1/1',
    HARD_BOUNDARY,
    _controlBlock(controlsMode),
    '',
    '🔴 THE CALL',
    _sectionLines(viewModel.THE_CALL, 2, 90) || 'Current read: MONITORING — no confirmed execution read yet.',
    '',
    '🟠 HIGH-IMPACT CALENDAR EVENTS',
    calendar,
    '',
    '🟡 RISK STATE',
    'Jane/FOH state: ' + (viewModel.RISK_STATE_DISC_SCALE || 'risk state pending'),
    '',
    '🔵 MARKET IMPACT / SCENARIO PATHS',
    'Market Impact: live catalyst path and confirmation map.',
    scenarioPaths,
    '',
    '🟣 ROADMAP INTEL — NEXT 24–72H SEQUENCE',
    roadmap,
    '',
    _compactAffectedGuidance(viewModel, 1),
    '',
    '🧭 EXPOSURE / NEW-RISK POSTURE',
    'Existing exposure: review stops/size before the window.',
    'New risk: Jane-gated only — no fresh direction until validation prints.',
    'Validation: ' + _truncate(confirms, 76),
    'Invalidation: ' + _truncate(cancels, 76),
    '',
    '🧱 Structure (Spidey Phase D)',
    structure,
    '',
    '🧬 Historical Analogue (Corey Clone)',
    clone,
    '',
    briefLine,
    '',
    '🔵 SOURCE NOTE',
    _sourceNoteLine(viewModel.SOURCE_PROVENANCE, 'Source: ATLAS runtime · freshness: LIVE'),
    '',
    HARD_BOUNDARY,
    '✅ END OF MARKET INTEL REPORT',
    'Report ID: ' + reportId,
    'Next scheduled refresh: ' + nextRefresh,
    HARD_BOUNDARY,
  ];
  const maxChars = Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : 1800;
  return _truncateSurfaceText(lines.join('\n'), maxChars, '🔵 SOURCE NOTE');
}

module.exports = { renderMarketIntelSurface };
