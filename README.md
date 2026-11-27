# 🎮 Golu Studio

A game-ideation studio for Anurag. Locally it is the shelf, the theme picker and Create H5. In the cloud, a nightly autopilot runs that same pipeline and publishes only the high-scoring games. One-time setup for the night job is in **[Nightly autopilot and gallery](#nightly-autopilot-and-gallery)**.

A local game-ideation studio:

1. **The Shelf**: every game Chotu fetched and Pintu rated, shown as 3D icon tiles ranked by Pintu's overall score (podium for the top 3), with category filters and search.
2. **Tap a game → pick a theme**: themes seeded from Pintu's `theme_ideas` plus AI suggestions, each with an AI-drawn SVG preview of how the game would look.
3. **Merge mechanics**: multi-select from the original mechanic plus 17 more (Sorting, Pathfinding, Merge, Match-3, Tile/Block, Physics stacking, Idle, Runner, Tower defense, Bubble shooter, Screw/Bolt, Parking/Traffic jam, Draw-to-solve, Hidden object, Word, Rhythm, Logic). Each one shows the icons of games on the shelf that use it, plus well-known reference titles. Pick 2 or more to see an animated "merging" view and an AI-written fused concept.
4. **Generate Mockup Idea**: a full concept (title, hook, core loop, how the mechanics merge, art direction, progression, monetization) plus an **animated gameplay mockup** (self-contained HTML/SVG/CSS). The app records it in headless Chrome and turns it into a **GIF**. It also keeps a still image and a frame slideshow.
5. **Present new**: a different idea under the same constraints. Earlier ideas are sent to the AI so it avoids repeating them, and the idea history is saved per game.
6. **Create H5**: the AI draws SVG art (background, sprites, app icon) and writes a complete single-file HTML5 canvas game. The app then loads it in headless Chrome, taps around, catches JS errors and blank screens, and sends any problems back to the AI to fix (up to 3 rounds). You can play the result in the app, open it full screen or download it as a .zip.

7. **⭐ Rate My Game** (header button, `#/rate`): upload anything (gameplay video, screenshots, an HTML or zipped H5 build, APK/IPA, pitch PDF, docx/pptx, text) and get a rating with **Pintu's scoring v2 (18 Nov 2026)**. Golu extracts what the AI can use, the AI judges each pillar, and the score is **computed in code** with Pintu's weights, borrow rules and caps. Every rating goes into a **catalogue** (`#/rated`) that shows how many games have been rated, each one's score and a one-line reason, sortable by date or score; tap an entry for the full report, or delete it.

## Rate My Game

**What happens to each file**
| Upload | What Golu extracts |
| --- | --- |
| Video (mp4, mov, webm, mkv…) | 8 evenly spaced keyframes with **ffmpeg**. Without ffmpeg, headless Chrome plays the video and grabs frames (works for codecs Chrome can decode). |
| HTML / zipped H5 build | Unzips, loads `index.html` in headless Chrome, taps around, saves start + play screenshots, notes JS errors, and reads the code. |
| Images (png, jpg, webp, gif, svg…) | Used directly, resized. |
| PDF | Text with `pdftotext` and first pages as images with `pdftoppm` (poppler). |
| docx / pptx / xlsx | Text and embedded images read straight from the file. |
| APK / AAB / IPA | File list, engine detection (Unity, Cocos, Godot, Flutter…) and the app icon. Native apps can't be played, so add a gameplay video. |
| Anything else | Name, type and size. Text-like files are read as text. |

**How the score is made (Pintu v2, see `data/rubric/`)**
- Pillars, each 1-10: market momentum 25, staying power 10, market size and proof 15, hook and core loop 20 (half hook clarity, half input simplicity), monetisation fit 10, theme and live-ops 10, feasibility and twist 10. Mashup compatibility counts for 10 only when the core loop combines 2+ mechanics (5 checks × 0-2), and then the other weights are × 0.9.
- An upload has no market data, so the AI picks 3-5 comparables from Pintu's catalogue. Staying power and size are their similarity-weighted median minus 1. Momentum is that borrowed value (17/25) blended with the AI's clone-wave stage judgement A3 for the combination (8/25), which is capped at 5 when the combination is saturated.
- Input rules: tap-only simple 10, tap complex 7-8, drag or swipe 7-8, drag-to-merge 7-8 (never capped), tap + double tap 5-6 (7 if optional), competing tap + swipe or 3+ inputs 2-3.
- Overall is the weighted average to one decimal. Caps: tap + swipe or 3+ inputs → 5.0; mashup ≤ 4 → 6.0; the lower cap wins.
- Confidence: low for images or text only, medium with a playable HTML build or video, high when the upload contains real test KPIs (D1, D7, CPI).
- The math is in `lib/scoring-v2.js`, ported from Pintu's `score_v2.py`. Each report shows the rubric version, the formula with the weights used, any cap, and the comparables.

**AI call**: one text-model call (newest Claude Sonnet via the Cursor CLI by default). Keyframes and screenshots are copied into the CLI's temp workspace and the prompt tells the model to open each one. API providers get up to 8 images attached. It usually takes 1-5 minutes (`RATE_TIMEOUT_MIN`, default 12). If it fails, the page offers **Retry** on the same uploads. Demo mode gives placeholder numbers.

**Optional tools for the best extraction (macOS)**: `brew install ffmpeg poppler` (video keyframes for any codec, and PDF text and pages). Without them Golu still works, using Chrome for video and skipping PDF text.

**Refreshing Pintu's rubric**: the rubric and a v2 scores snapshot of Pintu's 171 games live in `data/rubric/`. On Golu's machine, run `node scripts/update-rubric.js` (reads `/workspace/shared`) after Pintu changes the rubric. If the synced ratings file ever carries v2 pillar scores, comparables come from it automatically.

**Settings**: `RATE_MAX_MB` (per-file upload limit, default 2048), `RATE_TIMEOUT_MIN`, `FFMPEG_PATH` / `FFPROBE_PATH`.

## Run it

Requirements: **Node 18+** and **Google Chrome** (or Edge/Chromium). Chrome is used to make GIFs and to check generated games.

```bash
npm install
npm start            # opens http://localhost:5173
```

By default Golu uses **your Cursor subscription** through the Cursor CLI, running Claude models, so you don't need an API key. See below. If you have a Claude Pro/Max plan instead, switch the provider to Claude Code in ⚙️ Settings. API keys still work if you have one: pick the provider in ⚙️ Settings or set it in `.env`.

## Using your Cursor subscription (default), no API key

Golu runs every AI step through `cursor-agent -p` (the Cursor CLI's headless mode) on your Cursor account, using Cursor's Claude models.

**macOS** (Terminal / zsh):
```bash
curl https://cursor.com/install -fsS | bash   # installs to ~/.local/bin (cursor-agent, plus the newer `agent` name)
cursor-agent login                            # finish the sign-in in your browser
cursor-agent status                           # should say you're logged in
npm install && npm start
```
Golu finds the CLI in `~/.local/bin` even if that folder isn't on your PATH. You can also set `CURSOR_CLI_PATH=/path/to/cursor-agent` in `.env`.

**Windows** (PowerShell): `irm 'https://cursor.com/install?win32=true' | iex`, then `cursor-agent login`, then `npm install; npm start`.

The home screen shows a **"Use your Cursor subscription"** card until the CLI is found and signed in. Click **Re-check**, then **Test**. Test sends a tiny prompt and shows which models were picked.

How Golu runs the CLI:
- Each call runs `cursor-agent -p --output-format json --mode ask --trust --workspace <fresh empty temp folder> --model <id> "<prompt>"`.
- `--mode ask` is the CLI's read-only mode. Golu never passes `--force`, and the temp folder is deleted after every call, so the agent can't edit your files.
- The CLI has no system-prompt flag, so Golu's instructions are placed at the top of the prompt.
- The CLI has no image-input flag either. For H5 builds, the mockup screenshot is copied into the temp folder and the prompt points to it, so the agent can view it with its read tool. The written art direction is always in the prompt too.
- Prompts over 200 KB (big fix rounds) are passed as a `prompt.md` file in the temp folder.
- Models: Cursor's model IDs depend on your account and change over time. Golu runs `cursor-agent --list-models` and picks the newest Claude Sonnet for text and art (e.g. `claude-4.6-sonnet-medium`) and the newest Claude Opus for H5 code (e.g. `claude-opus-4-8-high`). If a model is rejected ("Cannot use this model" or plan-gated), it retries with `auto`. You can override in Settings or with `CURSOR_AGENT_TEXT_MODEL` / `CURSOR_AGENT_CODE_MODEL`.
- At most 2 calls run at once (`CURSOR_AGENT_CONCURRENCY`). Each call times out after 10 minutes (`CURSOR_AGENT_TIMEOUT_MIN`). Sign-in, usage-limit and "headless mode disabled by your team" errors show a clear message.

## Using a Claude subscription (Pro/Max) instead

Pick **Claude subscription via Claude Code CLI** in ⚙️ Settings (or set `AI_PROVIDER=claude-code`). Golu then runs every AI step (themes, SVG previews, concepts, mockups, H5 code) by calling `claude -p` (Claude Code's headless mode). The CLI uses whatever account you signed in with, so the work counts against your Claude plan's usage limits.

**Windows** (PowerShell):
```powershell
npm install -g @anthropic-ai/claude-code   # needs Node 18+
claude                                     # first run: pick "Claude account with subscription", sign in in the browser, then type /exit
npm install; npm start
```
If `claude` isn't recognised after installing, close and reopen PowerShell. If it still isn't found, set `CLAUDE_CLI_PATH=C:\Users\<you>\AppData\Roaming\npm\claude.cmd` in `.env`.

**macOS** (Terminal):
```bash
npm install -g @anthropic-ai/claude-code   # if you get a permissions error, use the native installer: curl -fsSL https://claude.ai/install.sh | bash
claude                                     # sign in with your Claude app account, then /exit
npm install && npm start
```

The home screen shows a **"Use your Claude subscription"** card until the CLI is found and signed in. Click **Re-check**, then **Test**. Test sends a tiny prompt and should show "✅ Working".

How Golu runs the CLI:
- Flags: `--tools "" --max-turns 1 --no-session-persistence`. Tools are off, there's one reply per call, and nothing is saved to your Claude Code history.
- Your system prompt goes in through `--system-prompt-file`. The message goes in on stdin as `--input-format stream-json`, so the mockup screenshot reaches the model as a real image. Older CLIs that lack stream-json input fall back to plain text and a text description.
- Calls run from an empty temp folder, so no `CLAUDE.md` or project settings are picked up. Any `ANTHROPIC_API_KEY` is removed from the CLI's environment, so it always bills your subscription.
- Models: `sonnet` for text and art, `opus` for the H5 code. If your plan doesn't include Opus, Golu falls back to `sonnet` automatically. You can change both in Settings or `.env` (`CLAUDE_CODE_TEXT_MODEL`, `CLAUDE_CODE_CODE_MODEL`).
- At most 2 CLI calls run at once (`CLAUDE_CODE_CONCURRENCY=1` is gentler on usage limits). Each call times out after 10 minutes (`CLAUDE_CODE_TIMEOUT_MIN`).
- If you hit your plan's usage limit, Golu shows that message. Wait for the reset, or switch the code model to `sonnet`.

No AI set up yet? Click **Try demo mode** on the home screen, or run `npm run mock`. Demo mode runs the whole flow offline with mock content and a built-in playable sort + merge game.

### AI providers
| Provider | How | Models |
| --- | --- | --- |
| **Cursor subscription via Cursor CLI** (default) | `cursor-agent` signed in to your Cursor account | Newest Claude Sonnet / Opus from `cursor-agent --list-models` (fallback `auto`) |
| Claude subscription via Claude Code | `claude` CLI signed in, choose it in Settings (`AI_PROVIDER=claude-code`) | `sonnet` for text, mockups and art; `opus` for H5 code (falls back to `sonnet`) |
| Anthropic API | `ANTHROPIC_API_KEY` + choose "Anthropic API key" in Settings (or `AI_PROVIDER=anthropic`) | Picked automatically from `GET /v1/models`. Text, themes, mockups and SVG art use the newest **Sonnet**. H5 code uses the newest **Opus** (if it's within ~90 days of the newest Sonnet), otherwise Sonnet. You can override this in Settings or with `ANTHROPIC_TEXT_MODEL` / `ANTHROPIC_CODE_MODEL`. |
| Google Gemini (optional) | `GEMINI_API_KEY` + `AI_PROVIDER=gemini`, or pick it in Settings | Newest Gemini Pro from the models list. It uses the same SVG/HTML pipeline. |

Claude can't output raster images, so all visuals are vector: theme previews are SVG, mockups are animated HTML, GIFs are captured from that HTML, and game art is SVG embedded as data URIs.

## Nightly autopilot and gallery

Every night a GitHub Actions job picks new theme and mechanic combinations off the Pintu shelf, builds each one with the same Create H5 path as `npm start`, plays it in headless Chrome, and scores it with Pintu's rubric (`lib/scoring-v2.js`). Games that score **7 or higher** and actually run are committed back to this repo and show up on the gallery:

**https://anuragsingh-web.github.io/golu-studio/**

Broken builds and anything under the bar are deleted. They are listed only in that night's report (`data/autopilot/runs/`). The same combination is not tried again (`data/autopilot/history.json`). `npm start` is unchanged.

### One-time setup

Do these once, in order. The night job cannot open a browser login, so the Cursor CLI authenticates with `CURSOR_API_KEY`.

1. **Create a Cursor API key.** Open [https://cursor.com/dashboard/api](https://cursor.com/dashboard/api), go to **API Keys**, and create a key (name it `Golu Studio`). Copy it immediately. It is shown only once.

2. **Add the Actions secret.** On this GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `CURSOR_API_KEY`
   - Secret: the key from step 1

3. **Let Actions write to the repository.** **Settings → Actions → General → Workflow permissions → Read and write permissions → Save.** The night job commits kept games, the history file and the gallery catalogue to `main`. If `main` is protected, allow the GitHub Actions bot to push, or the commit step fails and the gallery does not update.

4. **Turn on Pages from Actions.** **Settings → Pages → Build and deployment → Source: GitHub Actions → Save.** The URL above stays empty until this is set and a deploy has succeeded. The first deploy can take about a minute. Pages will ask you to approve the `github-pages` environment the first time.

5. **Run it once by hand** so you do not have to wait until 1:00 AM IST. **Actions → Nightly autopilot → Run workflow** (use the `main` branch).
   - **count**: how many combinations to try (default 20)
   - **threshold**: minimum score to keep, from 0 to 10 (default 7)
   - **mock**: leave this off. On runs the pipeline with no Cursor calls and does not publish.

The schedule is **1:00 AM India time** (`30 19 * * *` UTC). A run that is still going is not cancelled by the next one; the next one waits. The job limit is 5 hours 30 minutes, under GitHub's 6 hour cap. Two games are built at a time, and each game gives up after 30 minutes so one stuck build cannot take the night.

### What a night costs

A full night of 20 games is about **150–180 Cursor CLI calls** on the account that owns `CURSOR_API_KEY`. Roughly **20–40 of those are code-model calls** (one HTML5 game each, plus a single fix pass if the first build crashes). The rest are shorter text calls: themes, the merge line, the concept, the mockup, two art passes, and the rating. There is no separate API invoice; it draws on that Cursor plan. Themes are cached per game and mechanic set, so a later night reuses them.

Store icons are not in the repo (`data/icons/` is gitignored, about 41 MB). The night job does not need them. `npm run icons` still fills the local shelf.

### Run the same script locally

```bash
npm install
MOCK=1 npm run autopilot -- --count 4 --threshold 7   # offline, no key
npm run autopilot -- --count 20 --threshold 7         # real Cursor CLI
npm run autopilot -- --plan                           # show tonight's queue
```

Kept games land in `gallery/games/<slug>/` (`index.html`, a screenshot, a short GIF, `meta.json`). The static page is `gallery/index.html`. Demo mode (`MOCK=1`) skins the built-in sort-and-pour template and uses a stand-in score so you can see the keep/discard path with no key. Those scores are not a real critique. A mock run from Actions does not commit or deploy.

## Host it online

To put the full working app on a public `https://….onrender.com` link (Cursor API key + Render free plan), follow **[DEPLOY.md](DEPLOY.md)**. The Dockerfile installs Chromium and the Cursor CLI, binds `HOST=0.0.0.0`, and reads Render’s `$PORT`. Set `CURSOR_API_KEY` and, because the link is public, `APP_PASSWORD`.

Local `http://localhost:5173` is unchanged.

## Where things go
| Path | What |
| --- | --- |
| `data/pintu_ratings.json` | Pintu's ratings snapshot. The server auto-syncs it from the shared Google Sheet on start and every 30 minutes, and re-reads it on every request. If the sheet is unreachable, the local file is kept. See `scripts/README.md` and `scripts/push-ratings-to-sheet.md`. |
| `data/rated_games.json` | Rate My Game catalogue: one summary per rated game (score, pillar scores, reason, thumbnail, date). |
| `data/rated-games/<id>/` | `uploads/` (original files), `assets/` (keyframes, screenshots, page images), `build/` (unzipped H5), `thumb.jpg`, `report.json` (full report). |
| `data/rubric/` | Pintu's v2 rubric (`SCORING_V2.md`, `IDEA_RATING.md`, `archetypes.json`) and `pintu_v2_scores.json` (comparables). |
| `data/icons/` | Cached game icons. The remote URL is used if one is missing. |
| `data/cache/<provider>/<game>/` | Cached themes, theme preview SVGs and merge summaries |
| `data/ideas/<id>/` | `idea.json`, `mockup.html`, `mockup.png`, `frame_*.png`, `preview.gif` |
| `games/<slug>/` | Local Create H5 output (gitignored). `index.html`, `assets/*.svg`, `screenshot.png`, `meta.json`. |
| `gallery/` | Static GitHub Pages gallery. `games.json` plus `games/<slug>/` for every night that cleared the score bar. |
| `data/autopilot/history.json` | Combinations already tried, so a night does not repeat one. |
| `data/autopilot/runs/` | One JSON report per night: keeps, scores under the bar, and broken builds. |

## Troubleshooting
- **Updating the app**: when you replace the folder with a new version, keep `.env`, `data/rated_games.json` and `data/rated-games/` so you don't lose the Rate My Game catalogue.
- **"No Chrome found"**: install Chrome, or set `CHROME_PATH` in `.env`. Without it, GIF capture and H5 validation are skipped, but you still get the live animated mockup.
- **Port busy**: `PORT=5174 npm start` (on Windows PowerShell: `$env:PORT=5174; npm start`).
- **Rate limits / 529 overloaded**: the client retries automatically. If it still fails, click the button again.
- Generating an H5 game with Opus can take 2–6 minutes. The progress panel shows each step.
