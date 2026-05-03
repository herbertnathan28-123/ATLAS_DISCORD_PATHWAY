'use strict';
// Spec Part 5 — Forward Expectation block.
// Required fields: expected behaviour, expected timing, daily movement context,
// movement already seen, estimated remaining movement, remaining-movement
// absorption direction, what trader is waiting for.

function build(input) {
  const { symbol, ctx, structure, calendar } = input;
  const assetClass = (structure && structure.assetClass) || inferClass(symbol);
  const lines = ['## Forward Expectation — Next Session Window'];
  lines.push('');

  const behaviour = expectedBehaviour(input);
  const timing    = expectedTiming(input);
  const movement  = dailyMovement(symbol, assetClass, structure);
  const absorb    = absorption(input, structure);
  const waiting   = waitingFor(input, structure);

  lines.push('**Expected Behaviour:** ' + behaviour);
  lines.push('');
  lines.push('**Expected Timing:** ' + timing);
  lines.push('');
  lines.push('**Daily Movement Context:**');
  lines.push('- Typical daily movement: ' + movement.typical);
  lines.push('- Movement already seen today: ' + movement.seen);
  lines.push('- Estimated remaining movement: ' + movement.remaining);
  lines.push('- Quality of remaining: ' + movement.quality);
  lines.push('');
  lines.push('**Remaining-Movement Absorption:** ' + absorb);
  lines.push('');
  lines.push('**What Trader Is Waiting For:** ' + waiting);
  return lines.join('\n');
}

function inferClass(sym) {
  if (!sym) return 'unknown';
  const s = String(sym).toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) return 'fx';
  if (/^(NAS100|US500|US30|DJI|GER40|UK100|SPX|NDX|HK50|JPN225)$/.test(s)) return 'index';
  if (/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s)) return 'commodity';
  if (/^[A-Z]{1,5}$/.test(s)) return 'equity';
  return 'unknown';
}

function expectedBehaviour(input) {
  const corey = input.corey || coreyBundle(input.ctx);
  const spidey = input.spidey || structureBundle(input.structure);
  const evHigh = highImpactInWindow(input.calendar, 2);
  if (evHigh) return 'Wait for catalyst — high-impact event inside the next ' + evHigh.hoursAway + 'h. Expect spreads to widen and the first move to often reverse.';
  if (Math.abs(corey.score) < 0.10 && Math.abs(spidey.score) < 0.10) return 'Range with possible drift — neither buyers nor sellers in control.';
  if (corey.score > 0.15 && spidey.score > 0.15) return 'Continuation higher into nearest liquidity cluster, conditional on the bullish trigger firing.';
  if (corey.score < -0.15 && spidey.score < -0.15) return 'Continuation lower into nearest demand zone, conditional on the bearish trigger firing.';
  if (Math.sign(corey.score) !== Math.sign(spidey.score)) return 'Chop — macro and structure disagree. Absorb remaining movement sideways until one side resolves.';
  return 'Conditions building — directional path not yet established.';
}

function expectedTiming(input) {
  const evHigh = highImpactInWindow(input.calendar, 24);
  if (evHigh && evHigh.hoursAway <= 2) return 'Inside the ' + evHigh.hoursAway + 'h pre-event window — no new entries.';
  if (evHigh) return 'Until the next high-impact catalyst (' + evHigh.title + ' in ' + evHigh.hoursAway + 'h).';
  const session = activeSession();
  if (session) return 'Most likely inside the active ' + session + ' session window; otherwise re-check after the next session open.';
  return 'No reliable time estimate is available. Structure confirmation is required before timing becomes useful.';
}

function dailyMovement(symbol, assetClass, structure) {
  // Pull from structure if provided; otherwise return a clear unknown-shape stub
  // so the field doesn't go silently empty.
  const atrUSD = structure && structure.atrDollars;
  const seenUSD = structure && structure.movementSeenDollars;
  const remUSD = atrUSD != null && seenUSD != null ? Math.max(0, atrUSD - seenUSD) : null;

  if (assetClass === 'equity' || assetClass === 'index' || assetClass === 'commodity') {
    return {
      typical:  atrUSD  != null ? '≈ $' + atrUSD.toFixed(2) + (assetClass === 'equity' ? '/share' : '') : 'unavailable — pass structure.atrDollars',
      seen:     seenUSD != null ? '≈ $' + seenUSD.toFixed(2) + ' so far'                                : 'unavailable — pass structure.movementSeenDollars',
      remaining: remUSD != null ? '≈ $' + remUSD.toFixed(2) + ' remaining'                              : 'unavailable',
      quality:  remUSD != null && remUSD > 0
        ? 'Remaining movement is not automatically tradable. In mixed conditions, unused range is often absorbed through chop, false breaks, or late-session drift.'
        : 'Remaining movement quality not assessable.'
    };
  }
  // FX path
  const atrPips  = structure && structure.atrPips;
  const seenPips = structure && structure.movementSeenPips;
  const remPips  = atrPips != null && seenPips != null ? Math.max(0, atrPips - seenPips) : null;
  return {
    typical:  atrPips  != null ? '$' + Math.round((atrPips * 10)).toLocaleString() + ' per 1.0 lot · ATR(14) ≈ ' + atrPips + ' pips' : 'unavailable',
    seen:     seenPips != null ? '$' + Math.round((seenPips * 10)).toLocaleString() + ' realised so far · ' + seenPips + ' pips'    : 'unavailable',
    remaining: remPips != null ? '$' + Math.round((remPips * 10)).toLocaleString()  + ' remaining · ' + remPips + ' pips'           : 'unavailable',
    quality:  remPips != null && remPips > 0
      ? 'Remaining movement is not automatically tradable. In mixed conditions, unused range is often absorbed through chop, false breaks, or late-session drift.'
      : 'Remaining movement quality not assessable.'
  };
}

function absorption(input, structure) {
  if (!structure) return 'no reliable directional assignment — pass structure data to populate this field.';
  if (structure.flow && /toward/i.test(structure.flow)) return 'upward into resistance/liquidity cluster — ' + structure.flow + '.';
  if (structure.flow && /away/i.test(structure.flow))   return 'downward into support/demand — ' + structure.flow + '.';
  if (Math.abs((structure.score || 0)) < 0.10)          return 'sideways inside range — no clean directional pressure.';
  return 'held back until catalyst — direction biased but not yet committed.';
}

function waitingFor(input, structure) {
  if (!structure) return 'A defined trigger condition with timeframe + level + close requirement.';
  if (structure.trigger) return structure.trigger;
  return 'A defined trigger condition with timeframe + level + close requirement before any entry can be authorised.';
}

function highImpactInWindow(calendar, hours) {
  const intel = calendar && calendar.intel;
  if (!intel) return null;
  const m = intel.match(/—\s*([\d.]+)h from now/);
  if (!m) return null;
  const h = parseFloat(m[1]);
  if (!isFinite(h) || h > hours) return null;
  const titleMatch = intel.match(/EVENT —\s*([^\n(]+)/);
  return { hoursAway: h.toFixed(1), title: titleMatch ? titleMatch[1].trim() : 'high-impact event' };
}

function activeSession() {
  const h = new Date().getUTCHours();
  if (h >= 0  && h < 7)  return 'Asia';
  if (h >= 7  && h < 12) return 'London';
  if (h >= 12 && h < 17) return 'London/NY overlap';
  if (h >= 17 && h < 22) return 'NY';
  return null;
}

function coreyBundle(ctx) {
  const dxyScore = ctx?.dxy?.score ?? 0;
  const vixScore = ctx?.vix?.score ?? 0;
  const yScore   = ctx?.yield?.score ?? 0;
  return { score: clamp((-dxyScore * 0.5) + (-vixScore * 0.3) + (yScore * 0.2), -1, 1) };
}
function structureBundle(s) {
  if (!s) return { score: 0 };
  if (typeof s.score === 'number') return { score: clamp(s.score, -1, 1) };
  const bias = (s.bias || 'neutral').toLowerCase();
  const conv = clamp(s.conviction || 0, 0, 1);
  const sign = bias.startsWith('bull') ? 1 : bias.startsWith('bear') ? -1 : 0;
  return { score: sign * conv };
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

module.exports = { build };
