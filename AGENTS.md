# Treadmill Control

Static web app (vanilla JS, no build, no npm deps) that controls Bluetooth FTMS treadmills (service `0x1826`) from Chrome via Web Bluetooth. Note: `GEMINI.md` is outdated (it claims all code is in `index.html`); this file wins.

## Layout
- `index.html` (UI + main logic), `camera.js`, `camera-utils.js`, `camera-worker.js`, `camera-belt-controller.js` (camera automation), `incline-utils.js` (pure incline logic), `sw.js` (service worker, `CACHE_NAME = 'treadmill-control-shell-vN'`), `manifest.json`, `icons/`, `vendor/`, `tests/`.
- Target speed is saved in `localStorage` (`targetSpeed`). Keep pure logic in modules like `incline-utils.js`, with tests.

## Run
- Serve the folder over HTTPS or localhost (Web Bluetooth needs a secure context), e.g. `python3 -m http.server 8000`. No build step.
- Web Bluetooth can't run on the box. Real hardware only works from Martin's **ThinkPad T14** (Omarchy Linux, scripts in `~/treadmill-explore`, `uv run --with bleak python …`), and each command there needs his approval on the ThinkPad itself (a chat "yes" doesn't count).

## Check it works
- `node --test tests/*.test.mjs`
- UI with a fake treadmill: Puppeteer scripts `/workspace/vs-e2e/tm-incline.mjs` and `tm-incline-resume.mjs`. Screenshots in `/workspace/tm-ux/`.
- Hardware test: first ask Martin to disconnect his phone from the treadmill and confirm **nobody is on the belt**. Always send Stop in a `finally`.

## Deploy
- GitHub Pages from `main` (`.github/workflows/deploy-pages.yml`) → https://martinnielsen.github.io/treadmill-control/. **Pushing main is a deploy** — get Martin's yes first.
- Bump `CACHE_NAME` in `sw.js` on every release.

## Never touch / must keep working
- Two treadmills must both keep working:
  - Old walking pad: FTMS, speed only, no incline.
  - InfiCo X14 (BLE name `KS-MST-X4`, standard FTMS, FitShow FS-BT-C1, address 63:4C:EE:0C:8C:32): speed 1.0–14.0 km/h; incline 0–15 % in 1 % steps via FTMS opcode `0x03` (sint16, 0.1 %). Treadmill Data flags `0x058c` have no elevation field. The belt only moves once a speed is set after Start. Incline may be ignored unless the belt is running, so send it only after the ramp-up has set the target speed.
- Keep the start sequence: Start `0x07`, 1.0 km/h right away, target speed after 5 s.
- Sessions accumulate distance and elevation gain (Δdistance × incline); each stores `lastInclinePercent`, and Play restores it.

## Recurring gotcha
- "Belt stops by itself": first check whether the **camera automation is armed** — it sends Stop when it sees no person (the cause on 2026-10-31). The camera reads go2rtc at `http://teslamate2host:1984`, which needs CORS `origin: "*"`.

## Git and approval (Martin's rules)
- Default: work on `feature/<name>`; pushing the branch is fine. Merging to main, pushing main or deploying needs Martin's go-ahead unless he pre-approved that kind of change in chat.
- Commit identity is repo-local: `Martin Nielsen <martin.nielsen@gmail.com>`. `gh` uses env `GITHUB_TOKEN` (fine-grained PAT). On a token-scope error, stop and report the exact error; no workarounds.
- Never force-push. Commit early in long tasks (runs can be cut off after ~50 min).

## Verification before saying "done"
- Run the tests, then check the real UI in headless Chrome (puppeteer-core in `/workspace/vs-e2e`) at 390×844 with touch emulation. Screenshots under `/workspace/<project>-ux/`.
- After a deploy, check that the live URL serves the new version. Remind Martin (Android/OnePlus, Chrome) to reload once to pass the service-worker cache.
- Say plainly what was NOT tested. Report unrelated bugs; don't fix them silently.

## Reporting and secrets
- Plain, short English for Martin (Danish, not a native English speaker). App UI text is Danish unless stated otherwise.
- Report: what changed in user terms, commit hash, version, test results, what's live, caveats.
- Secrets live only as box env vars (e.g. `GITHUB_TOKEN`, `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `OPENROUTER_API_KEY`). Check names only, never print values, never write keys to files.
- Free tiers only (Vercel hobby, Cloudflare free). Mention any cost before spending.
