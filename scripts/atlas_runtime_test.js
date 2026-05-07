#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ATLAS_RUNTIME_PACKET_TEST v1.0.0
 *
 * Second mandatory proof layer (after atlas_audit.js).
 * Verifies that the locked ATLAS packet objects PHYSICALLY EXIST during a
 * controlled runtime pass with proper shapes — not just that the files
 * import each other correctly.
 *
 * Static import wiring is necessary but not sufficient. This test runs one
 * controlled symbol through the live pathway in test mode and asserts the
 * nine doctrine requirements (see ASSERTIONS below).
 *
 * Doctrine packets verified at runtime:
 *   - SpideyOutput
 *   - CoreyOutput
 *   - CoreyCloneOutput
 *   - MacroOutput
 *   - JaneInputPacket
 *   - JaneDecisionPacket
 *
 * Run:    node scripts/atlas_runtime_test.js [--symbol EURUSD] [--config path]
 * Output: runtime-packet-test.json + runtime-packet-test.summary.md
 * Exit:   0 = all required assertions passed, 1 = doctrine block
 *
 * No external dependencies. Uses Node's built-in require to load engines.
 * Calls each engine function directly, captures the returned object, and
 * validates against the locked packet contracts.
 *
 * Test mode environment (set automatically before any engine load):
 *   ATLAS_TEST_MODE=1
 *   ATLAS_TEST_SYMBOL=<symbol>
 *   ATLAS_DRY_RUN=1
 *   DISCORD_DRY_RUN=1
 *   DISABLE_NETWORK=1
 *
 * The engines MUST honour ATLAS_TEST_MODE to avoid side effects (network,
 * Puppeteer, Discord posts). The harness scans engine source for these flags
 * and emits a WARN if an engine appears to ignore them.
 */

'use strict';

// --- TEST MODE ENV (must be set BEFORE any engine require) -------------------

const args = process.argv.slice(2);
function argOf(flag, fallback) {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}

const TEST_SYMBOL = argOf('--symbol', 'EURUSD');
const CONFIG_PATH_ARG = argOf('--config', null);
const TIMEOUT_MS = parseInt(argOf('--timeout', '30000'), 10);

process.env.ATLAS_TEST_MODE = '1';
process.env.ATLAS_TEST_SYMBOL = TEST_SYMBOL;
process.env.ATLAS_DRY_RUN = '1';
process.env.DISCORD_DRY_RUN = '1';
process.env.DISABLE_NETWORK = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// --- IMPORTS (built-ins only) ------------------------------------------------

const fs = require('fs');
const path = require('path');

// --- VERSION / PATHS ---------------------------------------------------------

const VERSION = '1.0.0';
const DOCTRINE_LOCKED_AT = '2026-05-07';

const REPO_ROOT = process.cwd();
const OUT_JSON = path.join(REPO_ROOT, 'runtime-packet-test.json');
const OUT_MD = path.join(REPO_ROOT, 'runtime-packet-test.summary.md');
const CONFIG_PATH = CONFIG_PATH_ARG
  ? path.resolve(REPO_ROOT, CONFIG_PATH_ARG)
  : path.resolve(REPO_ROOT, 'atlas.test.config.js');

// --- PACKET CONTRACTS (per Astra locked spec, 7 May 2026) --------------------

// type spec values:
//   'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'function'
//   '<literal>' for fixed string values (e.g. 'structure')
//   ['a', 'b', 'c'] for enum

const PACKET_CONTRACTS = {
  SpideyOutput: {
    required: {
      authority: 'structure',
      score: 'number',
      confidence: 'number',
      evidence: 'any',
      invalidation: 'any',
      timeframeRelevance: 'any',
    },
    optional: {
      symbol: 'string',
      timestamp: 'any',
    },
  },
  CoreyOutput: {
    required: {
      authority: 'current_macro_regime_event',
      score: 'number',
      confidence: 'number',
      evidence: 'any',
      timeframeRelevance: 'any',
    },
    optional: {
      riskModifiers: 'any',
      symbol: 'string',
      timestamp: 'any',
    },
  },
  CoreyCloneOutput: {
    required: {
      authority: 'historical_analogue_base_rate',
      score: 'number',
      confidence: 'number',
    },
    optional: {
      analogues: 'any',
      baseRates: 'any',
      warningFlags: 'any',
      timeframeRelevance: 'any',
      symbol: 'string',
      timestamp: 'any',
    },
    // Special case: CoreyClone may legitimately return a status-only packet
    // when not yet producing evidence, per locked doctrine. The packet must
    // STILL be produced (the slot is occupied); only the evidence is absent.
    statusOnlyAcceptable: ['PARTIAL', 'UNAVAILABLE'],
  },
  MacroOutput: {
    required: {
      authority: 'macro_normalisation',
      score: 'number',
      confidence: 'number',
      evidence: 'any',
    },
    optional: {
      timeframeRelevance: 'any',
      events: 'any',
      symbol: 'string',
      timestamp: 'any',
    },
  },
  JaneInputPacket: {
    required: {
      symbol: 'string',
      spidey: 'object',
      corey: 'object',
      coreyClone: 'object',
      macro: 'object',
      sourceStatus: 'object',
    },
    optional: {
      timestamp: 'any',
      requestId: 'any',
    },
    // sourceStatus inner contract — checked separately
    sourceStatusRequired: ['spidey', 'corey', 'coreyClone', 'macro'],
    sourceStatusValues: ['ACTIVE', 'PARTIAL', 'UNAVAILABLE'],
  },
  JaneDecisionPacket: {
    required: {
      symbol: 'string',
      tradeViability: ['VALID', 'MARGINAL', 'INVALID'],
      finalBias: 'any',
      sourceStatus: 'object',
    },
    optional: {
      assetClass: 'string',
      timestamp: 'any',
      actionState: 'any',
      marketConfidence: 'any',
      reasonSummary: 'any',
      structureSummary: 'any',
      macroSummary: 'any',
      coreyCloneSummary: 'any',
      eventCatalystRisk: 'any',
      conflictSummary: 'any',
      invalidation: 'any',
      chartRefs: 'any',
      dashboardURL: 'any',
      astraSessionContextId: 'any',
    },
  },
};

// --- THE NINE ASSERTIONS (per spec) ------------------------------------------

const ASSERTION_LABELS = {
  A1: 'Spidey emits a structure packet',
  A2: 'Corey emits current macro/regime/event packet',
  A3: 'Corey Clone emits historical/base-rate packet, OR truthfully PARTIAL/UNAVAILABLE while still occupying Jane input slot',
  A4: 'Macro Engine emits macro/event normalisation packet',
  A5: 'JaneInputPacket contains all available engine packets with sourceStatus',
  A6: 'JaneDecisionPacket is produced from Jane only',
  A7: 'Discord/dashboard/Astra routes consume JaneDecisionPacket only',
  A8: 'No surface builds an actionable decision from raw Spidey/Corey/CoreyClone/Macro output',
  A9: 'If Corey Clone is not physically producing evidence, build is BLOCKED per doctrine',
};

// --- ENGINE DESCRIPTORS ------------------------------------------------------

const ENGINES = ['spidey', 'corey', 'coreyClone', 'macro', 'jane'];
const OUTPUT_ROUTES = ['discord', 'dashboard'];

// Heuristic regexes used when no config is provided
const ENGINE_FILE_HEURISTICS = {
  spidey: { aliases: [/spidey/i], excludes: [] },
  corey: { aliases: [/corey/i], excludes: [/coreyclone/i, /corey[-_]clone/i] },
  coreyClone: { aliases: [/coreyclone/i, /corey[-_]clone/i], excludes: [] },
  macro: { aliases: [/(^|[\\/_-])macro([\\/_-]|\.|$)/i], excludes: [/macromedia/i] },
  jane: { aliases: [/jane/i], excludes: [] },
  discord: { aliases: [/discord/i], excludes: [/node_modules/] },
  dashboard: { aliases: [/dashboard/i, /(^|[\\/_-])session([\\/_-]|\.|$)/i], excludes: [] },
};

// Candidate function names tried for each engine when discovering an entry point
function entryFunctionCandidates(engineKey) {
  const cap = engineKey.charAt(0).toUpperCase() + engineKey.slice(1);
  const generics = ['run', 'execute', 'analyse', 'analyze', 'process', 'main', 'handler', 'default'];
  return [
    `${engineKey}Run`,
    `run${cap}`,
    `${engineKey}Analyse`,
    `${engineKey}Analyze`,
    `${engineKey}Execute`,
    `${engineKey}`,
    `analyse${cap}`,
    `analyze${cap}`,
    ...generics,
  ];
}

// --- FILE WALK (lightweight; matches static audit's scanning) ----------------

const SCAN_DIRS = ['.', 'src', 'lib', 'engines', 'routes', 'services', 'modules', 'app'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'tmp', 'logs', 'exports', '.cache']);
const EXTS = new Set(['.js', '.mjs', '.cjs']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let stat; try { stat = fs.statSync(dir); } catch { return out; }
  if (!stat.isDirectory()) return out;
  let entries; try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.') && name !== '.') continue;
    const full = path.join(dir, name);
    let s; try { s = fs.statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(full))) out.push(full);
  }
  return out;
}

function findAllSource() {
  const seen = new Set();
  for (const d of SCAN_DIRS) {
    walk(path.resolve(REPO_ROOT, d)).forEach(f => seen.add(f));
  }
  return [...seen].sort();
}

function classifyFile(filePath, key) {
  const cfg = ENGINE_FILE_HEURISTICS[key];
  if (!cfg) return false;
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  if (!cfg.aliases.some(a => a.test(rel))) return false;
  if (cfg.excludes.some(e => e.test(rel))) return false;
  return true;
}

// --- CONFIG LOADING ----------------------------------------------------------

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const cfg = require(CONFIG_PATH);
      const resolved = typeof cfg === 'function' ? cfg() : cfg;
      return { config: resolved, source: CONFIG_PATH };
    } catch (e) {
      return { config: null, source: CONFIG_PATH, error: e.message };
    }
  }
  return { config: null, source: null };
}

// --- ENGINE RESOLUTION -------------------------------------------------------

function resolveEngine(engineKey, config, allFiles) {
  const result = {
    engine: engineKey,
    modulePath: null,
    functionName: null,
    resolutionMethod: null,
    error: null,
    testModeAware: null,
  };

  // 1. Config override
  if (config && config.engines && config.engines[engineKey]) {
    const c = config.engines[engineKey];
    if (c.module) {
      const resolved = path.resolve(REPO_ROOT, c.module);
      const candidates = [resolved, resolved + '.js', resolved + '.mjs', resolved + '.cjs', path.join(resolved, 'index.js')];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          result.modulePath = cand;
          break;
        }
      }
      if (!result.modulePath) {
        result.error = `Configured module '${c.module}' not found`;
        return result;
      }
      result.functionName = c.function || null;
      result.resolutionMethod = 'config';
    }
  }

  // 2. Auto-discover
  if (!result.modulePath) {
    const matches = allFiles.filter(f => classifyFile(f, engineKey));
    if (matches.length === 0) {
      result.error = `No file matches engine alias for '${engineKey}'`;
      return result;
    }
    // Prefer files in /engines/ or /lib/ over root-level ones
    matches.sort((a, b) => {
      const aIsEngine = /[\\/]engines[\\/]/.test(a) ? 0 : 1;
      const bIsEngine = /[\\/]engines[\\/]/.test(b) ? 0 : 1;
      return aIsEngine - bIsEngine;
    });
    result.modulePath = matches[0];
    result.resolutionMethod = 'discover';
  }

  // 3. Static check for test-mode awareness
  try {
    const src = fs.readFileSync(result.modulePath, 'utf8');
    result.testModeAware =
      /ATLAS_TEST_MODE/.test(src) ||
      /process\.env\.NODE_ENV.*test/i.test(src) ||
      /DRY_RUN/.test(src) ||
      /DISABLE_NETWORK/.test(src);
  } catch { /* ignore */ }

  // 4. Resolve callable function: load module and pick a candidate name
  try {
    const mod = require(result.modulePath);
    const tryNames = result.functionName
      ? [result.functionName, ...entryFunctionCandidates(engineKey)]
      : entryFunctionCandidates(engineKey);

    for (const name of tryNames) {
      if (name === 'default') {
        if (typeof mod === 'function') {
          result.functionName = '<default export>';
          result.callable = mod;
          return result;
        }
        if (mod && typeof mod.default === 'function') {
          result.functionName = 'default';
          result.callable = mod.default;
          return result;
        }
        continue;
      }
      if (mod && typeof mod[name] === 'function') {
        result.functionName = name;
        result.callable = mod[name];
        return result;
      }
    }
    // Last resort: pick the first exported function
    if (mod && typeof mod === 'object') {
      for (const k of Object.keys(mod)) {
        if (typeof mod[k] === 'function') {
          result.functionName = k + ' (first-export-fallback)';
          result.callable = mod[k];
          return result;
        }
      }
    }
    result.error = `Module loaded but no callable function found. Tried: ${tryNames.join(', ')}`;
  } catch (e) {
    result.error = `Module load failed: ${e.message}`;
  }

  return result;
}

// --- VALIDATION --------------------------------------------------------------

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validateField(value, expected) {
  if (expected === 'any') return value !== undefined ? null : 'missing';
  if (Array.isArray(expected)) {
    return expected.includes(value) ? null : `expected one of [${expected.join(', ')}], got ${JSON.stringify(value)}`;
  }
  if (typeof expected === 'string') {
    // literal string match (e.g. authority: 'structure')
    if (['string', 'number', 'boolean', 'object', 'array', 'function'].includes(expected)) {
      const t = typeOf(value);
      if (t !== expected) return `expected ${expected}, got ${t}`;
      return null;
    }
    // literal value
    return value === expected ? null : `expected literal '${expected}', got ${JSON.stringify(value)}`;
  }
  return null;
}

function validatePacket(packet, contractName) {
  const contract = PACKET_CONTRACTS[contractName];
  const result = {
    contract: contractName,
    valid: true,
    errors: [],
    missingRequired: [],
    typeMismatches: [],
    receivedShape: packet === null ? 'null' : typeOf(packet),
    receivedKeys: packet && typeof packet === 'object' ? Object.keys(packet) : [],
  };

  if (packet === null || packet === undefined) {
    result.valid = false;
    result.errors.push('Packet is null/undefined');
    return result;
  }
  if (typeof packet !== 'object' || Array.isArray(packet)) {
    result.valid = false;
    result.errors.push(`Packet is ${typeOf(packet)}, expected object`);
    return result;
  }

  // CoreyClone special case: status-only acceptable
  if (contractName === 'CoreyCloneOutput' && contract.statusOnlyAcceptable) {
    if (packet.status && contract.statusOnlyAcceptable.includes(packet.status)) {
      result.statusOnly = true;
      result.statusValue = packet.status;
      // Still valid — slot is occupied with truthful status
      return result;
    }
  }

  for (const [field, expected] of Object.entries(contract.required)) {
    if (!(field in packet)) {
      result.valid = false;
      result.missingRequired.push(field);
      result.errors.push(`Missing required field: ${field}`);
      continue;
    }
    const err = validateField(packet[field], expected);
    if (err) {
      result.valid = false;
      result.typeMismatches.push({ field, error: err });
      result.errors.push(`${field}: ${err}`);
    }
  }

  // JaneInputPacket sourceStatus inner check
  if (contractName === 'JaneInputPacket' && packet.sourceStatus && typeof packet.sourceStatus === 'object') {
    for (const k of contract.sourceStatusRequired) {
      if (!(k in packet.sourceStatus)) {
        result.valid = false;
        result.errors.push(`sourceStatus.${k} missing`);
      } else if (!contract.sourceStatusValues.includes(packet.sourceStatus[k])) {
        result.valid = false;
        result.errors.push(`sourceStatus.${k}=${packet.sourceStatus[k]}, expected one of ${contract.sourceStatusValues.join('/')}`);
      }
    }
  }

  // JaneDecisionPacket sourceStatus inner check
  if (contractName === 'JaneDecisionPacket' && packet.sourceStatus && typeof packet.sourceStatus === 'object') {
    const required = ['spidey', 'corey', 'coreyClone', 'macro'];
    for (const k of required) {
      if (!(k in packet.sourceStatus)) {
        result.errors.push(`sourceStatus.${k} missing in JaneDecisionPacket (recommended)`);
      }
    }
  }

  return result;
}

// --- INVOKE WITH TIMEOUT -----------------------------------------------------

function invokeWithTimeout(fn, args, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: `Timeout after ${ms}ms`, value: null });
    }, ms);
    Promise.resolve()
      .then(() => fn(...args))
      .then(value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, error: null, value });
      })
      .catch(err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err && err.message ? err.message : String(err), value: null });
      });
  });
}

// --- BYPASS DETECTION (runtime read of output route source) ------------------

function stripCommentsOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

function findOutputRouteFiles(allFiles) {
  const result = {};
  for (const key of OUTPUT_ROUTES) {
    result[key] = allFiles.filter(f => classifyFile(f, key));
  }
  return result;
}

function detectBypass(outputRouteFiles) {
  const findings = [];
  const evidenceKeys = ['spidey', 'corey', 'coreyClone', 'macro'];

  for (const [routeKey, files] of Object.entries(outputRouteFiles)) {
    for (const f of files) {
      let src;
      try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const noComments = stripCommentsOnly(src);
      const rel = path.relative(REPO_ROOT, f).replace(/\\/g, '/');

      // Look for require('...') or import ... from '...' that resolves to an evidence engine
      const importRe = /(?:require\s*\(\s*|from\s*)['"`]([^'"`]+)['"`]/g;
      let m;
      while ((m = importRe.exec(noComments))) {
        const src2 = m[1];
        if (!src2.startsWith('.') && !src2.startsWith('/')) continue;
        const baseDir = path.dirname(f);
        const candidates = [
          path.resolve(baseDir, src2),
          path.resolve(baseDir, src2 + '.js'),
          path.resolve(baseDir, src2 + '.mjs'),
          path.resolve(baseDir, src2 + '.cjs'),
          path.resolve(baseDir, src2, 'index.js'),
        ];
        let resolved = null;
        for (const c of candidates) {
          if (fs.existsSync(c) && fs.statSync(c).isFile()) { resolved = c; break; }
        }
        if (!resolved) continue;
        for (const ek of evidenceKeys) {
          if (classifyFile(resolved, ek)) {
            findings.push({
              severity: 'ERROR',
              route: routeKey,
              file: rel,
              importsEvidenceEngine: ek,
              importPath: src2,
              message: `${rel} imports evidence engine '${ek}' directly. Output surfaces must consume Jane's packet only.`,
            });
          }
        }
      }

      // Look for decision-shape construction inside output route (constructs tradeViability without going through Jane)
      if (/tradeViability\s*[:=]/.test(noComments) && !/janeDecision|JaneDecisionPacket|fromJane|jane\./i.test(noComments)) {
        findings.push({
          severity: 'ERROR',
          route: routeKey,
          file: rel,
          message: `${rel} constructs 'tradeViability' but no reference to Jane found. Output surfaces must NOT build decisions.`,
        });
      }
    }
  }
  return findings;
}

// --- MAIN PIPELINE -----------------------------------------------------------

async function main() {
  const startedAt = new Date().toISOString();
  const log = (...a) => console.log(...a);

  log(`ATLAS_RUNTIME_PACKET_TEST v${VERSION}  (doctrine locked ${DOCTRINE_LOCKED_AT})`);
  log(`Repo:        ${REPO_ROOT}`);
  log(`Test symbol: ${TEST_SYMBOL}`);
  log(`Test mode:   ATLAS_TEST_MODE=1 ATLAS_DRY_RUN=1 DISCORD_DRY_RUN=1 DISABLE_NETWORK=1`);
  log('');

  const cfgLoad = loadConfig();
  if (cfgLoad.config) log(`Config:      ${cfgLoad.source}`);
  else if (cfgLoad.error) log(`Config:      load failed at ${cfgLoad.source} — ${cfgLoad.error}`);
  else log(`Config:      none (auto-discovery mode)`);
  log('');

  const allFiles = findAllSource();
  log(`Scanned ${allFiles.length} source file(s).`);

  // --- Resolve all engines ---------------------------------------------------

  const resolutions = {};
  for (const eng of ENGINES) {
    resolutions[eng] = resolveEngine(eng, cfgLoad.config, allFiles);
    const r = resolutions[eng];
    if (r.callable) {
      log(`  ${eng.padEnd(12)} resolved via ${r.resolutionMethod} → ${path.relative(REPO_ROOT, r.modulePath).replace(/\\/g, '/')} :: ${r.functionName}${r.testModeAware ? '' : '  [WARN: not test-mode aware]'}`);
    } else {
      log(`  ${eng.padEnd(12)} NOT RESOLVABLE — ${r.error}`);
    }
  }
  log('');

  // --- Invoke evidence engines ----------------------------------------------

  const callResults = {};
  const evidenceCalls = ['spidey', 'corey', 'coreyClone', 'macro'];
  for (const eng of evidenceCalls) {
    const r = resolutions[eng];
    if (!r.callable) {
      callResults[eng] = { invoked: false, error: r.error || 'no callable', value: null, durationMs: null };
      continue;
    }
    const t0 = Date.now();
    log(`Invoking ${eng}(${TEST_SYMBOL})...`);
    const out = await invokeWithTimeout(r.callable, [TEST_SYMBOL, { testMode: true, dryRun: true }], TIMEOUT_MS);
    callResults[eng] = {
      invoked: true,
      ok: out.ok,
      error: out.error,
      value: out.value,
      durationMs: Date.now() - t0,
    };
    if (out.ok) log(`  ${eng}: returned ${typeOf(out.value)} in ${callResults[eng].durationMs}ms`);
    else log(`  ${eng}: ERROR — ${out.error}`);
  }
  log('');

  // --- Validate evidence packets --------------------------------------------

  const validations = {};
  validations.spidey = callResults.spidey.ok ? validatePacket(callResults.spidey.value, 'SpideyOutput') : null;
  validations.corey = callResults.corey.ok ? validatePacket(callResults.corey.value, 'CoreyOutput') : null;
  validations.coreyClone = callResults.coreyClone.ok ? validatePacket(callResults.coreyClone.value, 'CoreyCloneOutput') : null;
  validations.macro = callResults.macro.ok ? validatePacket(callResults.macro.value, 'MacroOutput') : null;

  // --- Build JaneInputPacket ------------------------------------------------

  function statusOf(eng) {
    const v = validations[eng];
    if (!callResults[eng].invoked || !callResults[eng].ok) return 'UNAVAILABLE';
    if (!v) return 'UNAVAILABLE';
    if (v.statusOnly) return v.statusValue;  // CoreyClone PARTIAL/UNAVAILABLE
    if (v.valid) return 'ACTIVE';
    return 'PARTIAL';
  }

  const janeInputPacket = {
    symbol: TEST_SYMBOL,
    timestamp: new Date().toISOString(),
    spidey: callResults.spidey.value,
    corey: callResults.corey.value,
    coreyClone: callResults.coreyClone.value,
    macro: callResults.macro.value,
    sourceStatus: {
      spidey: statusOf('spidey'),
      corey: statusOf('corey'),
      coreyClone: statusOf('coreyClone'),
      macro: statusOf('macro'),
    },
  };
  validations.janeInputPacket = validatePacket(janeInputPacket, 'JaneInputPacket');

  // --- Invoke Jane ----------------------------------------------------------

  let janeDecisionPacket = null;
  let janeCall = { invoked: false, ok: false, error: null, value: null, durationMs: null };
  if (resolutions.jane.callable) {
    const t0 = Date.now();
    log(`Invoking jane(JaneInputPacket)...`);
    const out = await invokeWithTimeout(resolutions.jane.callable, [janeInputPacket, { testMode: true, dryRun: true }], TIMEOUT_MS);
    janeCall = { invoked: true, ok: out.ok, error: out.error, value: out.value, durationMs: Date.now() - t0 };
    janeDecisionPacket = out.value;
    if (out.ok) log(`  jane: returned ${typeOf(out.value)} in ${janeCall.durationMs}ms`);
    else log(`  jane: ERROR — ${out.error}`);
  } else {
    log(`Jane not resolvable — skipping decision packet build.`);
  }
  log('');

  validations.janeDecisionPacket = janeCall.ok ? validatePacket(janeDecisionPacket, 'JaneDecisionPacket') : null;

  // --- Bypass detection ------------------------------------------------------

  const outputRouteFiles = findOutputRouteFiles(allFiles);
  const bypassFindings = detectBypass(outputRouteFiles);

  // --- Output route consumption test ----------------------------------------
  // For each output route, attempt to invoke with the JaneDecisionPacket if jane succeeded.
  // We call but do not assert success — the route may legitimately error in test mode
  // (e.g., no Discord token). We only flag if it imports evidence engines or constructs
  // its own decision (handled by detectBypass above).

  const outputProbes = {};
  for (const routeKey of OUTPUT_ROUTES) {
    const r = resolveEngine(routeKey === 'discord' ? 'discord' : 'dashboard',
                            cfgLoad.config && cfgLoad.config.output ? { engines: cfgLoad.config.output } : null,
                            allFiles);
    outputProbes[routeKey] = {
      resolved: !!r.callable,
      modulePath: r.modulePath ? path.relative(REPO_ROOT, r.modulePath).replace(/\\/g, '/') : null,
      functionName: r.functionName,
      error: r.error,
    };
    if (r.callable && janeDecisionPacket) {
      log(`Invoking ${routeKey}(JaneDecisionPacket)...`);
      const out = await invokeWithTimeout(r.callable, [janeDecisionPacket, { testMode: true, dryRun: true }], TIMEOUT_MS);
      outputProbes[routeKey].invokeOk = out.ok;
      outputProbes[routeKey].invokeError = out.error;
      log(`  ${routeKey}: ${out.ok ? 'accepted' : 'errored: ' + out.error}`);
    }
  }
  log('');

  // --- Assertions ------------------------------------------------------------

  const assertions = {};

  // A1
  assertions.A1 = {
    label: ASSERTION_LABELS.A1,
    pass: !!(callResults.spidey.ok && validations.spidey && validations.spidey.valid),
    detail: validations.spidey ? validations.spidey.errors : ['Spidey not invoked'],
  };

  // A2
  assertions.A2 = {
    label: ASSERTION_LABELS.A2,
    pass: !!(callResults.corey.ok && validations.corey && validations.corey.valid),
    detail: validations.corey ? validations.corey.errors : ['Corey not invoked'],
  };

  // A3 — CoreyClone may be PARTIAL/UNAVAILABLE but slot must exist & validation acceptable
  const cloneStatus = statusOf('coreyClone');
  const cloneValidationOk = validations.coreyClone && (validations.coreyClone.valid || validations.coreyClone.statusOnly);
  assertions.A3 = {
    label: ASSERTION_LABELS.A3,
    pass: !!(callResults.coreyClone.invoked && cloneValidationOk && janeInputPacket.coreyClone !== undefined),
    cloneStatus,
    detail: validations.coreyClone ? validations.coreyClone.errors : ['CoreyClone not invoked'],
  };

  // A4
  assertions.A4 = {
    label: ASSERTION_LABELS.A4,
    pass: !!(callResults.macro.ok && validations.macro && validations.macro.valid),
    detail: validations.macro ? validations.macro.errors : ['Macro not invoked'],
  };

  // A5 — JaneInputPacket built and validates
  assertions.A5 = {
    label: ASSERTION_LABELS.A5,
    pass: !!(validations.janeInputPacket && validations.janeInputPacket.valid),
    detail: validations.janeInputPacket ? validations.janeInputPacket.errors : ['No Jane input packet built'],
  };

  // A6 — Jane invoked, returns valid JaneDecisionPacket
  assertions.A6 = {
    label: ASSERTION_LABELS.A6,
    pass: !!(janeCall.ok && validations.janeDecisionPacket && validations.janeDecisionPacket.valid),
    detail: validations.janeDecisionPacket ? validations.janeDecisionPacket.errors : ['Jane not invoked or returned invalid packet'],
  };

  // A7 — Output routes accept the decision packet (probe ok or at least no shape rejection)
  // and don't import evidence engines (covered by detectBypass)
  const outputBypass = bypassFindings.filter(f => f.severity === 'ERROR' && f.importsEvidenceEngine);
  assertions.A7 = {
    label: ASSERTION_LABELS.A7,
    pass: outputBypass.length === 0,
    detail: outputBypass.length === 0 ? ['No output route imports an evidence engine directly.'] : outputBypass.map(f => f.message),
  };

  // A8 — No surface builds decision from raw evidence (covered by detectBypass too)
  const decisionConstructionBypass = bypassFindings.filter(f => f.severity === 'ERROR' && !f.importsEvidenceEngine);
  assertions.A8 = {
    label: ASSERTION_LABELS.A8,
    pass: decisionConstructionBypass.length === 0,
    detail: decisionConstructionBypass.length === 0 ? ['No output surface constructs tradeViability outside Jane.'] : decisionConstructionBypass.map(f => f.message),
  };

  // A9 — If CoreyClone not producing evidence, BLOCKED
  // "producing evidence" = returned a valid full packet (not status-only)
  const cloneActivelyProducing = !!(validations.coreyClone && validations.coreyClone.valid && !validations.coreyClone.statusOnly);
  assertions.A9 = {
    label: ASSERTION_LABELS.A9,
    pass: cloneActivelyProducing,
    cloneActivelyProducing,
    cloneStatus,
    detail: cloneActivelyProducing
      ? ['Corey Clone is physically producing evidence packets.']
      : [`Corey Clone status=${cloneStatus}. Per locked doctrine (7 May 2026), Corey Clone is mandatory. Build is BLOCKED until Corey Clone produces real historical/base-rate evidence.`],
    severity: cloneActivelyProducing ? null : 'BLOCK',
  };

  // --- Build report ----------------------------------------------------------

  const passCount = Object.values(assertions).filter(a => a.pass).length;
  const totalCount = Object.keys(assertions).length;
  const blocked = !assertions.A9.pass;

  const report = {
    version: VERSION,
    doctrineLockedAt: DOCTRINE_LOCKED_AT,
    startedAt,
    completedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    testSymbol: TEST_SYMBOL,
    testModeEnv: {
      ATLAS_TEST_MODE: process.env.ATLAS_TEST_MODE,
      ATLAS_TEST_SYMBOL: process.env.ATLAS_TEST_SYMBOL,
      ATLAS_DRY_RUN: process.env.ATLAS_DRY_RUN,
      DISCORD_DRY_RUN: process.env.DISCORD_DRY_RUN,
      DISABLE_NETWORK: process.env.DISABLE_NETWORK,
      NODE_ENV: process.env.NODE_ENV,
    },
    config: {
      configPath: cfgLoad.source,
      configLoaded: !!cfgLoad.config,
      configError: cfgLoad.error || null,
    },
    summary: {
      assertionsPassed: passCount,
      assertionsTotal: totalCount,
      blocked,
      blockReason: blocked ? 'Corey Clone not producing evidence (A9 failed)' : null,
    },
    resolutions: Object.fromEntries(Object.entries(resolutions).map(([k, v]) => [k, {
      modulePath: v.modulePath ? path.relative(REPO_ROOT, v.modulePath).replace(/\\/g, '/') : null,
      functionName: v.functionName,
      resolutionMethod: v.resolutionMethod,
      testModeAware: v.testModeAware,
      error: v.error,
    }])),
    calls: Object.fromEntries(Object.entries(callResults).map(([k, v]) => [k, {
      invoked: v.invoked,
      ok: v.ok,
      error: v.error,
      durationMs: v.durationMs,
      receivedShape: v.value === null || v.value === undefined ? null : typeOf(v.value),
      receivedKeys: v.value && typeof v.value === 'object' ? Object.keys(v.value) : null,
      receivedSample: v.value && typeof v.value === 'object'
        ? JSON.parse(JSON.stringify(v.value, (_, val) => {
            if (typeof val === 'string' && val.length > 200) return val.slice(0, 200) + '...';
            return val;
          }))
        : v.value,
    }])),
    janeCall: {
      invoked: janeCall.invoked,
      ok: janeCall.ok,
      error: janeCall.error,
      durationMs: janeCall.durationMs,
      decisionPacketKeys: janeDecisionPacket && typeof janeDecisionPacket === 'object' ? Object.keys(janeDecisionPacket) : null,
      tradeViability: janeDecisionPacket ? janeDecisionPacket.tradeViability : null,
    },
    validations,
    assertions,
    bypassFindings,
    outputProbes,
    janeInputPacketShape: {
      keys: Object.keys(janeInputPacket),
      sourceStatus: janeInputPacket.sourceStatus,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(report), 'utf8');

  // --- Console summary -------------------------------------------------------

  log('=== ASSERTIONS ===');
  for (const [k, a] of Object.entries(assertions)) {
    const mark = a.pass ? 'PASS' : (a.severity === 'BLOCK' ? 'BLOCK' : 'FAIL');
    log(`  [${mark}] ${k}: ${a.label}`);
    if (!a.pass) {
      a.detail.slice(0, 3).forEach(d => log(`         ${d}`));
    }
  }
  log('');
  log(`Passed: ${passCount}/${totalCount}`);
  if (bypassFindings.length) {
    log('');
    log(`Bypass findings: ${bypassFindings.length}`);
    for (const f of bypassFindings) log(`  [${f.severity}] ${f.message}`);
  }
  log('');
  log(`Report JSON:    ${OUT_JSON}`);
  log(`Report summary: ${OUT_MD}`);
  log('');

  if (blocked || passCount < totalCount) {
    log(`FAIL: foundation wiring not complete.${blocked ? ' BUILD BLOCKED — Corey Clone not producing evidence.' : ''}`);
    process.exit(1);
  } else {
    log(`PASS: all nine doctrine assertions verified at runtime.`);
    process.exit(0);
  }
}

// --- MARKDOWN REPORT ---------------------------------------------------------

function renderMarkdown(report) {
  const lines = [];
  const r = report;
  lines.push('# ATLAS Runtime Packet Test');
  lines.push('');
  lines.push(`**Version:** ${r.version}  (doctrine locked ${r.doctrineLockedAt})`);
  lines.push(`**Run at:** ${r.completedAt}`);
  lines.push(`**Repo:** \`${r.repoRoot}\``);
  lines.push(`**Test symbol:** \`${r.testSymbol}\``);
  lines.push(`**Config:** ${r.config.configLoaded ? '`' + r.config.configPath + '`' : '_(auto-discovery)_'}${r.config.configError ? ' — load error: `' + r.config.configError + '`' : ''}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Assertions passed | ${r.summary.assertionsPassed} of ${r.summary.assertionsTotal} |`);
  lines.push(`| Blocked | ${r.summary.blocked ? '**YES** — ' + r.summary.blockReason : 'no' } |`);
  lines.push(`| Bypass findings | ${r.bypassFindings.length} |`);
  lines.push('');

  lines.push('## Assertions');
  lines.push('');
  lines.push(`| ID | Result | Assertion |`);
  lines.push(`|---|---|---|`);
  for (const [k, a] of Object.entries(r.assertions)) {
    const mark = a.pass ? '✅ PASS' : (a.severity === 'BLOCK' ? '🛑 BLOCK' : '❌ FAIL');
    lines.push(`| ${k} | ${mark} | ${a.label} |`);
  }
  lines.push('');

  lines.push('## Engine Resolution');
  lines.push('');
  lines.push(`| Engine | Module | Function | Method | Test-mode aware | Error |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const [k, v] of Object.entries(r.resolutions)) {
    lines.push(`| ${k} | ${v.modulePath ? '`' + v.modulePath + '`' : '—'} | ${v.functionName ? '`' + v.functionName + '`' : '—'} | ${v.resolutionMethod || '—'} | ${v.testModeAware === null ? '—' : v.testModeAware} | ${v.error || '—'} |`);
  }
  lines.push('');

  lines.push('## Engine Invocations');
  lines.push('');
  for (const [k, c] of Object.entries(r.calls)) {
    lines.push(`### ${k}`);
    lines.push('');
    lines.push(`- Invoked: ${c.invoked}`);
    lines.push(`- OK: ${c.ok}`);
    if (c.error) lines.push(`- Error: \`${c.error}\``);
    lines.push(`- Duration: ${c.durationMs ?? '—'}ms`);
    lines.push(`- Received shape: \`${c.receivedShape}\``);
    if (c.receivedKeys) lines.push(`- Received keys: \`${c.receivedKeys.join(', ')}\``);
    lines.push('');
  }

  lines.push('## Jane');
  lines.push('');
  lines.push(`- Invoked: ${r.janeCall.invoked}`);
  lines.push(`- OK: ${r.janeCall.ok}`);
  if (r.janeCall.error) lines.push(`- Error: \`${r.janeCall.error}\``);
  lines.push(`- Decision packet keys: ${r.janeCall.decisionPacketKeys ? r.janeCall.decisionPacketKeys.map(k => '`' + k + '`').join(', ') : '—'}`);
  lines.push(`- tradeViability: \`${r.janeCall.tradeViability ?? '—'}\``);
  lines.push('');

  lines.push('## Validations');
  lines.push('');
  for (const [k, v] of Object.entries(r.validations)) {
    if (!v) { lines.push(`- **${k}**: _not validated (engine did not return)_`); continue; }
    if (v.valid) {
      lines.push(`- **${k}**: ✅ valid${v.statusOnly ? ` (status-only: ${v.statusValue})` : ''}`);
    } else {
      lines.push(`- **${k}**: ❌ invalid`);
      v.errors.slice(0, 5).forEach(e => lines.push(`  - ${e}`));
    }
  }
  lines.push('');

  if (r.bypassFindings.length) {
    lines.push('## Bypass Findings');
    lines.push('');
    for (const f of r.bypassFindings) {
      lines.push(`- **[${f.severity}]** ${f.route} / \`${f.file}\` — ${f.message}`);
    }
    lines.push('');
  }

  lines.push('## JaneInputPacket sourceStatus');
  lines.push('');
  lines.push(`| Engine | Status |`);
  lines.push(`|---|---|`);
  for (const [k, v] of Object.entries(r.janeInputPacketShape.sourceStatus)) {
    lines.push(`| ${k} | **${v}** |`);
  }
  lines.push('');

  return lines.join('\n');
}

// --- ENTRY -------------------------------------------------------------------

main().catch(err => {
  console.error('Runtime test crashed:', err && err.stack ? err.stack : err);
  process.exit(2);
});
