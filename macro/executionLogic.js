'use strict';
// §9 Execution Logic. Strict IF / THEN format; no storytelling.
// Folds the buyer / seller / price confirmation copy that previously
// lived in TRIGGER MAP (now deleted as a standalone section).
// Operator-facing wording — no AUTHORISED / TRIGGER / BLOCKED.

function build(input) {
  const { structure, calendar, ctx, tagsUsed, symbol } = input;
  if (tagsUsed) tagsUsed.push('confirmation', 'stop_loss', 'BOS', 'CHoCH');

  const lines = ['## EXECUTION LOGIC — ' + (symbol || '')];
  lines.push('');
  lines.push('| Condition | Action |');
  lines.push('|---|---|');

  // Buyer / Seller / Price confirmation rows (folded from TRIGGER MAP).
  const tf = (structure && structure.confirmTimeframe) || '15M';
  if (structure?.buyerConfirm || structure?.confirmHigh || structure?.entry) {
    const lvl = structure.buyerConfirm || structure.confirmHigh || structure.entry;
    lines.push(`| Buyer confirmation: full ${tf} candle body closes above ${lvl} | THEN buyers have broken the latest short-term high; treat as buyer confirmation |`);
  }
  if (structure?.sellerConfirm || structure?.confirmLow) {
    const lvl = structure.sellerConfirm || structure.confirmLow;
    lines.push(`| Seller confirmation: full ${tf} candle body closes below ${lvl} | THEN sellers have broken the latest short-term low; treat as seller confirmation |`);
  }
  if (structure?.priceConfirm) {
    lines.push(`| Price confirmation: ${structure.priceConfirm} | THEN treat the directional read as confirmed by the next bar's hold |`);
  }
  if (structure?.confirmedBuyerControl) {
    lines.push(`| Confirmed buyer control: ${structure.confirmedBuyerControl} | THEN buyers are in clean control on the primary timeframe; bias entries up |`);
  }
  if (structure?.confirmedSellerControl) {
    lines.push(`| Confirmed seller control: ${structure.confirmedSellerControl} | THEN sellers are in clean control on the primary timeframe; bias entries down |`);
  }

  // Confirmation row.
  if (structure?.trigger) {
    lines.push(`| IF ${structure.trigger} prints on the primary timeframe | THEN take entry at ${structure.entry ?? 'the defined entry level'} |`);
  } else if (!structure?.buyerConfirm && !structure?.sellerConfirm) {
    // No buyer or seller control level has been published yet. The
    // copy must NOT reference a "listed level" because none exists.
    // Operator-facing per the locked wording standard.
    lines.push(`| IF no buy or sell level is reliable enough to publish | THEN do not place limit orders. ATLAS must first identify a reliable buyer-control level or seller-control level before it can publish an entry, exit, and stop-loss. |`);
    lines.push(`| Status now | No buyer or seller control level is currently reliable enough to publish. |`);
  }

  // Stop loss row
  if (structure?.stopLoss != null) {
    lines.push(`| IF price closes through ${structure.stopLoss} on the primary timeframe | THEN exit at market — the read is invalidated |`);
  } else {
    lines.push(`| IF stop loss is not yet defined | THEN do not enter — undefined risk fails the operational standard |`);
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
    lines.push(`| IF inside the first 5 minutes after release | THEN do not trade — wait for primary-timeframe structure to reform |`);
  }

  // Macro override rows
  if (ctx?.vix?.level === 'High' || ctx?.vix?.level === 'Extreme') {
    lines.push(`| IF the market fear / volatility gauge (VIX) regime is High or Extreme | THEN halve position size and tighten stops |`);
  }
  if (ctx?.dxy?.bias === 'Bullish' && (input.symbol || '').endsWith('USD')) {
    lines.push(`| IF the US Dollar Index (DXY) bias is bullish AND the pair quotes against the US dollar | THEN bias entries with the dollar direction unless structure clearly disagrees |`);
  }

  return lines.join('\n');
}

module.exports = { build };
