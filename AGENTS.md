# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

ATLAS FX is a Discord bot providing institutional-grade FX/macro analysis. Single Node.js process, deployed to Render. See `CLAUDE.md` for the full architecture and locked constraints.

### Node version

The project requires **Node.js 20.x** (`engines` field in `package.json`). Use `nvm use 20` before running any commands.

### Running without API keys (QA harness mode)

The bot requires `DISCORD_BOT_TOKEN`, `TWELVE_DATA_API_KEY`, and `SYSTEM_STATE` env vars or it will `process.exit(1)`. For local dev/testing without real credentials, use stub values and the no-login flag:

```sh
ATLAS_NO_LOGIN=1 DISCORD_BOT_TOKEN=qa-stub TWELVE_DATA_API_KEY=qa-stub SYSTEM_STATE=BUILD_MODE node index.js
```

This boots all modules (Corey live data, calendar, macro v3, Dark Horse Engine) but suppresses the Discord gateway login. TwelveData calls will fail gracefully (degraded mode). The TrendSpider HTTP server on port 3001 only starts inside the `clientReady` event, so it won't be available in no-login mode.

### QA test scripts (no real API keys needed)

Most QA scripts use their own stub env vars. Key commands:

| Command | What it tests |
|---|---|
| `npm run audit` | Static doctrine audit (file wiring, contracts) |
| `npm run test:runtime` | Runtime packet test with `ATLAS_TEST_MODE=1` (needs `DISCORD_BOT_TOKEN` + `TWELVE_DATA_API_KEY` + `SYSTEM_STATE` env vars — stubs OK) |
| `npm run qa:live-route` | Production presenter path — sets its own stubs |
| `npm run qa:discord-batch` | Full Discord batch delivery — sets its own stubs |
| `npm run qa:darkhorse` | Dark Horse Engine watch/cooldown/FOMO guard |
| `npm run qa:macro` | Macro v3 builder scenarios |
| `npm run qa:dh-delivery` | Webhook delivery instrumentation |
| `npm run qa:wording-directives` | Advisory wording rewrite rules |

### Gotchas

- **No lockfile for pnpm/yarn** — this project uses `npm` exclusively (there is a `package-lock.json`).
- **`prebuild` hook** — `npm run prebuild` runs `npm run audit && npm run test:runtime`, which requires the three required env vars. If running `npm install` and it triggers a build step, this can fail without env vars set. Plain `npm install` does not trigger `prebuild`.
- **`require('./macro')` vs `require('./macro/index.js')`** — Node resolves `./macro` to `./macro.js` (the Phase-D packet emitter), NOT `./macro/index.js` (the v3 builder). Always use the explicit path `./macro/index.js` for `buildMacroV3`.
- **Audit artifacts** — `npm run audit` and `npm run test:runtime` write `audit.json`, `audit.summary.md`, `runtime-packet-test.json`, `runtime-packet-test.summary.md` to the repo root. These are `.gitignore`-safe but will appear in the working directory.
