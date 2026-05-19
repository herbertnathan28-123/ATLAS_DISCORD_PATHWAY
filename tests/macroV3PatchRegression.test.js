#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const env = Object.assign({}, process.env, {
  ATLAS_NO_LOGIN: '1',
  DISCORD_BOT_TOKEN: 'qa-stub',
  TWELVE_DATA_API_KEY: 'qa-stub',
  SYSTEM_STATE: 'BUILD_MODE'
});

const run = spawnSync(process.execPath, ['scripts/test_discord_batch_qa.js'], {
  cwd: repoRoot,
  env,
  encoding: 'utf8'
});

const output = (run.stdout || '') + (run.stderr || '');
process.stdout.write(output);

assert.strictEqual(run.status, 0, 'Discord batch QA should pass');
assert.match(output, /\[MACRO\] v3 ACTIVE .*sectionsBuilt=9\/9/, 'Macro v3 must remain active with 9/9 sections');
assert.match(output, /\[DISCORD\] section sent ATLAS_MACRO_V3 1/, 'Macro v3 chunks must be sent');
assert.doesNotMatch(output, /\[JANE-POST\] unexpected/i, 'Jane post should not emit unexpected errors');
assert.doesNotMatch(output, /Cannot access 'marketDataAudit' before initialization/, 'marketDataAudit TDZ regression must not return');
assert.doesNotMatch(output, /ATLAS_MACRO_FAIL_CLOSED/, 'Macro v3 must not fail closed');
assert.match(output, /coreyClone=secondary macro model — pending/, 'secondary macro model status should be pending');
assert.doesNotMatch(output, /coreyClone=active: engine wired/, 'secondary macro model must not falsely claim active engine wiring');
assert.doesNotMatch(output, /coreyClone=unavailable: not implemented/, 'secondary macro model must not contradict pending status');

console.log('[MACRO-V3-PATCH-REGRESSION] PASS');
