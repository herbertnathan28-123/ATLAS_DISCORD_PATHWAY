'use strict';
// Spec Part 6 — Trigger Map.
// Bullish shift / Bearish shift / No-trade condition / Timeframe note.
// Each direction: timeframe · level · candle-close requirement · fresh
// supply/demand or imbalance · catalyst condition · invalidation.

function build(input) {
  const { symbol, structure, calendar, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('BOS', 'CHoCH', 'imbalance', 'supply', 'demand', 'trigger');

  const lines = ['## Trigger Map — ' + (symbol || '<symbol>')];
  lines.push('');

  const bull = structure && structure.triggers && structure.triggers.bullish;
  const bear = structure && structure.triggers && structure.triggers.bearish;
  const noTr = structure && structure.triggers && structure.triggers.noTrade;
  const tfNote = structure && structure.triggers && structure.triggers.timeframeNote;

  lines.push(blockText('▲ BULLISH SHIFT', bull));
  lines.push('');
  lines.push(blockText('▼ BEARISH SHIFT', bear));
  lines.push('');
  if (noTr) {
    lines.push('**· NO-TRADE CONDITION:** ' + noTr);
  } else {
    lines.push('**· NO-TRADE CONDITION:** Inside the current range with no fresh impulse — no entry, no preempt limits.');
  }
  lines.push('');
  lines.push('*Timeframe note:* ' + (tfNote || '15M = aggressive intraday confirmation. 30M cleaner. 1H stronger. 4H broader structure. A break of a level is not an entry by itself — sequence: liquidity → structure break → candle close → identify fresh supply/demand or imbalance → pullback → confirmation/entry plan → invalidation → target.'));

  return lines.join('\n');
}

function blockText(header, t) {
  if (!t) return '**' + header + ':** Exact shift level unavailable — trade status remains blocked.';
  const rows = [
    '**' + header + '**',
    '- Timeframe: ' + (t.tf || 'unspecified — trade blocked'),
    '- Level: ' + (t.level || 'unavailable — trade blocked'),
    '- Candle-close requirement: ' + (t.close || 'unspecified'),
    '- Fresh demand / supply / imbalance: ' + (t.supply || 'required for entry permission'),
    '- Catalyst condition: ' + (t.catalyst || 'no high-impact event inside next 2h'),
    '- Invalidation: ' + (t.invalidation || 'undefined — trade blocked')
  ];
  return rows.join('\n');
}

module.exports = { build };
