# Pintu scoring v2: how to score a game (used by the "Rate new Puzzle Pulse games" routine)

Adopted 18 Nov 2026 for Anurag. Every parameter is 1-10; Overall is the weighted average, one decimal.
Research and sources: `idea_rubric_research.md`. Code: `score_v2.py` (+ `st_match.py`, `fetch_public.py`, `export_shared.py`).

## Pillars and weights
| Pillar | Weight | How it is computed |
|---|---|---|
| Market momentum | 25 | A1 growth (10): Sensor Tower downloads vs prior 30d (growth damped x0.5 if the prior period was under 50K; ignored under 10K); games <=120 days old or with no prior base also get 30d-downloads-vs-age, and the higher wins. Without ST: store rating-count growth per 30d between `public_snapshots/` (>=2 days apart) and installs since launch. A2 chart velocity (7): best category chart rank vs age. A3 clone-wave stage (8): judgement; `saturated: true` (200+ clones/yr) caps A3 at 5. Games <=180 days old with A1 >= 8.5 get momentum >= 8.0. Web: plays/votes per month (+ Poki live rank) ranked within portal, then rank-matched onto the mobile A1/A2 distribution (no web cap). itch.io: A1 1.5, A2 2-2.5 unless real traction data exists. |
| Staying power | 10 | ST matched: DAU / 30d downloads (0.05 -> 2 ... 2.0 -> 10), +0.5 if DAU grows 15pts faster than downloads, -1 if DAU falls while downloads rise, -1.5 for Bus Out-style decay (downloads <= -30% and DAU <= -25%); young games blend 50/50 with 5.5. Then 70% data + 30% judged depth. Without ST: age-on-charts (5-8) and rating, 50/50 with depth. |
| Market size and proof | 15 | B1 (8) = v1 Performance formula without the recency bonus (refreshed from ST growth export when matched). B2 (7) = revenue per download (0 -> 1, $0.5 -> 4, $1.7 -> 6, $3.4 -> 8, $4.3+ -> 10); ads-funded games with 3M+ downloads floor at 3 (store revenue excludes ad revenue). No ST: B2 = 7 if on a grossing chart, else 3-4. Web/itch: size = existing Performance. |
| Hook and core loop | 20 | 50% hook clarity + retry urge (judgement), 50% input simplicity (below). |
| Monetisation fit | 10 | Judgement: 1 interstitials only, 5 rewarded + no-ads, 8 fail offers/boosters/lives, 10 continue-beats-restart + pass. |
| Theme and live-ops | 10 | The existing Theme potential score and its theme note (`theme`, `themeNote` in rows.json). |
| Feasibility and twist | 10 | Judgement: build scope for a small team plus a clear twist over the top comparables. |
| Mashup compatibility | 10 (only if 2+ mechanics) | 5 checks x 0-2: clear core + support; SAME input gesture (tap mechanic + a separate swipe mechanic = 0; tap + drag-to-merge counts as one gesture family = 2, never an automatic fail); same audience; progress in one changes the other; combined hook reads in 3 s. Other weights x0.9. |

## Input simplicity (Anurag's rules)
| `input` code | Score | Rule |
|---|---|---|
| `tap_simple` | 10 | Tap only, simple gameplay |
| `tap_complex` | 7-8 (default 7.5) | Tap only, complex gameplay (timing, aiming, deduction) |
| `drag` / `swipe` | 7-8 (default 7.5) | Slide, swipe or drag only (drag = slide) |
| `tap_double` | 5-6 | Tap + double tap |
| `tap_double_optional` | 7 | Double tap optional or clearly taught |
| `drag_merge` | 7-8 (default 7.5) | Drag-to-merge, including merge games where you tap items/generators/buttons and drag to merge. Same level as plain drag. **No cap.** |
| `tap_swipe` | 2-3 | Genuinely distinct tap AND swipe gestures as competing core inputs (e.g. tap cubes + swipe to rotate the 3D view) -> **Overall capped at 5.0** |
| `multi` | 2-3 | 3+ distinct input types that are not just tap + drag-to-merge (riddle games mixing tap/drag/tilt, ASMR toy packs, mini-game bundles, joystick + tap action) -> **Overall capped at 5.0** |
Only core-gameplay inputs count; menu/booster taps do not.

**Drag-to-merge ruling (Anurag, 18 Nov 2026):** drag-to-merge is NOT a tap+swipe mix. Merge-2 and other merge games (tap generators or items, drag to merge) are `drag_merge`: 7-8 on input simplicity, no 5.0 cap. Good merge games succeed or fail on implementation, not on the input. Use `tap_swipe`/`multi` only when the player must switch between distinct competing gestures in the core loop.

Caps: input `tap_swipe`/`multi` -> 5.0 (never `drag`, `swipe` or `drag_merge`); mashup score <= 4 -> 6.0. The lower cap wins.

## Confidence and momentum source (stored per game)
- **high**: matched in the Sensor Tower growth export (`st_growth_puzzle.csv`, `st_growth_casual.csv`, UTF-16 TSV).
- **medium**: public store signals (rating growth, installs vs age, chart rank) or web plays/votes.
- **low**: judgement only (itch.io, or mobile with nothing but a chart rank).
Matching (`st_match.py`): normalised name (or name before ":"/" - ") plus publisher-token overlap; known parent-publisher links in `PUB_ALIAS` (Oakever->Learnings, Loyalty Gaming->Money Cash Apps, ABI->Onesoft, Sybo->Miniclip); otherwise an exact name with 30d downloads within 0.6-1.67x of the earlier ST figure. Hand links in `NAME_OVERRIDE`; blocked look-alikes in `NO_MATCH`.

## Scoring a NEW game (routine steps)
1. Add the game to `rows.json` as before (id, ids, name, cat, plat, dev, url(s), metrics, charts, released, mon, `perf` from the v1 Performance rules, `theme` + `themeNote`). Leave `overall` unset.
2. Add an entry to `judgements_v2.json` -> `games` keyed by the row id (edit the JSON directly; do not rerun the one-off `make_judgements_v2.py`, which would drop entries added later):
   ```json
   "and:com.example.game": {"name": "Example Sort", "archetype": "sort_tap", "why": "Tap-to-move sort with a pet skin; saturated sort wave"}
   ```
   Pick the closest `archetype` (see `judgements_v2.json` -> `archetypes`: input, hook, mon, feas, wave, saturated, depth, optional mashup). Override any field on the game entry when the game differs, e.g. `"input": "drag_merge"` (merge games) or `"input": "tap_swipe"` (only for truly distinct tap + swipe), `"hook": 6`, `"wave": 8, "saturated": false`, or
   `"mashup": {"mechanics": ["bus jam", "sand physics"], "checks": [2, 2, 2, 2, 2]}`. Keep `why` to one line naming the gesture and the key judgement.
3. Run `.venv/bin/python fetch_public.py` (new dated store snapshot; growth needs two snapshots 2+ days apart), then `python3 score_v2.py` (fails loudly if a game has no judgement entry). It rescores every game, keeps `overall_v1`, mirrors to `rated_games.json` and writes `v2_report.json`.
4. If new ST growth exports arrive, drop them in as `st_growth_puzzle.csv` / `st_growth_casual.csv` and rerun step 3.
5. Run `python3 export_shared.py` (refreshes `/workspace/shared/pintu_ratings.json` for Golu).
6. Update the Page (canvas 2539d180-cf7c-4d1b-82d6-ec0fe1564a04): add the game to its category with Overall, Momentum, Staying, Size, Hook (+input), Monetisation, Theme, Feasibility, Mashup, Confidence, theme note and reason; fix the game count. Never edit Game Explorer's Puzzle Pulse Page.
7. Tell Anurag: name, category, Overall and the top drivers (momentum source + confidence, input type, any cap).
