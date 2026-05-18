#!/usr/bin/env node
'use strict';

const assert = require('assert');
const coreyCalendar = require('../corey_calendar');
const { runMacroSearch } = require('../macro/searchMacro');

const REQUIRED_QUERIES = [
  'EURUSD macro',
  'GBPUSD macro',
  'USDJPY macro',
  'AUDJPY macro',
  'DXY macro',
  'AMD macro',
  'NFP impact',
  'CPI impact',
  'FOMC Minutes impact',
  "today's major events",
  'next 72 hours macro',
];

const STALE_PATTERNS = [
  /CPI \+ ECB cluster/i,
  /ECB prototype/i,
  /old CPI/i,
  /old ECB/i,
  /next_major_event=none/i,
  /affected_symbols=n\/a/i,
];

function mustContain(content, label) {
  assert(content.includes(label), 'response contains ' + label);
}

(async () => {
  await coreyCalendar.refreshCalendar({ force: true });
  const snapshot = coreyCalendar.getCalendarSnapshot();
  console.log('[MACRO-SEARCH-QA] calendar_source=' + (snapshot.health && snapshot.health.source_used) + ' mode=' + (snapshot.health && snapshot.health.calendar_mode) + ' events=' + ((snapshot.events || []).length));
  assert((snapshot.events || []).length > 0, 'calendar returned events');

  for (const query of REQUIRED_QUERIES) {
    console.log('\n[MACRO-SEARCH-QA] query=' + query);
    const result = await runMacroSearch(query, { snapshot, refreshCalendar: false });
    assert(result.ok, query + ' returned ok');
    assert(result.proofLogs.some(l => l === '[MACRO-SEARCH] query=' + query), query + ' proof log includes query');
    assert(result.proofLogs.some(l => /^\[MACRO-SEARCH\] resolved_type=/.test(l)), query + ' proof log includes resolved type');
    assert(result.proofLogs.some(l => /^\[MACRO-SEARCH\] lead_symbol=/.test(l)), query + ' proof log includes lead symbol');
    assert(result.proofLogs.some(l => /^\[COREY\] status=/.test(l)), query + ' proof log includes Corey status');
    assert(result.proofLogs.some(l => /^\[COREY-CLONE\] status=.* usableForDecision=(true|false)$/.test(l)), query + ' proof log includes Corey Clone usability');
    assert(result.proofLogs.some(l => /^\[JANE\] final_state=(ARMED|MONITORING|STAND_DOWN|VALID|INVALID|PARTIAL|MARGINAL|WAITING_FOR_CONFIRMATION)$/.test(l)), query + ' proof log includes Jane final state');
    assert(result.proofLogs.some(l => /^\[FOH\] rendered=true$/.test(l)), query + ' proof log includes FOH rendered=true');
    assert(result.content.startsWith('🔥 **THE CALL**'), query + ' response starts with THE CALL');
    assert(/Current read: (ARMED|MONITORING|STAND_DOWN)/.test(result.content), query + ' response carries Jane-derived current read');
    mustContain(result.content, '**RISK STATE**');
    mustContain(result.content, '**Affected instruments**');
    mustContain(result.content, '**Key events driving the read**');
    mustContain(result.content, '**MARKET IMPACT**');
    mustContain(result.content, '**What strengthens the read**');
    mustContain(result.content, '**What weakens the read**');
    mustContain(result.content, '**Blocked / degraded**');
    mustContain(result.content, '**Source note**');
    mustContain(result.content, 'Jane remains final gate');
    for (const re of STALE_PATTERNS) {
      assert(!re.test(result.content), query + ' did not leak stale/prototype pattern ' + re);
    }
    if (query === 'AMD macro') {
      assert.strictEqual(result.resolution.resolved_type, 'symbol', 'AMD macro resolves as selected symbol');
      assert.strictEqual(result.resolution.resolved_target, 'AMD', 'AMD macro resolved target is AMD');
      assert.strictEqual(result.leadSymbol, 'AMD', 'AMD macro lead symbol remains AMD');
      assert(/Primary focus: AMD macro exposure/i.test(result.content), 'AMD macro primary focus is AMD anchored');
      assert(/AMD|NAS100|US500/.test(result.content), 'AMD macro content includes AMD/equity exposure set');
      assert(!/Primary focus:\s*GDP Growth Rate QoQ[^\n]*\/\s*JPY/i.test(result.content), 'AMD macro is not hijacked by JPY GDP calendar focus');
      assert(!/Corey Clone [^\n]*USDJPY\/1D\.jsonl/i.test(result.content), 'AMD macro does not surface USDJPY Corey Clone cache path');
    }
    if (result.content.indexOf('No matching live scheduled event') === -1) {
      assert(/affected: [^\n]+/.test(result.content), query + ' event rows include affected markets');
      assert(/Full Brief: (Brief Pending|https?:\/\/|\/market-intel\/brief\/)/.test(result.content), query + ' event rows include Full Brief or Brief Pending');
    }
    assert(!/(^|\n)\s*[-•]?\s*(DXY|VIX)\b/.test(result.content), query + ' does not lead user-facing lines with raw DXY/VIX');
    assert(!/\b(?:authorised|entry authorised|trade confirmed|trade permitted)\b/i.test(result.content), query + ' has no execution-authority wording');
    console.log('[MACRO-SEARCH-QA] ok resolved=' + result.resolution.resolved_type + ':' + result.resolution.resolved_target + ' lead=' + result.leadSymbol + ' final=' + (result.jane && (result.jane.actionState || result.jane.tradeViability)) + ' degraded=' + result.degradationReason);
  }

  console.log('\n[MACRO-SEARCH-QA] PASS — required macro search set clean');
  process.exit(0);
})().catch(err => {
  console.error('[MACRO-SEARCH-QA] FAIL ' + err.message);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
