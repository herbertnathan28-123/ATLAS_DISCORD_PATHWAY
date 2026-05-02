'use strict';
// §9 Execution Logic. Strict IF / THEN format; no storytelling.

function build(input) {
  const { structure, calendar, ctx, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('trigger', 'stop_loss', 'BOS', 'CHoCH');

  const lines = ['## Execution Logic'];
  lines.push('');
  lines.push('| Condition | Action |');
  lines.push('|---|---|');

  // Trigger row
  if (structure?.trigger) {
    lines.push(`| IF ${structure.trigger} prints on the trigger timeframe | THEN authorise entry at ${structure.entry ?? 'defined entry'} |`);
  } else {
    lines.push(`| IF a trigger condition is not yet defined | THEN do not place limit orders; wait for structure to print BOS / CHoCH |`);
  }

  // Stop loss row
  if (structure?.stopLoss != null) {
    lines.push(`| IF price closes through ${structure.stopLoss} | THEN exit at market — the idea is invalidated |`);
  } else {
    lines.push(`| IF stop loss is not defined | THEN do not enter — undefined risk fails the operational standard |`);
  }

  // Targets row
  if (structure?.targets?.length) {
    lines.push(`| IF price reaches ${structure.targets[0]} | THEN scale or partial-close per plan; trail to break-even on remainder |`);
    if (structure.targets[1]) lines.push(`| IF price reaches ${structure.targets[1]} | THEN reduce to runner; trail with structural stop |`);
  }

  // Event override rows
  const intel = calendar?.intel;
  const blockMatch = intel && intel.match(/—\s*([\d.]+)h from now/);
  if (blockMatch && parseFloat(blockMatch[1]) <= 2) {
    lines.push(`| IF inside the 2h pre-event window | THEN do not open new positions; trail or reduce existing |`);
    lines.push(`| IF inside first 5 minutes after release | THEN do not trade — wait for LTF structure to reform |`);
  }

  // Macro override rows
  if (ctx?.vix?.level === 'High' || ctx?.vix?.level === 'Extreme') {
    lines.push(`| IF VIX regime is High / Extreme | THEN halve position size and tighten stops |`);
  }
  if (ctx?.dxy?.bias === 'Bullish' && (input.symbol || '').endsWith('USD')) {
    lines.push(`| IF USD bias is Bullish AND pair quotes vs USD | THEN bias entries with the USD direction unless structure clearly disagrees |`);
  }

  return lines.join('\n');
}

module.exports = { build };
