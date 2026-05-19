'use strict';
// §9 Execution Logic. Strict IF / THEN format; no storytelling.
// Folds the buyer / seller / price confirmation copy that previously
// lived in TRIGGER MAP (now deleted as a standalone section).
// Operator-facing wording — no AUTHORISED / TRIGGER / BLOCKED.

const { termLink } = require('./glossary');

function build(input) {
  const { structure, calendar, ctx, tagsUsed, symbol } = input;
  if (tagsUsed) tagsUsed.push('confirmation', 'stop_loss', 'BOS', 'CHoCH');

  const lines = ['## EXECUTION LOGIC — ' + (symbol || '')];
  lines.push('');
  const addRule = function (condition, action) {
    lines.push('**IF:** ' + condition);
    lines.push('**THEN:** ' + action);
    lines.push('');
  };

  // Buyer / Seller / Price confirmation rows (folded from TRIGGER MAP).
  const tf = (structure && structure.confirmTimeframe) || '15M';
  if (structure?.buyerConfirm || structure?.confirmHigh || structure?.entry) {
    const lvl = structure.buyerConfirm || structure.confirmHigh || structure.entry;
    addRule(`Buyer confirmation: full ${tf} candle body closes above ${lvl}`, 'buyers have broken the latest short-term high; treat as buyer confirmation');
  }
  if (structure?.sellerConfirm || structure?.confirmLow) {
    const lvl = structure.sellerConfirm || structure.confirmLow;
    addRule(`Seller confirmation: full ${tf} candle body closes below ${lvl}`, 'sellers have broken the latest short-term low; treat as seller confirmation');
  }
  if (structure?.priceConfirm) {
    addRule(`Price confirmation: ${structure.priceConfirm}`, "treat the directional read as confirmed by the next bar's hold");
  }
  if (structure?.confirmedBuyerControl) {
    addRule(`Confirmed buyer control: ${structure.confirmedBuyerControl}`, 'buyers are in clean control on the primary timeframe; bias entries up');
  }
  if (structure?.confirmedSellerControl) {
    addRule(`Confirmed seller control: ${structure.confirmedSellerControl}`, 'sellers are in clean control on the primary timeframe; bias entries down');
  }

  // Confirmation row.
  if (structure?.trigger) {
    addRule(`${structure.trigger} prints on the primary timeframe`, `take entry at ${structure.entry ?? 'the defined entry level'}`);
  } else if (!structure?.buyerConfirm && !structure?.sellerConfirm) {
    // No buyer or seller control level has been published yet. The
    // copy must NOT reference a "listed level" because none exists.
    // Operator-facing per the locked wording standard.
    addRule('No buy or sell level is reliable enough to publish', 'limit orders are not supported yet — ATLAS must first identify a reliable buyer-control level or seller-control level before an entry, exit, and stop-loss can be published.');
    lines.push('**Status now:** No buyer or seller control level is currently reliable enough to publish.');
    lines.push('');
  }

  // Stop loss row
  if (structure?.stopLoss != null) {
    addRule(`Price closes through ${structure.stopLoss} on the primary timeframe`, 'exit at market — the read is invalidated');
  } else {
    addRule(`${termLink('Stop Loss')} is not yet defined`, `entry is not yet supported — the operational risk standard requires a defined ${termLink('Stop Loss')} before risk can be priced.`);
  }

  // Targets row
  if (structure?.targets?.length) {
    addRule(`Price reaches ${structure.targets[0]}`, 'scale or partial-close per plan; trail to break-even on remainder');
    if (structure.targets[1]) addRule(`Price reaches ${structure.targets[1]}`, 'reduce to runner; trail with structural stop');
  }

  // Event override rows
  const intel = calendar?.intel;
  const blockMatch = intel && intel.match(/—\s*([\d.]+)h from now/);
  if (blockMatch && parseFloat(blockMatch[1]) <= 2) {
    addRule('Inside the 2h pre-event window', 'new positions are not supported inside the pre-event window; existing setups should be trailed or reduced.');
    addRule('Inside the first 5 minutes after release', 'trading is not supported inside the first 5 minutes after release — wait for primary-timeframe structure to reform before reassessing.');
  }

  // Macro override rows
  if (ctx?.vix?.level === 'High' || ctx?.vix?.level === 'Extreme') {
    addRule('Market Volatility (VIX) regime is High / Extreme', 'halve position size and tighten stops');
  }
  if (ctx?.dxy?.bias === 'Bullish' && (input.symbol || '').endsWith('USD')) {
    addRule('US Dollar Strength (DXY) bias is Bullish AND the pair quotes vs USD', 'bias entries with the USD direction unless structure clearly disagrees');
  }

  while (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

module.exports = { build };
