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
  const marker = sourceMarker || '🔵 SOURCE / ENGINE STATUS';
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

function _sourceNoteLine(text, fallback) {
  const raw = _safeLine(text, fallback || 'Source: ATLAS scan engine · freshness: LIVE');
  const source = raw.match(/Source:\s*([^·\n]+)/i);
  const fresh = raw.match(/freshness:\s*([^·\n]+)/i);
  const confidence = raw.match(/confidence:\s*([^·\n]+)/i);
  if (source || fresh || confidence) {
    return [
      'Source: ' + _safeLine(source && source[1], 'ATLAS scan engine'),
      'freshness: ' + _safeLine(fresh && fresh[1], 'LIVE'),
    ].join(' · ');
  }
  return _truncate(raw, 140);
}

function _compactDarkHorseAdvice(viewModel) {
  const raw = String(viewModel.WHAT_TO_DO_NOW || '');
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const keep = [];
  const action = lines.find(line => /^\d+\./.test(line)) || lines[0];
  const confirmation = lines.find(line => /^CONFIRMATION:/i.test(line));
  const dollars = lines.find(line => /^\$\$:/i.test(line));
  if (action) keep.push(_truncate(action, 112));
  if (confirmation) keep.push(_truncate(confirmation, 96));
  if (dollars) keep.push(_truncate(dollars, 96));
  return keep.join('\n') || 'No standout advice block published this cycle.';
}

function _reportId(viewModel, opts, prefix) {
  return (opts && opts.reportId) || viewModel.REPORT_ID || (prefix + '-pending');
}

function _standoutCount(viewModel, opts) {
  if (Number.isFinite(opts && opts.standoutCount)) return opts.standoutCount;
  const subtitle = _safeLine(viewModel && viewModel.HEADER_SUBTITLE, '');
  const match = subtitle.match(/(\d+)\s+standouts?/i);
  return match ? Number(match[1]) : null;
}

function _marketsScanned(viewModel, opts) {
  if (Number.isFinite(opts && opts.universeSize)) return opts.universeSize;
  const subtitle = _safeLine(viewModel && viewModel.HEADER_SUBTITLE, '');
  const match = subtitle.match(/(\d+)\s+markets\s+scanned/i);
  return match ? Number(match[1]) : 'markets';
}

function _renderWhereToAct(viewModel) {
  const entry = _fieldFromBlock(viewModel.EVENT_DAY_REFERENCE, 'What to watch') || 'Entry only after the published entry/watch zone confirms.';
  const watch = _safeLine(viewModel.CONFIRMS_WHEN, 'Watch for confirmation through the published trigger.');
  const caution = _safeLine(viewModel.RISK_ESCALATION_CAUTION, 'Caution if the move stretches before confirmation or volatility spikes.');
  const invalidation = _safeLine(viewModel.CANCELS_WHEN, 'Invalidation prints if structure fails or the candidate drops from the next scan.');
  return [
    '🟠 WHERE TO ACT',
    'ENTRY: ' + _truncate(entry, 92),
    'WATCH: ' + _truncate(watch, 92),
    'CAUTION: ' + _truncate(caution, 92),
    'INVALIDATION: ' + _truncate(invalidation, 92),
  ].join('\n');
}

function renderDarkHorseSurface(viewModel, opts) {
  opts = opts || {};
  viewModel = viewModel || {};
  const standoutCount = _standoutCount(viewModel, opts);
  if (standoutCount === 0) return renderDarkHorseZeroStandoutSurface(viewModel, opts);

  const reportId = _reportId(viewModel, opts, 'DH');
  const generated = viewModel.GENERATED_AT_UTC || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lifecycle = _sectionLines(viewModel.BRIEFING_SUMMARY, 2, 82) || 'Lifecycle summary pending.';
  const currentAdvice = _compactDarkHorseAdvice(viewModel);
  const riskCap = (String(viewModel.WHAT_TO_DO_NOW || '').split('\n').find(line => /\$\$:/i.test(line)) || '').replace(/^\s*\$\$:\s*/i, '').trim();
  const chartReference = _fieldFromBlock(viewModel.EVENT_DAY_REFERENCE, 'Chart study') || _sectionLines(viewModel.EVENT_DAY_REFERENCE, 1, 96) || 'Chart reference pending.';
  const building = _sectionLines(viewModel.MARKET_IMPACT, 1, 105) || 'Building read pending.';
  const nextReview = opts.nextReviewUTC || 'Next scheduled Dark Horse scan.';
  const lines = [
    HARD_BOUNDARY,
    '🐎 NEW DARK HORSE SCAN',
    '╔════════════════════════════════════╗',
    '║ ATLAS · DARK HORSE · MOVEMENT DIGEST ║',
    '╚════════════════════════════════════╝',
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    'Part: 1/1',
    HARD_BOUNDARY,
    '🟡 LIFECYCLE SUMMARY',
    'Standouts on this scan: ' + (standoutCount == null ? 'published candidates' : standoutCount),
    lifecycle,
    '↳ Expanded Terminology: available from dashboard controls',
    '',
    '🟡 MARKET MOOD',
    viewModel.RISK_STATE_DISC_SCALE || 'market mood pending',
    '',
    '⚡ CURRENT ADVICE — AT RELEASE',
    'CURRENT ADVICE / WHAT TO DO NOW:',
    currentAdvice,
    '',
    '🟠 ENTRY / WATCH ZONE',
    _renderWhereToAct(viewModel),
    '',
    '💵 DOLLAR RISK / RISK CAP',
    _truncate(riskCap || 'Account-percentage risk cap only after entry reference, confirmation, and invalidation are published.', 100),
    '',
    '🔵 WHAT THIS MEANS',
    _truncate(building, 160),
    '',
    '🔵 WHAT TO DO NOW',
    '1. Treat the candidate as watch-listed until the entry/watch zone confirms.',
    '2. Size only from the published risk cap and invalidation reference.',
    '3. Stand down if confirmation fails before the next scan.',
    '',
    '✅ WHAT CONFIRMS',
    _truncate(_safeLine(viewModel.CONFIRMS_WHEN, 'Pending'), 100),
    '',
    '🟨 WHAT WOULD PROMOTE A CANDIDATE NEXT',
    _truncate(_safeLine(viewModel.CONFIRMS_WHEN, 'Score remains above release threshold, structure confirms the entry/watch zone, and macro/Jane alignment stays supportive.'), 140),
    '',
    '⛔ WHAT CANCELS',
    _truncate(_safeLine(viewModel.CANCELS_WHEN, 'Pending'), 100),
    '',
    '🟠 BUILDING / PRE-RADAR',
    building,
    '',
    '📈 CHART REFERENCE',
    chartReference + '; PNG attached when render succeeds.',
    '',
    '🧾 BRIEFING SUMMARY',
    lifecycle,
    '',
    '🟪 NEXT REVIEW',
    nextReview,
    '',
    '🔵 SOURCE / ENGINE STATUS',
    _sourceNoteLine(viewModel.SOURCE_PROVENANCE, 'Source: ATLAS scan engine · freshness: LIVE'),
    '',
    HARD_BOUNDARY,
    '✅ END OF DARK HORSE SCAN',
    'Report ID: ' + reportId,
    HARD_BOUNDARY,
  ];
  const maxChars = Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : 1800;
  return _truncateSurfaceText(lines.join('\n'), maxChars, '🔵 SOURCE / ENGINE STATUS');
}

function renderDarkHorseZeroStandoutSurface(viewModel, opts) {
  opts = opts || {};
  viewModel = viewModel || {};
  const reportId = _reportId(viewModel, opts, 'DH');
  const generated = viewModel.GENERATED_AT_UTC || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const scanned = _marketsScanned(viewModel, opts);
  const nextReview = opts.nextReviewUTC || 'Next scheduled Dark Horse scan: 15-minute cadence.';
  const source = _sourceNoteLine(viewModel.SOURCE_PROVENANCE, 'Source: ATLAS scan engine · freshness: LIVE');
  const lines = [
    HARD_BOUNDARY,
    '🐎 NEW DARK HORSE SCAN',
    '0 standouts · ' + scanned + ' markets scanned',
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    HARD_BOUNDARY,
    '',
    '🟡 MARKET MOOD',
    viewModel.RISK_STATE_DISC_SCALE || 'Risk/volatility state is neutral-to-watchful; no scan candidate reached the release bar.',
    '',
    '⚡ CURRENT ADVICE — AT RELEASE',
    'No Dark Horse entry priority this cycle. Do not force a setup. Wait for the next scan or listed promotion criteria.',
    '',
    '🔵 WHY NOTHING PROMOTED',
    _truncate(_sectionLines(viewModel.BRIEFING_SUMMARY, 2, 140) || 'No candidate cleared the Dark Horse release threshold; structure, score gap, volatility filter, or macro/Jane validation stayed incomplete.', 260),
    '',
    '🟠 BUILDING / PRE-RADAR',
    _truncate(_sectionLines(viewModel.MARKET_IMPACT, 1, 150) || 'No near-miss candidate qualified this cycle.', 180),
    '',
    '🟨 WHAT WOULD PROMOTE A CANDIDATE NEXT',
    _truncate(_safeLine(viewModel.CONFIRMS_WHEN, 'Score clears the release threshold, structure closes through the watch zone, retest holds, and macro/Jane alignment improves.'), 180),
    '',
    '🟥 WHAT CANCELS THE WATCH',
    _truncate(_safeLine(viewModel.CANCELS_WHEN, 'Structure fails, volatility spikes against the setup, macro conflict appears, or the candidate remains below threshold next scan.'), 180),
    '',
    '🟪 NEXT REVIEW',
    nextReview,
    '',
    '🔵 SOURCE / ENGINE STATUS',
    source,
    '',
    HARD_BOUNDARY,
    '✅ END DARK HORSE SCAN',
    'Report ID: ' + reportId,
    HARD_BOUNDARY,
  ];
  const maxChars = Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : 1800;
  return _truncateSurfaceText(lines.join('\n'), maxChars, '🔵 SOURCE / ENGINE STATUS');
}

module.exports = { renderDarkHorseSurface, renderDarkHorseZeroStandoutSurface };
