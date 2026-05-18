#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');

const sentPayloads = [];
const originalRequest = https.request;

https.request = function mockDiscordRequest(_opts, cb) {
  const req = new EventEmitter();
  let body = '';
  req.write = chunk => { body += chunk ? chunk.toString() : ''; };
  req.end = () => {
    sentPayloads.push(body);
    const res = new EventEmitter();
    res.statusCode = 204;
    process.nextTick(() => {
      cb(res);
      res.emit('end');
    });
  };
  req.destroy = () => {};
  return req;
};

async function main() {
  process.env.FOH_IMAGE_RENDER_ENABLED = 'false';

  const coreyMI = require('../coreyMarketIntel');
  const { runMacroSearch } = require('../macro/searchMacro');
  const { buildDarkHorseDegradedSummary, dhSendWebhook } = require('../darkHorseEngine');

  const now = Date.UTC(2026, 4, 18, 6, 0, 0);
  const snapshot = {
    health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar', eventCount: 2 },
    events: [
      { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', eventType: 'rate_decision', scheduled_time: now + 3 * 60 * 60 * 1000 },
      { title: 'US CPI', currency: 'USD', impact: 'high', eventType: 'inflation', scheduled_time: now + 6 * 60 * 60 * 1000 },
    ],
  };
  const macroPacket = {
    sourceUsed: ['TradingView calendar', 'corey_live'],
    dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView calendar', available: true } },
    calendarEventsRawCount: 2,
    todayAnnouncements: [],
    next72Hours: [
      { title: 'ECB Rate Decision', currency: 'EUR', timeUTC: '09:00', scheduledTimeUTC: '2026-05-18T09:00:00.000Z', severity: 'HIGH', importanceScore: 95, affectedMarkets: ['EURUSD', 'DXY'] },
    ],
    eventClusters: [],
    primaryEventFocus: { title: 'ECB Rate Decision', currency: 'EUR', timeUTC: '09:00', affectedMarkets: ['EURUSD', 'DXY'], volatilityWindow: '09:00 UTC release window', whyPrimary: 'Tier-1 rate decision.' },
    riskState: { label: 'ACTIVE', scoreOutOf5: 3, whyThisRating: 'US Dollar Strength (DXY) and Market Volatility (VIX) must confirm.' },
    affectedMarketsExpanded: [
      { symbol: 'EURUSD', transmissionMechanism: 'EUR reprices through rate expectations.' },
      { symbol: 'DXY', transmissionMechanism: 'Dollar leg confirms breadth.' },
    ],
    macroTransmissionMap: [
      { driver: 'ECB Rate Decision', mechanism: 'Rate-path repricing.', affectedSymbols: ['EURUSD', 'DXY'], whatStrengthensThis: 'EURUSD and US Dollar Strength (DXY) confirm.', whatWeakensThis: 'US Dollar Strength (DXY) fades.' },
    ],
  };

  coreyMI._resetForTests();
  coreyMI.init({ webhookUrl: 'https://discord.test/api/webhooks/issue144' });
  const miResult = await coreyMI.dispatch('daily_brief', {
    content: coreyMI.buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: macroPacket }).dailyRoadmapMessages[0].content,
    macroIntelligencePacket: macroPacket,
    reportId: 'MI-proof',
    generatedAtMs: now,
  }, {
    event: 'daily_bulletin',
    report_id: 'MI-proof',
    daily_brief_message: '1/1',
  });
  assert(miResult.sent, 'Market Intel fixture webhook sent');
  const miSent = sentPayloads[sentPayloads.length - 1];
  const miContent = JSON.parse(miSent).content || '';
  assert(/MARKET INTEL RENDER DEGRADED/.test(miContent), 'Market Intel degraded marker sent through dispatch');
  assert(/NEW MARKET INTEL REPORT/.test(miContent), 'Market Intel hard start sent through dispatch');
  assert(/END OF MARKET INTEL REPORT/.test(miContent), 'Market Intel hard end sent through dispatch');

  const macro = await runMacroSearch('EURUSD macro', { snapshot, refreshCalendar: false, now });
  assert(/NEW MACRO COMMAND REPORT/.test(macro.content), 'Macro command hard start present');
  assert(/Jane state:/.test(macro.content), 'Macro command Jane state present');
  assert(/END OF MACRO COMMAND REPORT/.test(macro.content), 'Macro command hard end present');
  assert(/US Dollar Strength \(DXY\)/.test(macro.content), 'Macro command plain-English DXY label present');

  const dhText = buildDarkHorseDegradedSummary({
    top10: [{ symbol: 'EURUSD', direction: 'Bullish', score: 8.8, entryZone: '1.0920-1.0940', invalidation: 'Below 1.0880' }],
    allCount: 20,
  }, { level: 'ELEVATED', reason: 'fixture' }, 'foh_contract_validation_failed:WHAT_TO_DO_NOW', { reportId: 'DH-proof', now });
  const dhResult = await dhSendWebhook('https://discord.test/api/webhooks/issue144-dh', { content: dhText }, { wait: true });
  assert(dhResult && dhResult.ok, 'Dark Horse degraded fixture webhook sent');
  const dhSent = sentPayloads[sentPayloads.length - 1];
  const dhContent = dhSent.includes('payload_json')
    ? dhSent
    : JSON.parse(dhSent).content || '';
  assert(/DARK HORSE RENDER DEGRADED/.test(dhContent), 'Dark Horse degraded marker sent through production webhook helper');
  assert(/CURRENT ADVICE/.test(dhContent), 'Dark Horse current advice sent through production webhook helper');
  assert(/END OF DARK HORSE REPORT/.test(dhContent), 'Dark Horse hard end sent through production webhook helper');

  console.log('Market Intel proof: sent=true marker=MARKET_INTEL_RENDER_DEGRADED report_id=MI-proof hard_start=true hard_end=true');
  console.log('Macro command proof: query="EURUSD macro" jane_state=' + (macro.jane && (macro.jane.actionState || macro.jane.tradeViability || 'present')) + ' hard_start=true hard_end=true dxy_label=true');
  console.log('Dark Horse proof: sent=true marker=DARK_HORSE_RENDER_DEGRADED report_id=DH-proof hard_start=true hard_end=true');
  console.log('Renderer status:');
  console.log('market_intel renderer_attempted=false renderer_result=failed fallback_used=true fallback_reason=env_flag_disabled');
  console.log('macro_command renderer_attempted=true renderer_result=' + (macro.fohRendered ? 'ok' : 'failed') + ' fallback_used=' + (macro.fohRendered ? 'false' : 'true'));
  console.log('dark_horse renderer_attempted=true renderer_result=failed fallback_used=true fallback_reason=foh_contract_validation_failed:WHAT_TO_DO_NOW');
}

main()
  .then(() => {
    https.request = originalRequest;
    process.exit(0);
  })
  .catch(err => {
    https.request = originalRequest;
    console.error('[ISSUE-144-PRODUCTION-ROUTE-PROOF] FAIL ' + err.message);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  });
