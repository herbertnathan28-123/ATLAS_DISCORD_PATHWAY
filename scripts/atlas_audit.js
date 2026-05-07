#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ATLAS_DOCTRINE_AUDIT v1.0.0
 *
 * Permanent doctrine enforcement tool for ATLAS FX.
 * Verifies actual runtime wiring of ATLAS engines against the locked architecture.
 *
 * Doctrine (locked 7 May 2026):
 *   - Spidey / Corey / Corey Clone / Macro Engine = evidence producers
 *   - Jane = final compression, scoring, conflict resolution, decision packet
 *   - Discord / Dashboard / Astra = consumers of Jane's packet only
 *   - No surface bypasses Jane.
 *   - No engine claims ACTIVE unless physically wired and traceable from entry point.
 *
 * Hard rules enforced by this script:
 *   ACTIVE       requires file exists + imported in live path + called + output
 *                reaches Jane (for evidence engines) or Jane is imported (for output
 *                surfaces).
 *   PARTIAL      file/function exists but call path, packet shape, or Jane
 *                consumption is incomplete.
 *   UNAVAILABLE  no usable file/function found, or no runtime path.
 *
 * Run:    node scripts/atlas_audit.js [--strict]
 * Output: audit.json + audit.summary.md in repo root
 * Exit:   0 = pass, 1 = ERROR-level doctrine drift detected
 *         (--strict also fails on WARN)
 *
 * No external dependencies. Uses regex-based parsing deliberately so the audit
 * tool itself cannot drift from npm package changes. Regex limits are documented
 * inline. All findings include `evidence` so claims can be verified by hand.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- VERSION / CONFIG ---------------------------------------------------------

const DOCTRINE_VERSION = '1.0.0';
const DOCTRINE_LOCKED_AT = '2026-05-07';

const REPO_ROOT = process.cwd();
const OUT_JSON = path.join(REPO_ROOT, 'audit.json');
const OUT_MD = path.join(REPO_ROOT, 'audit.summary.md');

const STRICT = process.argv.includes('--strict');

const SCAN_DIRS = ['.', 'src', 'lib', 'engines', 'routes', 'services', 'modules', 'app'];
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'tmp', 'temp',
  'logs', 'log', 'exports', '.cache', '.vscode', '.idea', 'scripts/legacy',
]);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

// Engine catalogue. Each engine has:
//   role       - evidence_producer | decision_layer | output_consumer | artefact_provider
//   lane       - human-readable authority lane
//   aliases    - regex array, file path matched in any one => belongs to engine
//   excludes   - regex array, if any matches the file path => excluded
const ENGINES = {
  spidey: {
    role: 'evidence_producer',
    lane: 'structure',
    aliases: [/spidey/i],
    excludes: [],
  },
  corey: {
    role: 'evidence_producer',
    lane: 'live_macro_regime_event',
    aliases: [/corey/i],
    excludes: [/coreyclone/i, /corey[-_]clone/i],
  },
  coreyClone: {
    role: 'evidence_producer',
    lane: 'historical_analogue_base_rate',
    aliases: [/coreyclone/i, /corey[-_]clone/i],
    excludes: [],
  },
  macroEngine: {
    role: 'evidence_producer',
    lane: 'macro_normalisation',
    aliases: [/(^|[\\/_-])macro([\\/_-]|\.|$)/i],
    excludes: [/macromedia/i],
  },
  jane: {
    role: 'decision_layer',
    lane: 'final_compression',
    aliases: [/jane/i],
    excludes: [],
  },
  renderer: {
    role: 'artefact_provider',
    lane: 'visual_artefact',
    aliases: [/renderer/i],
    excludes: [],
  },
  discordOutput: {
    role: 'output_consumer',
    lane: 'discord_delivery',
    aliases: [/discord/i],
    excludes: [],
  },
  dashboardSession: {
    role: 'output_consumer',
    lane: 'dashboard_delivery',
    aliases: [/dashboard/i, /(^|[\\/_-])session([\\/_-]|\.|$)/i],
    excludes: [],
  },
};

const REQUIRED_CONTRACTS = [
  'SpideyOutput',
  'CoreyOutput',
  'CoreyCloneOutput',
  'MacroOutput',
  'JaneInputPacket',
  'JaneDecisionPacket',
];

// JS reserved words / control structures that look like calls but aren't.
const NOT_A_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'await', 'async', 'new', 'do', 'else', 'throw', 'in', 'of', 'instanceof',
  'delete', 'void', 'yield', 'super',
]);

// --- FILE WALK ----------------------------------------------------------------

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let stat;
  try { stat = fs.statSync(dir); } catch { return out; }
  if (!stat.isDirectory()) return out;

  let entries;
  try { entries = fs.readdirSync(dir); } catch { return out; }

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.') && name !== '.') continue;
    const full = path.join(dir, name);
    let s;
    try { s = fs.statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function findAllSource() {
  const seen = new Set();
  for (const d of SCAN_DIRS) {
    const full = path.resolve(REPO_ROOT, d);
    walk(full).forEach(f => seen.add(f));
  }
  return [...seen].sort();
}

// --- PARSING (regex-based, comment/string-aware) -----------------------------

function stripCommentsOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

function stripCommentsAndStrings(src) {
  return stripCommentsOnly(src)
    .replace(/`(?:\\.|[^`\\])*`/g, m => ' '.repeat(m.length))
    .replace(/'(?:\\.|[^'\\])*'/g, m => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\])*"/g, m => ' '.repeat(m.length));
}

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const noComments = stripCommentsOnly(raw); // for import/export/return analysis
  const code = stripCommentsAndStrings(raw); // for call-name detection

  const imports = [];
  const exports = [];
  const calls = new Set();
  let m;

  // CommonJS: const x = require('y')   /   const { a, b } = require('y')
  const reqRe = /(?:const|let|var)\s+(\{[^}]+\}|[\w$]+)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = reqRe.exec(noComments))) {
    const lhs = m[1].trim();
    const source = m[2];
    let names = [];
    if (lhs.startsWith('{')) {
      names = lhs.slice(1, -1).split(',')
        .map(s => s.trim().split(/\s*:\s*/)[0])
        .filter(Boolean);
    } else {
      names = [lhs];
    }
    imports.push({ source, names, kind: 'require' });
  }

  // Bare require('x') (side-effect or assigned later)
  const bareReqRe = /(?<![\w$])require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = bareReqRe.exec(noComments))) {
    if (!imports.some(i => i.source === m[1])) {
      imports.push({ source: m[1], names: [], kind: 'require_bare' });
    }
  }

  // ESM: import default / namespace / named  from 'x'
  const impRe = /import\s+(?:(\*\s+as\s+[\w$]+)|(\{[^}]+\})|([\w$]+))?\s*(?:,\s*(\{[^}]+\}))?\s*from\s*['"`]([^'"`]+)['"`]/g;
  while ((m = impRe.exec(noComments))) {
    const source = m[5];
    const names = [];
    if (m[1]) names.push(m[1].split(/\s+as\s+/)[1]);
    if (m[2]) m[2].slice(1, -1).split(',').forEach(s => {
      const n = s.trim().split(/\s+as\s+/).pop();
      if (n) names.push(n);
    });
    if (m[3]) names.push(m[3]);
    if (m[4]) m[4].slice(1, -1).split(',').forEach(s => {
      const n = s.trim().split(/\s+as\s+/).pop();
      if (n) names.push(n);
    });
    imports.push({ source, names, kind: 'esm' });
  }

  // ESM bare side-effect: import 'x'
  const bareImpRe = /(?<![\w$])import\s*['"`]([^'"`]+)['"`]/g;
  while ((m = bareImpRe.exec(noComments))) {
    if (!imports.some(i => i.source === m[1])) {
      imports.push({ source: m[1], names: [], kind: 'esm_bare' });
    }
  }

  // module.exports = X    /    module.exports.Y = ...
  const meRe = /module\.exports(?:\.([\w$]+))?\s*=\s*([^;\n]*)/g;
  while ((m = meRe.exec(noComments))) {
    if (m[1]) {
      // module.exports.Y = ...
      exports.push({ name: m[1], kind: 'cjs_named' });
    } else {
      // module.exports = ...
      exports.push({ name: 'default', kind: 'cjs' });
      // If RHS is an object literal, extract its keys: { foo, bar: baz, qux }
      const rhs = m[2].trim();
      if (rhs.startsWith('{')) {
        // Find the full object literal — match braces from this position
        const startIdx = m.index + m[0].indexOf('{');
        let depth = 0;
        let endIdx = -1;
        for (let i = startIdx; i < noComments.length; i++) {
          if (noComments[i] === '{') depth++;
          else if (noComments[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        if (endIdx > startIdx) {
          const inner = noComments.slice(startIdx + 1, endIdx);
          // Split top-level commas only (depth-aware)
          const entries = [];
          let buf = '';
          let d = 0;
          for (const ch of inner) {
            if (ch === '{' || ch === '[' || ch === '(') d++;
            else if (ch === '}' || ch === ']' || ch === ')') d--;
            if (ch === ',' && d === 0) { entries.push(buf); buf = ''; continue; }
            buf += ch;
          }
          if (buf.trim()) entries.push(buf);
          for (const ent of entries) {
            const key = ent.trim().split(/\s*:\s*/)[0].replace(/^\.\.\./, '').trim();
            if (key && /^[\w$]+$/.test(key)) {
              exports.push({ name: key, kind: 'cjs_object_key' });
            }
          }
        }
      }
    }
  }
  // exports.X = ...
  const eRe = /(?<![\w$.])exports\.([\w$]+)\s*=/g;
  while ((m = eRe.exec(noComments))) {
    exports.push({ name: m[1], kind: 'cjs_named' });
  }
  // export const|let|var|function|class X
  const ecRe = /export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([\w$]+)/g;
  while ((m = ecRe.exec(noComments))) {
    exports.push({ name: m[1], kind: 'esm' });
  }
  if (/export\s+default\b/.test(noComments) && !exports.some(e => e.name === 'default')) {
    exports.push({ name: 'default', kind: 'esm_default' });
  }
  // export { a, b as c }
  const exObjRe = /export\s*\{([^}]+)\}/g;
  while ((m = exObjRe.exec(noComments))) {
    m[1].split(',').forEach(s => {
      const n = s.trim().split(/\s+as\s+/).pop();
      if (n) exports.push({ name: n, kind: 'esm_named' });
    });
  }

  // Calls (best-effort): identifier(   and   obj.method(
  const callRe = /(?<![\w$.])([\w$]+)\s*\(/g;
  while ((m = callRe.exec(code))) {
    if (!NOT_A_CALL.has(m[1])) calls.add(m[1]);
  }
  const memCallRe = /(?<![\w$.])([\w$]+)\.([\w$]+)\s*\(/g;
  while ((m = memCallRe.exec(code))) {
    calls.add(m[1] + '.' + m[2]);
    calls.add(m[2]);
  }

  // Return-shape heuristic — used for outputType inference
  const returnsObject = /return\s*(?:await\s+)?\{/.test(code) ||
                        /return\s+(?:await\s+)?[A-Za-z_$][\w$]*\s*\(/.test(code);
  const returnsLooseString = /return\s+['"`]/.test(noComments);
  const hasJsonStringify = /JSON\.stringify\s*\(/.test(code);

  return {
    filePath, raw, imports, exports, calls,
    returnsObject, returnsLooseString, hasJsonStringify,
  };
}

// --- IMPORT RESOLUTION --------------------------------------------------------

function resolveImport(fromFile, source) {
  if (!source.startsWith('.') && !source.startsWith('/')) return null;
  const baseDir = path.dirname(fromFile);
  const candidates = [
    path.resolve(baseDir, source),
    path.resolve(baseDir, source + '.js'),
    path.resolve(baseDir, source + '.mjs'),
    path.resolve(baseDir, source + '.cjs'),
    path.resolve(baseDir, source, 'index.js'),
    path.resolve(baseDir, source, 'index.mjs'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch { /* ignore */ }
  }
  return null;
}

// --- ENGINE CLASSIFICATION ----------------------------------------------------

function classifyFile(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const matches = [];
  for (const [key, cfg] of Object.entries(ENGINES)) {
    let hit = cfg.aliases.some(a => a.test(rel));
    if (hit && cfg.excludes.some(e => e.test(rel))) hit = false;
    if (hit) matches.push(key);
  }
  return matches;
}

// --- ENTRY POINT --------------------------------------------------------------

function findEntryPoint() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.main) {
        const p = path.resolve(REPO_ROOT, pkg.main);
        if (fs.existsSync(p)) return p;
      }
      if (pkg.scripts && pkg.scripts.start) {
        const m = pkg.scripts.start.match(/node\s+([^\s]+)/);
        if (m) {
          const p = path.resolve(REPO_ROOT, m[1]);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch { /* ignore parse errors */ }
  }
  for (const cand of ['index.js', 'server.js', 'app.js', 'main.js',
                       'src/index.js', 'src/server.js', 'src/app.js']) {
    const p = path.resolve(REPO_ROOT, cand);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- REACHABILITY -------------------------------------------------------------

function buildReachable(entryPoint, parsedByPath) {
  const reachable = new Set();
  if (!entryPoint) return reachable;
  const stack = [entryPoint];
  while (stack.length) {
    const f = stack.pop();
    if (reachable.has(f)) continue;
    reachable.add(f);
    const parsed = parsedByPath[f];
    if (!parsed) continue;
    for (const imp of parsed.imports) {
      const resolved = resolveImport(f, imp.source);
      if (resolved && !reachable.has(resolved)) stack.push(resolved);
    }
  }
  return reachable;
}

// --- ENGINE ANALYSIS ----------------------------------------------------------

function analyseEngine(engineKey, cfg, files, parsedByPath, reachable) {
  const engineFiles = files.filter(f => classifyFile(f).includes(engineKey));

  if (engineFiles.length === 0) {
    return {
      engine: engineKey,
      role: cfg.role,
      lane: cfg.lane,
      files: [],
      exports: [],
      importedBy: [],
      calledBy: [],
      runtimeActive: false,
      outputType: 'none',
      feedsJane: cfg.role === 'evidence_producer' ? false : null,
      janeConsumes: cfg.role === 'evidence_producer' ? false : null,
      consumesJane: cfg.role === 'output_consumer' ? false : null,
      sourceStatus: 'UNAVAILABLE',
      evidence: ['No matching file found in repo for this engine.'],
    };
  }

  const exportsAgg = [];
  const importedByAgg = new Set();
  const calledByAgg = new Set();
  const evidence = [];
  let runtimeActive = false;
  let outputType = 'unknown';

  for (const f of engineFiles) {
    const parsed = parsedByPath[f];
    if (!parsed) continue;
    const relF = path.relative(REPO_ROOT, f).replace(/\\/g, '/');

    parsed.exports.forEach(e => exportsAgg.push({ file: relF, name: e.name, kind: e.kind }));

    // Importers of this file
    for (const [otherFile, otherParsed] of Object.entries(parsedByPath)) {
      if (otherFile === f) continue;
      for (const imp of otherParsed.imports) {
        const resolved = resolveImport(otherFile, imp.source);
        if (resolved === f) {
          importedByAgg.add(path.relative(REPO_ROOT, otherFile).replace(/\\/g, '/'));
        }
      }
    }

    if (reachable.has(f)) {
      runtimeActive = true;
      evidence.push(`${relF} is reachable from entry point.`);
    } else {
      evidence.push(`${relF} exists but is NOT reachable from entry point.`);
    }

    // Output type heuristic
    if (parsed.returnsObject || parsed.hasJsonStringify) {
      if (outputType === 'unknown' || outputType === 'none') outputType = 'structured_json_likely';
    } else if (parsed.returnsLooseString) {
      if (outputType === 'unknown' || outputType === 'none') outputType = 'loose_text_likely';
    } else if (parsed.exports.length === 0) {
      if (outputType === 'unknown') outputType = 'none';
    }
  }

  // Did anyone actually call something exported by these files?
  for (const importer of importedByAgg) {
    const fullImporter = path.resolve(REPO_ROOT, importer);
    const parsedImporter = parsedByPath[fullImporter];
    if (!parsedImporter) continue;
    for (const exp of exportsAgg) {
      if (parsedImporter.calls.has(exp.name)) {
        calledByAgg.add(importer);
        break;
      }
    }
  }

  // For evidence engines: does some orchestrator import both this AND jane?
  let feedsJane = false;
  if (cfg.role === 'evidence_producer') {
    for (const importer of importedByAgg) {
      const fullImporter = path.resolve(REPO_ROOT, importer);
      const parsedImporter = parsedByPath[fullImporter];
      if (!parsedImporter) continue;
      let importsJane = false;
      for (const imp of parsedImporter.imports) {
        const resolved = resolveImport(fullImporter, imp.source);
        if (resolved && classifyFile(resolved).includes('jane')) { importsJane = true; break; }
      }
      if (importsJane) {
        feedsJane = true;
        evidence.push(`${importer} imports both ${engineKey} and jane (likely orchestrator).`);
        break;
      }
    }
  }

  // Does Jane import this engine directly?
  let janeConsumes = false;
  if (cfg.role === 'evidence_producer') {
    const janeFiles = files.filter(f => classifyFile(f).includes('jane'));
    for (const jf of janeFiles) {
      const jParsed = parsedByPath[jf];
      if (!jParsed) continue;
      for (const imp of jParsed.imports) {
        const resolved = resolveImport(jf, imp.source);
        if (resolved && classifyFile(resolved).includes(engineKey)) {
          janeConsumes = true;
          evidence.push(`${path.relative(REPO_ROOT, jf).replace(/\\/g, '/')} imports ${engineKey}.`);
          break;
        }
      }
      if (janeConsumes) break;
    }
  }

  // For output consumers: does this engine import jane?
  let consumesJane = false;
  if (cfg.role === 'output_consumer') {
    for (const f of engineFiles) {
      const parsed = parsedByPath[f];
      if (!parsed) continue;
      for (const imp of parsed.imports) {
        const resolved = resolveImport(f, imp.source);
        if (resolved && classifyFile(resolved).includes('jane')) {
          consumesJane = true;
          evidence.push(`${path.relative(REPO_ROOT, f).replace(/\\/g, '/')} imports jane.`);
          break;
        }
      }
      if (consumesJane) break;
    }
  }

  // Status determination
  let sourceStatus = 'UNAVAILABLE';
  if (cfg.role === 'evidence_producer') {
    if (runtimeActive && (feedsJane || janeConsumes) && calledByAgg.size > 0) {
      sourceStatus = 'ACTIVE';
    } else if (runtimeActive || feedsJane || janeConsumes || calledByAgg.size > 0) {
      sourceStatus = 'PARTIAL';
    }
  } else if (cfg.role === 'decision_layer') {
    if (runtimeActive && calledByAgg.size > 0) sourceStatus = 'ACTIVE';
    else if (runtimeActive || calledByAgg.size > 0) sourceStatus = 'PARTIAL';
  } else if (cfg.role === 'output_consumer') {
    if (runtimeActive && consumesJane && calledByAgg.size > 0) sourceStatus = 'ACTIVE';
    else if (runtimeActive || consumesJane || calledByAgg.size > 0) sourceStatus = 'PARTIAL';
  } else if (cfg.role === 'artefact_provider') {
    if (runtimeActive && calledByAgg.size > 0) sourceStatus = 'ACTIVE';
    else if (runtimeActive || calledByAgg.size > 0) sourceStatus = 'PARTIAL';
  }

  return {
    engine: engineKey,
    role: cfg.role,
    lane: cfg.lane,
    files: engineFiles.map(f => path.relative(REPO_ROOT, f).replace(/\\/g, '/')),
    exports: exportsAgg,
    importedBy: [...importedByAgg].sort(),
    calledBy: [...calledByAgg].sort(),
    runtimeActive,
    outputType,
    feedsJane: cfg.role === 'evidence_producer' ? feedsJane : null,
    janeConsumes: cfg.role === 'evidence_producer' ? janeConsumes : null,
    consumesJane: cfg.role === 'output_consumer' ? consumesJane : null,
    sourceStatus,
    evidence,
  };
}

// --- DRIFT DETECTION ----------------------------------------------------------

function detectDrift(engineReports, files, parsedByPath) {
  const flags = [];

  for (const r of engineReports) {
    // Orphan: file exists, nobody imports it (skip decision layer — Jane is imported by orchestrator)
    if (r.files.length > 0 && r.importedBy.length === 0) {
      flags.push({
        severity: 'ERROR',
        rule: 'orphan_engine_file',
        engine: r.engine,
        message: `${r.engine} files exist but nothing imports them: ${r.files.join(', ')}`,
      });
    }
    // Imported but never called
    if (r.importedBy.length > 0 && r.calledBy.length === 0 && r.role !== 'decision_layer') {
      flags.push({
        severity: 'WARN',
        rule: 'imported_not_called',
        engine: r.engine,
        message: `${r.engine} is imported by ${r.importedBy.length} file(s) but no calls to its exports were detected.`,
      });
    }
    // Loose-text output for evidence producers — must emit structured JSON
    if (r.role === 'evidence_producer' && r.outputType === 'loose_text_likely') {
      flags.push({
        severity: 'WARN',
        rule: 'evidence_producer_loose_text',
        engine: r.engine,
        message: `${r.engine} appears to return loose text. Doctrine requires typed JSON evidence packets with score/confidence/lane.`,
      });
    }
  }

  // Corey Clone is mandatory
  const coreyClone = engineReports.find(r => r.engine === 'coreyClone');
  if (coreyClone && coreyClone.sourceStatus !== 'ACTIVE') {
    flags.push({
      severity: 'ERROR',
      rule: 'corey_clone_not_active',
      engine: 'coreyClone',
      message: `Corey Clone is mandatory per locked doctrine (7 May 2026). Current sourceStatus=${coreyClone.sourceStatus}. Wire him into the evidence packet now, even with a minimal but truthful first implementation.`,
    });
  }

  // Jane bypass: output surfaces importing evidence engines directly
  const evidenceKeys = ['spidey', 'corey', 'coreyClone', 'macroEngine'];
  const outputKeys = ['discordOutput', 'dashboardSession'];
  for (const outKey of outputKeys) {
    const outFiles = files.filter(f => classifyFile(f).includes(outKey));
    for (const f of outFiles) {
      const parsed = parsedByPath[f];
      if (!parsed) continue;
      for (const imp of parsed.imports) {
        const resolved = resolveImport(f, imp.source);
        if (!resolved) continue;
        const cls = classifyFile(resolved);
        for (const ek of evidenceKeys) {
          if (cls.includes(ek)) {
            flags.push({
              severity: 'ERROR',
              rule: 'jane_bypass',
              engine: outKey,
              message: `${path.relative(REPO_ROOT, f).replace(/\\/g, '/')} imports evidence engine '${ek}' directly. Output surfaces must consume Jane's packet only — no surface bypasses Jane.`,
            });
          }
        }
      }
    }
  }

  // Output surfaces must import Jane
  for (const outKey of outputKeys) {
    const r = engineReports.find(x => x.engine === outKey);
    if (!r || r.files.length === 0) continue;
    if (!r.consumesJane) {
      flags.push({
        severity: 'WARN',
        rule: 'output_does_not_import_jane',
        engine: outKey,
        message: `${outKey} files do not import jane. Doctrine requires output surfaces consume Jane's decision packet.`,
      });
    }
  }

  // ACTIVE without verified call chain
  for (const r of engineReports) {
    if (r.sourceStatus === 'ACTIVE') {
      if (r.role === 'evidence_producer' && !(r.feedsJane || r.janeConsumes)) {
        flags.push({
          severity: 'ERROR',
          rule: 'active_without_jane_link',
          engine: r.engine,
          message: `${r.engine} is marked ACTIVE but has no verified link to Jane.`,
        });
      }
      if (!r.runtimeActive) {
        flags.push({
          severity: 'ERROR',
          rule: 'active_without_runtime_path',
          engine: r.engine,
          message: `${r.engine} is marked ACTIVE but is not reachable from the entry point.`,
        });
      }
    }
  }

  return flags;
}

// --- MAIN ---------------------------------------------------------------------

function main() {
  const startedAt = new Date().toISOString();
  console.log(`ATLAS_DOCTRINE_AUDIT v${DOCTRINE_VERSION}  (doctrine locked ${DOCTRINE_LOCKED_AT})`);
  console.log(`Repo: ${REPO_ROOT}`);
  console.log('');

  const files = findAllSource();
  console.log(`Scanned ${files.length} JS file(s).`);

  const parsedByPath = {};
  for (const f of files) {
    try {
      parsedByPath[f] = parseFile(f);
    } catch (e) {
      console.error(`  ! parse failed: ${path.relative(REPO_ROOT, f)} — ${e.message}`);
    }
  }

  const entryPoint = findEntryPoint();
  console.log(`Entry point: ${entryPoint ? path.relative(REPO_ROOT, entryPoint) : '(NOT FOUND)'}`);

  const reachable = buildReachable(entryPoint, parsedByPath);
  console.log(`Reachable from entry: ${reachable.size} file(s).`);
  console.log('');

  const engineReports = [];
  for (const [key, cfg] of Object.entries(ENGINES)) {
    engineReports.push(analyseEngine(key, cfg, files, parsedByPath, reachable));
  }

  const driftFlags = detectDrift(engineReports, files, parsedByPath);

  // Call graph: file -> [{ to, engines }]
  const callGraph = {};
  for (const f of files) {
    const parsed = parsedByPath[f];
    if (!parsed) continue;
    const rel = path.relative(REPO_ROOT, f).replace(/\\/g, '/');
    const edges = [];
    for (const imp of parsed.imports) {
      const resolved = resolveImport(f, imp.source);
      if (!resolved) continue;
      const cls = classifyFile(resolved);
      if (cls.length > 0) {
        edges.push({ to: path.relative(REPO_ROOT, resolved).replace(/\\/g, '/'), engines: cls });
      }
    }
    if (edges.length > 0) callGraph[rel] = edges;
  }

  // Missing contracts
  const allRaw = files.map(f => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  }).join('\n');
  const missingContracts = REQUIRED_CONTRACTS.filter(
    c => !new RegExp(`\\b${c}\\b`).test(allRaw)
  );

  // Recommended next inspections
  const recommended = [];
  if (entryPoint) recommended.push(path.relative(REPO_ROOT, entryPoint).replace(/\\/g, '/'));
  for (const r of engineReports) {
    if (r.sourceStatus !== 'ACTIVE' && r.files.length > 0) {
      recommended.push(...r.files.slice(0, 2));
    }
  }

  const summary = {
    doctrineVersion: DOCTRINE_VERSION,
    doctrineLockedAt: DOCTRINE_LOCKED_AT,
    repoRoot: REPO_ROOT,
    startedAt,
    completedAt: new Date().toISOString(),
    entryPoint: entryPoint ? path.relative(REPO_ROOT, entryPoint).replace(/\\/g, '/') : null,
    filesScanned: files.length,
    filesReachableFromEntry: reachable.size,
    enginesActive: engineReports.filter(r => r.sourceStatus === 'ACTIVE').map(r => r.engine),
    enginesPartial: engineReports.filter(r => r.sourceStatus === 'PARTIAL').map(r => r.engine),
    enginesUnavailable: engineReports.filter(r => r.sourceStatus === 'UNAVAILABLE').map(r => r.engine),
    driftErrorCount: driftFlags.filter(f => f.severity === 'ERROR').length,
    driftWarnCount: driftFlags.filter(f => f.severity === 'WARN').length,
    missingContractCount: missingContracts.length,
  };

  const audit = {
    summary,
    doctrine: {
      lockedAt: DOCTRINE_LOCKED_AT,
      evidenceProducers: ['spidey', 'corey', 'coreyClone', 'macroEngine'],
      decisionLayer: 'jane',
      outputConsumers: ['discord', 'dashboard', 'astra'],
      tradeViabilityValues: ['VALID', 'MARGINAL', 'INVALID'],
      hardRules: [
        'No engine claims ACTIVE unless physically wired and traceable from entry point.',
        'No surface bypasses Jane.',
        'Output surfaces consume Jane\'s packet only.',
        'Corey Clone is mandatory, not optional.',
      ],
    },
    engines: engineReports,
    drift: driftFlags,
    missingContracts,
    callGraph,
    recommendedNext: [...new Set(recommended)],
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(audit, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(audit), 'utf8');

  // Console summary
  console.log('=== ATLAS DOCTRINE AUDIT — SUMMARY ===');
  console.log(`Files scanned:                ${summary.filesScanned}`);
  console.log(`Files reachable from entry:   ${summary.filesReachableFromEntry}`);
  console.log(`Engines ACTIVE:               ${summary.enginesActive.join(', ') || '(none)'}`);
  console.log(`Engines PARTIAL:              ${summary.enginesPartial.join(', ') || '(none)'}`);
  console.log(`Engines UNAVAILABLE:          ${summary.enginesUnavailable.join(', ') || '(none)'}`);
  console.log(`Missing contracts:            ${summary.missingContractCount} of ${REQUIRED_CONTRACTS.length}`);
  console.log(`Drift ERRORS:                 ${summary.driftErrorCount}`);
  console.log(`Drift WARNINGS:               ${summary.driftWarnCount}`);
  console.log('');

  if (driftFlags.length) {
    console.log('--- DRIFT FLAGS ---');
    for (const f of driftFlags) {
      console.log(`  [${f.severity}] (${f.rule}) ${f.engine}`);
      console.log(`         ${f.message}`);
    }
    console.log('');
  }

  console.log(`Audit JSON:    ${OUT_JSON}`);
  console.log(`Audit summary: ${OUT_MD}`);
  console.log('');

  const fail = summary.driftErrorCount > 0 || (STRICT && summary.driftWarnCount > 0);
  if (fail) {
    console.log(`FAIL: doctrine drift detected${STRICT ? ' (strict mode: warnings count)' : ''}.`);
    process.exit(1);
  } else {
    console.log('PASS: no ERROR-level doctrine drift.');
    process.exit(0);
  }
}

// --- MARKDOWN REPORT ----------------------------------------------------------

function renderMarkdown(audit) {
  const s = audit.summary;
  const lines = [];
  lines.push(`# ATLAS Doctrine Audit`);
  lines.push('');
  lines.push(`**Doctrine version:** ${s.doctrineVersion} (locked ${s.doctrineLockedAt})`);
  lines.push(`**Run at:** ${s.completedAt}`);
  lines.push(`**Repo:** \`${s.repoRoot}\``);
  lines.push(`**Entry point:** \`${s.entryPoint || '(NOT FOUND)'}\``);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Files scanned | ${s.filesScanned} |`);
  lines.push(`| Files reachable from entry | ${s.filesReachableFromEntry} |`);
  lines.push(`| Engines ACTIVE | ${s.enginesActive.join(', ') || '_(none)_'} |`);
  lines.push(`| Engines PARTIAL | ${s.enginesPartial.join(', ') || '_(none)_'} |`);
  lines.push(`| Engines UNAVAILABLE | ${s.enginesUnavailable.join(', ') || '_(none)_'} |`);
  lines.push(`| Missing contracts | ${s.missingContractCount} of ${REQUIRED_CONTRACTS.length} |`);
  lines.push(`| Drift ERRORS | ${s.driftErrorCount} |`);
  lines.push(`| Drift WARNINGS | ${s.driftWarnCount} |`);
  lines.push('');

  lines.push(`## Engine Status`);
  lines.push('');
  lines.push(`| Engine | Role | Lane | Status | Files | Imports Jane / Feeds Jane | Output type |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of audit.engines) {
    const link = r.role === 'evidence_producer'
      ? `feeds=${r.feedsJane} / janeConsumes=${r.janeConsumes}`
      : r.role === 'output_consumer'
        ? `consumesJane=${r.consumesJane}`
        : '—';
    lines.push(`| **${r.engine}** | ${r.role} | ${r.lane} | **${r.sourceStatus}** | ${r.files.length} | ${link} | ${r.outputType} |`);
  }
  lines.push('');

  if (audit.drift.length) {
    lines.push(`## Drift Flags`);
    lines.push('');
    for (const f of audit.drift) {
      lines.push(`- **[${f.severity}]** \`${f.rule}\` — **${f.engine}**: ${f.message}`);
    }
    lines.push('');
  }

  if (audit.missingContracts.length) {
    lines.push(`## Missing Packet Contracts`);
    lines.push('');
    lines.push(`The following type/contract names are nowhere in the codebase. Per doctrine they must be published before further wiring:`);
    lines.push('');
    for (const c of audit.missingContracts) lines.push(`- \`${c}\``);
    lines.push('');
  }

  lines.push(`## Per-Engine Detail`);
  lines.push('');
  for (const r of audit.engines) {
    lines.push(`### ${r.engine}  —  ${r.sourceStatus}`);
    lines.push('');
    lines.push(`- **Role:** ${r.role}`);
    lines.push(`- **Lane:** ${r.lane}`);
    lines.push(`- **Files:** ${r.files.length ? r.files.map(x => '`' + x + '`').join(', ') : '_(none)_'}`);
    lines.push(`- **Exports:** ${r.exports.length ? r.exports.map(e => '`' + e.name + '`').join(', ') : '_(none)_'}`);
    lines.push(`- **Imported by:** ${r.importedBy.length ? r.importedBy.map(x => '`' + x + '`').join(', ') : '_(none)_'}`);
    lines.push(`- **Called by:** ${r.calledBy.length ? r.calledBy.map(x => '`' + x + '`').join(', ') : '_(none)_'}`);
    lines.push(`- **Runtime active:** ${r.runtimeActive}`);
    lines.push(`- **Output type:** ${r.outputType}`);
    if (r.role === 'evidence_producer') {
      lines.push(`- **Feeds Jane:** ${r.feedsJane}`);
      lines.push(`- **Jane consumes:** ${r.janeConsumes}`);
    }
    if (r.role === 'output_consumer') {
      lines.push(`- **Consumes Jane:** ${r.consumesJane}`);
    }
    if (r.evidence.length) {
      lines.push(`- **Evidence:**`);
      for (const e of r.evidence) lines.push(`  - ${e}`);
    }
    lines.push('');
  }

  if (audit.recommendedNext.length) {
    lines.push(`## Recommended next files to inspect`);
    lines.push('');
    for (const f of audit.recommendedNext) lines.push(`- \`${f}\``);
    lines.push('');
  }

  return lines.join('\n');
}

main();
