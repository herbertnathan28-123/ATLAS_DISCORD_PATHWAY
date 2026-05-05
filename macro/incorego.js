'use strict';
// macro/incorego.js — Corey contribution layer rendered as IN / CO / RE / GO.
//
//   IN — Internal: asset / company / instrument-specific drivers
//   CO — Country:  domestic economy, central bank, inflation, labour, GDP,
//                  retail, PMIs, rates, yields
//   RE — Regional: session / regional pressure, correlated markets, regional
//                  risk tone
//   GO — Global:   DXY, VIX, yields, commodities, risk-on/off, geopolitical
//                  / global catalyst pressure
//
// Builds a structured Corey contribution from `corey` (output of runCorey).
// Returns:
//   {
//     coreyStatus: 'OK' | 'PARTIAL' | 'UNAVAILABLE',
//     coreyContributionSummary,
//     incorego: { IN, CO, RE, GO },
//     activeCatalystWindow,
//     nextEventTime,
//     nextEvent,
//     coreyEffectOnJaneProbability: 'supports'|'weakens'|'caps'|'neutral',
//     probabilityCap: number|null,
//     coreyClone: { status, contribution|null }
//   }
//
// The output is consumed by:
//   - postJanePacketToDashboard (sent to dashboard as ctx.coreyContribution)
//   - the Discord macro presenter (rendered as a leading IN/CO/RE/GO section)
//   - the [DATA-SOURCE] log emitter (corey=OK|PARTIAL|UNAVAILABLE)

const ASSET_CLASS = Object.freeze({
  EQUITY: 'equity', INDEX: 'index', COMMODITY: 'commodity', FX: 'fx', UNKNOWN: 'unknown'
});

function fmtNumber(v, dp = 2) {
  return Number.isFinite(v) ? Number(v).toFixed(dp) : 'n/a';
}
function pct(v) {
  return Number.isFinite(v) ? Math.round(v * 100) + '%' : 'n/a';
}

function inferAssetClass(sym) {
  const s = String(sym || '').toUpperCase();
  if (/^(NAS100|US500|US30|GER40|UK100|HK50|JPN225|SPX|NDX|DJI)$/.test(s)) return ASSET_CLASS.INDEX;
  if (/^(XAUUSD|XAGUSD|BCOUSD|USOIL|NATGAS|XAUEUR|XAGEUR|WTIUSD|BRENT)$/.test(s)) return ASSET_CLASS.COMMODITY;
  if (/^[A-Z]{6}$/.test(s)) return ASSET_CLASS.FX;
  if (/^[A-Z]{1,5}$/.test(s)) return ASSET_CLASS.EQUITY;
  return ASSET_CLASS.UNKNOWN;
}

// ── INTERNAL — asset / company / pair / instrument-specific read ───────
function buildInternal(symbol, assetClass, corey) {
  const live = corey?.live || corey?.internalMacro?.global?.live || {};
  const sector = corey?.sector?.sector || corey?.internalMacro?.sector?.sector || null;
  const sectorScore = corey?.sector?.score ?? corey?.internalMacro?.sector?.score ?? null;
  switch (assetClass) {
    case ASSET_CLASS.INDEX: {
      const dxy = live?.dxy?.price;
      const vix = live?.vix?.price;
      const equity = live?.equityIndex?.level;
      const bits = [];
      if (Number.isFinite(equity)) bits.push(`Index proxy level ${fmtNumber(equity, 2)}`);
      if (Number.isFinite(vix)) bits.push(`VIX ${fmtNumber(vix, 2)} (vol regime input)`);
      if (Number.isFinite(dxy)) bits.push(`DXY ${fmtNumber(dxy, 2)} cross-pressure`);
      if (sector) bits.push(`Sector lens ${sector}${sectorScore != null ? ' score ' + fmtNumber(sectorScore, 2) : ''}`);
      return bits.length
        ? `Index ${symbol}: ${bits.join(' · ')}.`
        : `Index ${symbol}: instrument-specific drivers not detailed by Corey for this run.`;
    }
    case ASSET_CLASS.EQUITY: {
      const bits = [];
      if (sector) bits.push(`Sector ${sector}${sectorScore != null ? ' score ' + fmtNumber(sectorScore, 2) : ''}`);
      bits.push('Stock-specific catalysts (earnings · guidance · sector flow) not isolated in current Corey run');
      return `${symbol}: ${bits.join(' · ')}.`;
    }
    case ASSET_CLASS.FX: {
      const base = symbol.slice(0, 3);
      const quote = symbol.slice(3, 6);
      return `FX pair ${symbol}: ${base} vs ${quote} — pair-specific currency-leg flows not isolated; defer to country/regional/global layers below.`;
    }
    case ASSET_CLASS.COMMODITY:
      return `${symbol}: instrument-specific flows (inventory · production · seasonal demand) not detailed in current Corey run.`;
    default:
      return `${symbol}: asset-class-specific drivers not provided.`;
  }
}

// ── COUNTRY — domestic economy, central bank, rates, yields, labour ────
function buildCountry(symbol, assetClass, corey) {
  const cb = corey?.cb?.US || corey?.cb || null;
  const econ = corey?.econ?.US || corey?.econ || null;
  const live = corey?.live || corey?.internalMacro?.global?.live || {};
  const yieldSpread = live?.yield?.spread;
  const us10y = live?.yield?.us10y || live?.yield?.tenYear || null;
  const bits = [];
  if (cb && cb.bank) {
    bits.push(`${cb.bank}${cb.stance ? ' stance ' + cb.stance : ''}${cb.rateCycle ? ' · cycle ' + cb.rateCycle : ''}`);
  } else {
    bits.push('Central-bank stance not detailed for this run');
  }
  if (Number.isFinite(us10y))      bits.push(`US10Y ${fmtNumber(us10y, 2)}%`);
  if (Number.isFinite(yieldSpread)) bits.push(`Yield spread ${fmtNumber(yieldSpread, 2)}bp`);
  if (econ && Number.isFinite(econ.composite)) bits.push(`Econ composite ${fmtNumber(econ.composite, 2)}`);
  if (assetClass === ASSET_CLASS.INDEX || assetClass === ASSET_CLASS.EQUITY) {
    bits.push('US macro · Fed/rates · inflation · labour · PMIs are the dominant country-layer inputs for this instrument');
  }
  return `Country layer: ${bits.join(' · ')}.`;
}

// ── REGIONAL — session, bloc behaviour, correlated markets ─────────────
function buildRegional(symbol, assetClass, corey) {
  const h = new Date().getUTCHours();
  const session =
    (h >= 0 && h < 7)   ? 'Asia / late-Asia'
    : (h >= 7 && h < 12)? 'London open'
    : (h >= 12 && h < 16)? 'London / NY overlap'
    : (h >= 16 && h < 21)? 'NY afternoon'
    :                      'post-NY / late-session drift';
  const live = corey?.live || corey?.internalMacro?.global?.live || {};
  const equityIndex = live?.equityIndex?.level;
  const bits = [`Session ${session} (UTC ${h}:00)`];
  if (Number.isFinite(equityIndex)) bits.push(`Equity bloc proxy ${fmtNumber(equityIndex, 2)}`);
  if (assetClass === ASSET_CLASS.INDEX || assetClass === ASSET_CLASS.EQUITY) {
    bits.push('US bloc tone is the dominant regional input · check correlated indices (SPX / NDX / DJI) for intra-bloc divergence');
  } else if (assetClass === ASSET_CLASS.FX) {
    bits.push('Cross-bloc session overlap is the dominant regional input for FX pairs');
  }
  return `Regional layer: ${bits.join(' · ')}.`;
}

// ── GLOBAL — DXY, VIX, yields, risk tone, geopolitical pressure ────────
function buildGlobal(symbol, assetClass, corey) {
  const g = corey?.internalMacro?.global || corey?.global || null;
  const live = corey?.live || g?.live || {};
  const bits = [];
  if (g?.dxyBias)   bits.push(`DXY bias ${g.dxyBias}${Number.isFinite(g.dxyScore) ? ' (' + fmtNumber(g.dxyScore, 2) + ')' : ''}`);
  else if (Number.isFinite(live?.dxy?.price)) bits.push(`DXY ${fmtNumber(live.dxy.price, 2)}`);
  if (g?.riskEnv)   bits.push(`Risk tone ${g.riskEnv}${Number.isFinite(g.riskScore) ? ' (' + fmtNumber(g.riskScore, 2) + ')' : ''}`);
  if (Number.isFinite(live?.vix?.price)) bits.push(`VIX ${fmtNumber(live.vix.price, 2)}`);
  if (Number.isFinite(live?.yield?.spread)) bits.push(`Yield curve ${fmtNumber(live.yield.spread, 2)}bp`);
  return bits.length
    ? `Global layer: ${bits.join(' · ')}.`
    : `Global layer: DXY · VIX · yields · risk tone not detailed in current Corey run.`;
}

function deriveCatalystWindow(corey) {
  // Try common field paths for an active calendar window.
  const cw = corey?.activeCatalystWindow || corey?.catalystWindow || corey?.catalysts?.activeWindow || null;
  if (cw && (cw.label || cw.summary || typeof cw === 'string')) {
    return typeof cw === 'string' ? cw : (cw.label || cw.summary);
  }
  // No high-impact print is the legitimate "no active window" answer.
  return 'No high-impact catalyst window currently active for the symbol.';
}
function deriveNextEvent(corey) {
  const ne = corey?.nextEvent || corey?.calendar?.nextEvent || corey?.catalysts?.next || null;
  if (!ne) return null;
  if (typeof ne === 'string') return { what: ne, whenISO: null, impact: null };
  return {
    what: ne.what || ne.title || ne.event || 'event',
    whenISO: ne.whenISO || ne.when || ne.timestamp || null,
    impact: ne.impact || ne.severity || null
  };
}

// Determine Corey's effect on Jane probability — supports / weakens / caps / neutral.
// Heuristic — the bot may also pass an explicit override via corey.effectOnJaneProbability.
function deriveProbabilityEffect(corey, jane) {
  if (corey?.effectOnJaneProbability) return String(corey.effectOnJaneProbability);
  if (jane?.coreyEffectOverride)       return String(jane.coreyEffectOverride);
  const align = corey?.combinedBias && jane?.finalBias
    ? (corey.combinedBias === jane.finalBias ? 'align'
        : (corey.combinedBias === 'Neutral' || jane.finalBias === 'Neutral' ? 'neutral' : 'oppose'))
    : 'neutral';
  if (align === 'align')   return 'supports';
  if (align === 'oppose')  return 'weakens';
  if (corey?.combinedBias === 'Neutral') return 'neutral';
  return 'caps';
}
function deriveProbabilityCap(corey, jane) {
  if (corey?.probabilityCap != null && Number.isFinite(corey.probabilityCap)) return Math.max(1, Math.min(5, corey.probabilityCap));
  // Corey weakens the trade when bias disagrees → cap probability at 3/5 if Jane was higher.
  const align = corey?.combinedBias && jane?.finalBias && corey.combinedBias !== jane.finalBias
                && corey.combinedBias !== 'Neutral' && jane.finalBias !== 'Neutral';
  return align ? 3 : null;
}

function classifyCoreyStatus(coreyOk, hasContribution) {
  if (!coreyOk)         return 'UNAVAILABLE';
  if (!hasContribution) return 'PARTIAL';
  return 'OK';
}

// Build the Corey clone block — explicit, never fake.
function buildCloneBlock(coreyClone) {
  if (!coreyClone) {
    return {
      status: 'UNAVAILABLE',
      sourceTag: 'unavailable: not implemented',
      contribution: null,
      note: 'Corey Clone unavailable — not implemented in current build. No second-pass validation has run. No contribution implied — do not infer agreement or disagreement from absence.'
    };
  }
  const c = coreyClone;
  const sourceTag = String(c.source || c.sourceTag || c.status || 'unavailable: not implemented');
  if (/not[\s_-]?implemented|unavailable/i.test(sourceTag)) {
    return {
      status: 'UNAVAILABLE',
      sourceTag,
      contribution: null,
      note: 'Corey Clone unavailable. No clone contribution is implied.'
    };
  }
  const hasContribution = c.contribution && (
    c.contribution.contradictions || c.contribution.missingDrivers || c.contribution.eventRisk ||
    c.contribution.analogue || c.contribution.sourceConfidence || c.contribution.summary
  );
  if (!hasContribution) {
    return {
      status: 'PARTIAL',
      sourceTag: `partial: active_but_no_contribution_provided`,
      contribution: null,
      note: 'Clone marked active but did not attach validation payload — no agreement implied.'
    };
  }
  return {
    status: 'OK',
    sourceTag,
    contribution: c.contribution,
    note: c.contribution.summary || null
  };
}

function buildIncorego({ symbol, corey, jane }) {
  const ac = inferAssetClass(symbol);
  const haveCorey = !!corey;
  const incorego = {
    IN: buildInternal(symbol, ac, corey),
    CO: buildCountry(symbol, ac, corey),
    RE: buildRegional(symbol, ac, corey),
    GO: buildGlobal(symbol, ac, corey)
  };
  // "Has a contribution" — at least 3 of 4 INCOREGO buckets must carry
  // numeric/structured content (not just session-time fallback or
  // "not detailed" boilerplate). This is the cosmetic-OK guard: if the
  // bot supplies only `combinedBias` with no live fields, we cannot
  // honestly call Corey OK. Status drops to PARTIAL.
  const thinPattern = /not provided|not detailed|not isolated|deferred|deferred? to|not in current packet/i;
  const numericPattern = /(?:\d+\.\d+|\d{2,})/;
  const numericBuckets = Object.values(incorego).filter(line => numericPattern.test(line) && !thinPattern.test(line)).length;
  const hasContribution = haveCorey && numericBuckets >= 3;

  const coreyStatus = classifyCoreyStatus(haveCorey, hasContribution);
  const summaryParts = [];
  if (haveCorey && corey.combinedBias)              summaryParts.push(`Corey composite bias: ${corey.combinedBias}${Number.isFinite(corey.combinedScore) ? ' (' + fmtNumber(corey.combinedScore, 2) + ')' : ''}.`);
  if (haveCorey && corey?.internalMacro?.global?.riskEnv) summaryParts.push(`Risk tone: ${corey.internalMacro.global.riskEnv}.`);
  if (!haveCorey) summaryParts.push('Corey contribution unavailable for this run.');
  const coreyContributionSummary = summaryParts.join(' ') || 'Corey contribution attached but thin — defer to per-layer breakdown below.';

  const probabilityEffect = deriveProbabilityEffect(corey || {}, jane || {});
  const probabilityCap    = deriveProbabilityCap(corey || {}, jane || {});

  return {
    coreyStatus,
    coreyContributionSummary,
    incorego,
    activeCatalystWindow: deriveCatalystWindow(corey || {}),
    nextEvent: deriveNextEvent(corey || {}),
    nextEventTime: (function(){ const ne = deriveNextEvent(corey || {}); return ne && ne.whenISO ? ne.whenISO : null; })(),
    coreyEffectOnJaneProbability: probabilityEffect,
    probabilityCap,
    coreyClone: buildCloneBlock(corey?.clone || null)
  };
}

// Render the IN/CO/RE/GO block as Discord text. Used as the leading
// macro section after the actionable advisory header.
function renderIncoregoForDiscord({ symbol, incoregoBlock, jane, tradeProbability }) {
  if (!incoregoBlock) return '';
  const lines = [];
  lines.push(`🌐 **COREY READ — ${symbol}**  (status: ${incoregoBlock.coreyStatus})`);
  lines.push('');
  if (incoregoBlock.coreyContributionSummary) lines.push(incoregoBlock.coreyContributionSummary);
  lines.push('');
  lines.push('**INCOREGO**');
  lines.push(`• **IN** — ${incoregoBlock.incorego.IN}`);
  lines.push(`• **CO** — ${incoregoBlock.incorego.CO}`);
  lines.push(`• **RE** — ${incoregoBlock.incorego.RE}`);
  lines.push(`• **GO** — ${incoregoBlock.incorego.GO}`);
  lines.push('');
  lines.push('**COREY IMPACT ON JANE**');
  const probabilityNow = (jane && Number.isFinite(jane.tradeProbability)) ? jane.tradeProbability : tradeProbability;
  let impact;
  switch (incoregoBlock.coreyEffectOnJaneProbability) {
    case 'supports': impact = `Macro supports the active read · Trade Probability ${probabilityNow != null ? probabilityNow + '/5' : 'pending'} held / lifted by Corey.`; break;
    case 'weakens':  impact = `Macro weakens the active read · Trade Probability ${probabilityNow != null ? probabilityNow + '/5' : 'pending'} reduced / capped by Corey.`; break;
    case 'caps':     impact = `Macro neither strongly supports nor contradicts · Trade Probability ${probabilityNow != null ? probabilityNow + '/5' : 'pending'} held until structure confirms.`; break;
    default:         impact = `Macro neutral · no directional vote from Corey · Trade Probability ${probabilityNow != null ? probabilityNow + '/5' : 'pending'}.`;
  }
  lines.push(impact);
  if (incoregoBlock.probabilityCap != null) lines.push(`Probability capped at ${incoregoBlock.probabilityCap}/5 by Corey/INCOREGO read.`);
  lines.push(`Active catalyst window: ${incoregoBlock.activeCatalystWindow}`);
  if (incoregoBlock.nextEvent && (incoregoBlock.nextEvent.what || incoregoBlock.nextEvent.whenISO)) {
    lines.push(`Next event: ${incoregoBlock.nextEvent.what || 'event'}${incoregoBlock.nextEvent.whenISO ? ' · ' + incoregoBlock.nextEvent.whenISO : ''}${incoregoBlock.nextEvent.impact ? ' · impact ' + incoregoBlock.nextEvent.impact : ''}`);
  } else {
    lines.push('Next event: no upcoming event in active window from Corey/calendar feed.');
  }
  lines.push('');
  lines.push('**COREY CLONE**');
  if (incoregoBlock.coreyClone.status === 'OK' && incoregoBlock.coreyClone.contribution) {
    const c = incoregoBlock.coreyClone.contribution;
    if (c.summary) lines.push(c.summary);
    if (c.contradictions)  lines.push(`Contradictions: ${c.contradictions}`);
    if (c.missingDrivers)  lines.push(`Missing drivers: ${c.missingDrivers}`);
    if (c.eventRisk)       lines.push(`Event-risk check: ${c.eventRisk}`);
    if (c.analogue)        lines.push(`Historical analogue: ${c.analogue}`);
    if (c.sourceConfidence)lines.push(`Source confidence: ${c.sourceConfidence}`);
  } else {
    lines.push(incoregoBlock.coreyClone.note || 'Corey Clone unavailable / not implemented — no contribution implied.');
  }
  return lines.join('\n');
}

module.exports = { buildIncorego, renderIncoregoForDiscord, inferAssetClass };
