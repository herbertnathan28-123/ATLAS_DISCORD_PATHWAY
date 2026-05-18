'use strict';

// ============================================================
// foh/validate/validateFohOutput.js
//
// Operator brief 2026-05-17 (assurance directive): pre-send
// validator. Runs in the dispatch controller BEFORE the
// Discord webhook POST. If any rule fails, the dispatcher does
// NOT send user-facing output — instead it returns the failure
// reason so the caller can log + fallback safely.
//
// validateFohOutput(args)  →  { ok, failures: [...], warnings: [...] }
//   args: { packet, viewModel, discordText, attachments }
// ============================================================

const C = require('../config/fohOutputContract');

function _len(s) { return typeof s === 'string' ? s.trim().length : 0; }

function _scanForBanned(text) {
  if (typeof text !== 'string' || !text.length) return [];
  const hits = [];
  for (const term of C.BANNED_TERMS_USERFACING) {
    if (text.indexOf(term) !== -1) hits.push('banned_term:' + term);
  }
  for (const re of C.BANNED_PATTERNS_USERFACING) {
    if (re.test(text)) hits.push('banned_pattern:' + re.toString());
  }
  return hits;
}

// Scope the contract by `meta.module`. Market Intel and Dark Horse
// share the pipeline but emit different packet shapes — DH is a
// movement scanner, not an economic-event surface. Before this
// scope was added, the validator ran the MI field list against every
// DH packet and rejected every DH image-render with multiple
// `packet_missing_field:` failures; live log was
//   `[DH-FOH-IMAGE] image render path returned not-ok
//     reason=foh_contract_validation_failed, falling through to text`
// Callers that don't set `meta.module` default to MI semantics to
// preserve backward compatibility.
function _contractFor(packet) {
  const moduleId = (packet && packet.meta && packet.meta.module) || 'market_intel';
  if (moduleId === 'dark_horse') {
    return {
      moduleId,
      requiredFields:  C.DARK_HORSE_REQUIRED_PACKET_FIELDS,
      requiredAnchors: C.DARK_HORSE_REQUIRED_VIEW_MODEL_ANCHORS,
      requiredArrays:  C.DARK_HORSE_REQUIRED_ARRAYS,
      minimumDepth:    C.DARK_HORSE_MINIMUM_DEPTH_RULES,
    };
  }
  return {
    moduleId,
    requiredFields:  C.MARKET_INTEL_REQUIRED_PACKET_FIELDS,
    requiredAnchors: C.MARKET_INTEL_REQUIRED_VIEW_MODEL_ANCHORS,
    requiredArrays:  C.MARKET_INTEL_REQUIRED_ARRAYS,
    minimumDepth:    C.MARKET_INTEL_MINIMUM_DEPTH_RULES,
  };
}

function _validatePacketShape(packet, contract) {
  const failures = [];
  if (!packet || typeof packet !== 'object') {
    failures.push('packet_missing_or_not_object');
    return failures;
  }
  for (const k of contract.requiredFields) {
    if (!(k in packet) || packet[k] == null) failures.push('packet_missing_field:' + k);
  }
  // Required arrays + per-item required sub-fields.
  for (const [field, spec] of Object.entries(contract.requiredArrays)) {
    const arr = packet[field];
    if (!Array.isArray(arr)) {
      failures.push('packet_field_not_array:' + field);
      continue;
    }
    if (arr.length < spec.minLength) failures.push('packet_array_too_short:' + field + ' (need ≥ ' + spec.minLength + ', got ' + arr.length + ')');
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      for (const sub of spec.perItemFields) {
        if (!(sub in item) || item[sub] == null || (typeof item[sub] === 'string' && !item[sub].trim().length) || (Array.isArray(item[sub]) && !item[sub].length)) {
          failures.push('packet_array_item_missing:' + field + '[' + i + '].' + sub);
        }
      }
    }
  }
  return failures;
}

function _validateViewModelAnchors(viewModel, contract) {
  const failures = [];
  if (!viewModel || typeof viewModel !== 'object') {
    failures.push('view_model_missing_or_not_object');
    return failures;
  }
  for (const a of contract.requiredAnchors) {
    if (!(a in viewModel) || _len(viewModel[a]) === 0) failures.push('view_model_anchor_missing:' + a);
  }
  // Minimum-depth rule per anchor.
  for (const [anchor, minLen] of Object.entries(contract.minimumDepth)) {
    if (anchor in viewModel && _len(viewModel[anchor]) < minLen) {
      failures.push('view_model_anchor_too_thin:' + anchor + ' (need ≥ ' + minLen + ' chars, got ' + _len(viewModel[anchor]) + ')');
    }
  }
  return failures;
}

function _validateNoBannedContent(viewModel, discordText) {
  const failures = [];
  // Scan every view-model anchor value.
  if (viewModel && typeof viewModel === 'object') {
    for (const [anchor, val] of Object.entries(viewModel)) {
      for (const hit of _scanForBanned(String(val || ''))) {
        failures.push('view_model_banned_in_' + anchor + ':' + hit);
      }
    }
  }
  // Scan the Discord message body.
  for (const hit of _scanForBanned(String(discordText || ''))) {
    failures.push('discord_text_banned:' + hit);
  }
  return failures;
}

function _validatePriceMap(packet) {
  const warnings = [];
  const pm = (packet && packet.priceMap) || [];
  const roles = new Set(pm.map(p => p.role));
  for (const r of C.PRICE_MAP_RULES.requiredRoles) {
    if (!roles.has(r)) warnings.push('price_map_missing_role:' + r);
  }
  return warnings;
}

function _validateAttachments(attachments) {
  const failures = [];
  if (!Array.isArray(attachments) || !attachments.length) {
    failures.push('attachments_missing');
    return failures;
  }
  // Each attachment must be a Buffer (PNG / PDF) with non-trivial size.
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    if (!a || !a.data) failures.push('attachment_missing_data:' + i);
    else if (!Buffer.isBuffer(a.data)) failures.push('attachment_not_buffer:' + i);
    else if (a.data.length < 1024) failures.push('attachment_too_small:' + i + ' (' + a.data.length + ' bytes)');
  }
  return failures;
}

function _validateActionBlocks(packet) {
  const failures = [];
  const steps = (packet && packet.whatToDoNow) || [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    for (const req of C.ACTION_BLOCK_RULES.required) {
      if (!s[req] || (typeof s[req] === 'string' && !s[req].trim().length)) {
        failures.push('action_block_missing:' + i + '.' + req);
      }
    }
  }
  return failures;
}

function validateFohOutput({ packet, viewModel, discordText, attachments }) {
  const contract = _contractFor(packet);
  const failures = []
    .concat(_validatePacketShape(packet, contract))
    .concat(_validateViewModelAnchors(viewModel, contract))
    .concat(_validateNoBannedContent(viewModel, discordText))
    .concat(_validateActionBlocks(packet));
  // Price-map role warnings only apply to Market Intel — the DH
  // packet doesn't carry a priceMap.
  const warnings = contract.moduleId === 'market_intel' ? _validatePriceMap(packet) : [];
  // Attachments are optional here — dispatcher decides when to enforce.
  if (attachments) failures.push(..._validateAttachments(attachments));
  return { ok: failures.length === 0, moduleId: contract.moduleId, failures, warnings };
}

module.exports = { validateFohOutput };
