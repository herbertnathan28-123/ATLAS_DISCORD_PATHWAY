'use strict';

// Shared Dark Horse price-point logic for FOH surfaces.
// Keeps instrument units, buffer floors, and account-risk wording in one place.

function _upper(v) {
  return String(v || '').toUpperCase();
}

function _roundToTick(v, tick) {
  if (!Number.isFinite(v) || !Number.isFinite(tick) || tick <= 0) return v;
  return Math.round(v / tick) * tick;
}

function classifyInstrument(symbol, section) {
  const s = _upper(symbol);
  const sec = String(section || '').toLowerCase();
  const isMetal = /^(XAU|XAG)[A-Z]*$/.test(s);
  const isJpy = /JPY$/.test(s);
  const isFx = !isMetal && (/^fx_/.test(sec) || /^[A-Z]{6}$/.test(s));

  if (isMetal) return s.startsWith('XAG') ? 'metal_silver' : 'metal_gold';
  if (isFx && isJpy) return 'fx_jpy';
  if (isFx) return 'fx';
  if (sec === 'indices' || /^(US30|US500|NAS100|SPX|DJI|GER40|UK100|JPN225|AUS200|STOXX50)$/.test(s)) return 'index';
  if (sec === 'equities') return 'equity';
  return 'other';
}

function profileForInstrument(symbol, section, volatility, referencePrice) {
  const kind = classifyInstrument(symbol, section);
  const lvl = String((volatility && volatility.level) || volatility || '').toLowerCase();
  const volMult = lvl === 'extreme' ? 1.5 : lvl === 'elevated' ? 1.25 : 1;
  const ref = Math.abs(Number(referencePrice) || 0);

  let profile;
  if (kind === 'fx_jpy') {
    profile = {
      kind,
      tick: 0.001,
      decimals: 3,
      minBuffer: 0.02,
      unitType: 'JPY FX pips',
      unitReason: 'JPY pairs use 0.01 as one pip and 0.001 as one pipette.',
    };
  } else if (kind === 'fx') {
    profile = {
      kind,
      tick: 0.00001,
      decimals: 5,
      minBuffer: 0.0002,
      unitType: 'FX pips / pipettes',
      unitReason: 'FX pairs use 0.0001 as one pip and 0.00001 as one pipette.',
    };
  } else if (kind === 'metal_gold') {
    profile = {
      kind,
      tick: 0.10,
      decimals: 2,
      minBuffer: 1.00,
      unitType: 'metal points / ticks',
      unitReason: 'Gold uses metal points and 0.10 ticks; FX pip logic is not applied.',
    };
  } else if (kind === 'metal_silver') {
    profile = {
      kind,
      tick: 0.01,
      decimals: 2,
      minBuffer: 0.05,
      unitType: 'metal points / ticks',
      unitReason: 'Silver uses metal points and 0.01 ticks; FX pip logic is not applied.',
    };
  } else if (kind === 'index') {
    profile = {
      kind,
      tick: 0.25,
      decimals: 2,
      minBuffer: Math.max(5.00, ref * 0.0004),
      unitType: 'index points',
      unitReason: 'Indices use index-point distance, not pips.',
    };
  } else if (kind === 'equity') {
    profile = {
      kind,
      tick: 0.01,
      decimals: 2,
      minBuffer: Math.max(0.05, ref * 0.0005),
      unitType: 'dollars / cents',
      unitReason: 'Equities use dollars and cents.',
    };
  } else {
    profile = {
      kind,
      tick: 0.01,
      decimals: 2,
      minBuffer: Math.max(0.05, ref * 0.0005),
      unitType: 'price points',
      unitReason: 'Fallback uses native price points until the instrument class is explicit.',
    };
  }

  const buffer = Math.max(profile.tick, _roundToTick(profile.minBuffer * volMult, profile.tick));
  return Object.assign({}, profile, {
    buffer,
    volatilityMultiplier: volMult,
    bufferReason: profile.unitReason + (volMult !== 1 ? ' Current volatility applies a ' + volMult.toFixed(2).replace(/\.?0+$/, '') + 'x structural adjustment.' : ''),
  });
}

function formatPrice(v, profile) {
  if (!Number.isFinite(v)) return 'pending';
  const decimals = profile && Number.isFinite(profile.decimals) ? profile.decimals : 2;
  return v.toFixed(decimals);
}

function formatDistance(distance, profile) {
  if (!Number.isFinite(distance)) return 'pending';
  const d = Math.abs(distance);
  if (profile.kind === 'fx') {
    const pips = d / 0.0001;
    const pipettes = d / 0.00001;
    return pips.toFixed(1) + ' pips / ' + pipettes.toFixed(0) + ' pipettes (' + formatPrice(d, profile) + ')';
  }
  if (profile.kind === 'fx_jpy') {
    const pips = d / 0.01;
    const pipettes = d / 0.001;
    return pips.toFixed(1) + ' JPY pips / ' + pipettes.toFixed(0) + ' pipettes (' + formatPrice(d, profile) + ')';
  }
  if (profile.kind === 'metal_gold' || profile.kind === 'metal_silver') {
    const ticks = profile.tick > 0 ? d / profile.tick : 0;
    return formatPrice(d, profile) + ' metal points / ' + ticks.toFixed(0) + ' ticks';
  }
  if (profile.kind === 'index') {
    return formatPrice(d, profile) + ' index points';
  }
  if (profile.kind === 'equity') {
    return '$' + formatPrice(d, profile) + ' / ' + Math.round(d * 100) + ' cents';
  }
  return formatPrice(d, profile) + ' price points';
}

function riskCapForLifecycle(lifecycle, volatility) {
  const stage = String((lifecycle && lifecycle.stage) || lifecycle || '').toUpperCase();
  const lvl = String((volatility && volatility.level) || volatility || '').toLowerCase();
  let pct = 0.75;
  let label = 'reduced account-risk cap';
  if (stage === 'FRESH') {
    pct = 0.50;
    label = 'fresh-card cap';
  } else if (stage === 'FADING') {
    pct = 0.25;
    label = 'late-stage cap';
  } else if (stage === 'STILL ACTIVE') {
    pct = 1.00;
    label = 'standard account-risk cap';
  }
  if (stage === 'STILL ACTIVE' && lvl === 'elevated') {
    pct = 0.70;
    label += ' after elevated-mood reduction';
  } else if (lvl === 'extreme') {
    pct = Math.min(pct, 0.50);
    label += ' after extreme-mood reduction';
  }
  return { pct, text: pct.toFixed(2).replace(/\.?0+$/, '') + '% account equity', label };
}

function buildPlanFromBands(record, bands, lifecycle, volatility) {
  if (!record || !bands) return null;
  const symbol = _upper(record.symbol);
  const profile = profileForInstrument(symbol, record.section, volatility, bands.trigger);
  const entryMid = Number.isFinite(bands.entryLow) && Number.isFinite(bands.entryHigh)
    ? (bands.entryLow + bands.entryHigh) / 2
    : bands.trigger;
  const technicalDistance = Number.isFinite(entryMid) && Number.isFinite(bands.invalidation)
    ? Math.abs(entryMid - bands.invalidation)
    : null;
  const isShort = !!bands.isShort;
  const direction = isShort ? 'short' : 'long';
  const side = isShort ? 'below' : 'above';
  const bandEdge = isShort ? bands.entryHighText : bands.entryLowText;
  const invalidSide = isShort ? 'above' : 'below';
  const riskCap = riskCapForLifecycle(lifecycle, volatility);
  return {
    symbol,
    direction,
    unitType: profile.unitType,
    entryReferencePrice: bands.entryLowText + ' - ' + bands.entryHighText,
    decisionLevel: bands.triggerText,
    confirmationCondition: '5m candle opens inside ' + bands.entryLowText + ' - ' + bands.entryHighText + ' and closes ' + side + ' ' + bandEdge + '; next candle must hold ' + side + ' ' + bands.triggerText + '.',
    invalidationExitPrice: bands.invalidationText,
    invalidationCondition: '1H close ' + invalidSide + ' ' + bands.invalidationText + ' invalidates the ' + direction + ' idea; exposure is flattened at the published invalidation / exit price.',
    minimumAtlasBuffer: formatDistance(profile.buffer, profile),
    technicalDistance: formatDistance(technicalDistance, profile),
    bufferReason: profile.bufferReason,
    riskBasis: 'Account-percentage risk only: size so loss at ' + bands.invalidationText + ' is no more than ' + riskCap.text + ' (' + riskCap.label + ').',
    riskCap,
  };
}

function buildPlanFromEvidence(record, volatility, lifecycle) {
  const ev = record && record.evidenceAnchors;
  if (!ev || ev.availability === 'pending') return null;
  const isShort = String(record.direction || '').toLowerCase() === 'bearish';
  const anchor = isShort ? ev.recentLow : ev.recentHigh;
  const inv = ev.invalidation;
  if (!anchor || !Number.isFinite(anchor.price) || !inv || !Number.isFinite(inv.price)) return null;
  const profile = profileForInstrument(record.symbol, record.section, volatility, anchor.price);
  const trigger = _roundToTick(anchor.price, profile.tick);
  const buffer = profile.buffer;
  const entryLow = _roundToTick(trigger - buffer, profile.tick);
  const entryHigh = _roundToTick(trigger + buffer, profile.tick);
  const invalidation = _roundToTick(isShort ? inv.price + buffer : inv.price - buffer, profile.tick);
  return buildPlanFromBands(record, {
    isShort,
    trigger,
    triggerText: formatPrice(trigger, profile),
    entryLow,
    entryLowText: formatPrice(entryLow, profile),
    entryHigh,
    entryHighText: formatPrice(entryHigh, profile),
    invalidation,
    invalidationText: formatPrice(invalidation, profile),
  }, lifecycle, volatility);
}

module.exports = {
  classifyInstrument,
  profileForInstrument,
  formatPrice,
  formatDistance,
  riskCapForLifecycle,
  buildPlanFromBands,
  buildPlanFromEvidence,
};
