#!/usr/bin/env python3
"""Weekly Ideation Mood Board data builder.

Recomputes the three mood-board buckets from the latest bot outputs and writes
data/moodboard/moodboard.json (+ a dated copy). A weekly routine runs this, then
EditCanvas-replaces the `const DATA = {...}` block in the mood board Page
(or WriteCanvas the full page if the layout changes).

Inputs (real data only; missing fields are left out, never invented):
  /workspace/shared/pintu_ratings.json          Pintu v2 per-game scores, icons, links
  /workspace/game-analyzer/rated_games.json     rated_on (date Chotu's find was added), age_days, Sensor Tower metrics
  /workspace/game-analyzer/judgements_v2.json   archetype (mechanic family), wave, mashup mechanics
  /workspace/golu-studio/data/icons/<sha1(id)[:16]>.png   cached icons

Usage: python3 scripts/moodboard-data.py [--week-start YYYY-MM-DD] [--today YYYY-MM-DD]

Outputs (data/moodboard/):
  moodboard.json, moodboard-<week>.json   full bucket data
  page-data-line.txt                      the single `const DATA: MoodData = {...};` line for the Page
  icons-to-upload.json                    20 slot icons (n1-n7, u1-u7, g1-g6) -> local file paths

Weekly Page refresh (Page canvas_id a2684784-55e6-4368-859e-6862847b5b4c):
  1. Run this script.
  2. ReadCanvas the Page, copy its current `const DATA: MoodData = ...;` line (between // DATA:BEGIN and // DATA:END).
  3. EditCanvas: old_string = that line, new_string = contents of page-data-line.txt (one edit; layout untouched).
     The title/summary derive from DATA.weekStart, so they update too. Golu's PICK_WHY text is keyed by game id:
     if DATA.picks changes, add an edit for PICK_WHY (otherwise the card falls back to Pintu's one-line reason).
  4. WriteCanvasAsset each entry of icons-to-upload.json under the same slot name (overwrites; stays within the 20-image limit).
  Use WriteCanvas with the full source only if the layout changes.
"""
import argparse, collections, datetime as dt, hashlib, json, os, statistics, urllib.request

SHARED = "/workspace/shared/pintu_ratings.json"
RATED = "/workspace/game-analyzer/rated_games.json"
JUDGE = "/workspace/game-analyzer/judgements_v2.json"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "data", "icons")
OUT_DIR = os.path.join(ROOT, "data", "moodboard")

# Bucket rules (kept in one place so the Page and the script agree)
NEW_MAX_AGE = 90          # days since release (Pintu age_days)
NEW_MIN_OVERALL = 6.0     # ...and overall >= 6.0 and hook >= 7.0
NEW_MIN_HOOK = 7.0
UP_MIN_MOMENTUM = 7.0     # momentum pillar >= 7.0
UP_SIZE = (4.0, 8.0)      # mid-size: market-size pillar 4.0-8.0
# "Bigger games opening new genres" = innovative twists that are performing (Anurag, 18 Nov):
#   novelty  : Pintu marks the mechanic family's trend as not saturated and at stage >= NG_MIN_WAVE,
#              OR the game is a mashup scoring >= NG_MIN_MASHUP (2+ mechanics that fit)
#   perform  : momentum >= NG_MIN_MOMENTUM, OR >= 1M downloads with >= +20% growth in 30d,
#              OR >= 5M downloads in 30d, OR >= $5M store revenue in 30d (Sensor Tower)
#   hybrid-casual fit: not input-capped, Pintu score >= 6.0, hook >= 7.0, feasibility >= 5,
#              not an itch.io jam game, family not a classic-casual / mega-title family (NG_CASUAL)
#   variety  : one game per family; a family already featured in New / Up-and-coming only qualifies via a mashup twist
NG_MIN_WAVE = 6
NG_MIN_MASHUP = 8
NG_MIN_MOMENTUM = 6.5
NG_MIN_OVERALL = 6.0
NG_MIN_HOOK = 7.0
NG_MIN_FEAS = 5
# Match-3 exception (Anurag, 18 Nov): match-3 families are allowed, but only with a genuine twist; the genre's
# standard decorate/build meta does not count as a mashup twist (Gardenscapes-style stays out). Merge stays excluded.
NG_MATCH3 = {"match3_swipe", "match3_meta", "pvp_match3"}
NG_MATCH3_STANDARD_META = {"decorate/build meta"}
NG_CASUAL = {"merge2", "mahjong_tap", "classic_board", "social_casino",
             "farm_multi", "bubble_tap", "hidden_tap", "color_tap", "word_tap", "cash_skill", "licensed_kids",
             "adventure_multi", "idle_tap"}
PER_BUCKET = 7            # New and Up-and-coming
PER_BUCKET_NEW_GENRE = 6  # 7 + 7 + 6 = 20 icons = the Page's 20-image limit (slot-named, overwritten weekly)
MAX_PER_FAMILY_NEW_GENRE = 1   # keep the new-genre bucket spread across genres
RISING_MIN_MOMENTUM = 7.0      # "rising" set used for trending mechanics / themes

FAMILY = {  # archetype -> readable mechanic family for charts
    "sort_tap": "Sort", "jam_tap": "Jam", "loop_tap": "Loop / conveyor", "arrow_tap": "Arrow escape",
    "yarn_tap": "Yarn / rope", "screw_tap": "Screw", "pixel_tap": "Pixel fill", "blast_tap": "Blast",
    "tile_tap": "Tile match", "logic_tap": "Cosy logic", "word_tap": "Word", "rotate_tap": "Rotate",
    "riddle_multi": "Trick riddle", "block_drag": "Block puzzle", "slide_drag": "Block slide",
    "goods_drag": "Goods sort", "hex_drag": "Hexa sort", "sand_drag": "Sand physics", "hole_drag": "Hole",
    "io_drag": ".io", "runner_swipe": "Runner", "rhythm_tap": "Rhythm", "physics_tap": "Physics smash",
    "match3_swipe": "Match-3", "match3_meta": "Match-3 + meta", "merge2": "Merge-2", "mahjong_tap": "Mahjong",
    "classic_board": "Classic board", "hidden_tap": "Hidden object", "color_tap": "Colour by number",
    "bubble_tap": "Bubble shooter", "snake_swipe": "Snake fill", "asmr_multi": "ASMR toy",
    "minigame_multi": "Mini-game bundle", "idle_tap": "Idle", "cash_skill": "Cash skill",
    "social_casino": "Social casino", "drop_tap": "Plinko / drop", "flip_tap": "One-tap flip",
    "aim_drag": "Aim & shoot", "cube3d": "3D cube", "adventure_multi": "3D adventure",
    "licensed_kids": "Licensed kids", "farm_multi": "Farm / town", "pvp_match3": "PvP match-3",
    "itch_platformer": "Platformer (web)", "itch_grid": "Grid move (web)", "itch_logic": "Logic (web)",
    "itch_tap": "One-tap toy (web)", "itch_drag": "Drag puzzle (web)", "itch_story": "Story / sim (web)",
    "itch_merge": "Merge (web)",
}

def fmt_n(n):
    return f"{n/1e6:.1f}M" if n >= 1e6 else f"{round(n/1e3)}K" if n >= 1e3 else str(n)

def icon_key(gid):
    return hashlib.sha1(str(gid).encode()).hexdigest()[:16]

def expand(url):
    if not url: return None
    if url.startswith("~"):
        return "https://is1-ssl.mzstatic.com/image/thumb/" + url[1:]
    return url

def ensure_icon(g, download=True):
    k = icon_key(g["id"])
    for ext in ("png", "jpg", "webp", "gif"):
        p = os.path.join(ICON_DIR, f"{k}.{ext}")
        if os.path.exists(p): return p
    url = expand(g.get("icon_url"))
    if not url or not download: return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 GoluStudio/1.0", "Accept": "image/*"})
        data = urllib.request.urlopen(req, timeout=15).read()
        ct = "png" if data[:4] == b"\x89PNG" else "webp" if data[8:12] == b"WEBP" else "gif" if data[:3] == b"GIF" else "jpg"
        os.makedirs(ICON_DIR, exist_ok=True)
        p = os.path.join(ICON_DIR, f"{k}.{ct}")
        open(p, "wb").write(data)
        return p
    except Exception:
        return None

def clean(d):
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}

def write_page_literal(out):
    """Compact DATA literal for the Page: one line between // DATA:BEGIN and // DATA:END.
    A weekly run replaces that one line with EditCanvas (old_string = the current line from ReadCanvas)."""
    G = {g["id"]: g for g in out["games"]}
    featured = set(sum(out["buckets"].values(), []))
    bucket_of = {i: b for b, ids in out["buckets"].items() for i in ids}
    rows = []
    for g in sorted(out["games"], key=lambda g: -g.get("overall", 0)):
        # [name, platform, overall, momentum, size, hook, family, ratedOn(MM-DD), dl30, dlGrowth, bucket]
        rows.append([g["name"], g.get("platform"), g.get("overall"), g.get("momentum"), g.get("size"), g.get("hook"),
                     g.get("family"), (g.get("ratedOn") or "")[5:], g.get("dl30"), g.get("dlGrowth"),
                     {"new": "N", "up": "U", "newGenre": "G"}.get(bucket_of.get(g["id"]), "")])
    cards = {}
    for i in featured:
        g = G[i]
        cards[i] = clean({k: g.get(k) for k in ("name", "platform", "developer", "url", "overall", "momentum", "staying",
                    "size", "hook", "monetisation", "theme", "feasibility", "mashup", "input", "cap", "confidence", "why",
                    "themeIdeas", "ageDays", "ratedOn", "family", "familyWhy", "saturated", "mechanics", "dl30", "dlGrowth",
                    "rev30", "dau", "metrics", "unique", "perf")})
        if "why" in cards[i]: cards[i]["why"] = cards[i]["why"].split(" Capped:")[0]
        cards[i].pop("familyWhy", None)
        if g.get("cap"): cards[i]["cap"] = "Capped at 5.0 (3+ input types)" if "5.0" in g["cap"] else "Capped at 6.0 (weak mashup)"
        if g.get("saturated") is False: cards[i]["saturated"] = False
        if g.get("iconPath"):
            b = bucket_of[i]; slot = out["buckets"][b].index(i) + 1
            cards[i]["icon"] = {"new": "n", "up": "u", "newGenre": "g"}[b] + str(slot) + ".png"
    page = {"weekStart": out["week_start"], "generatedAt": out["generated_at"], "ratingsUpdatedAt": out["ratings_updated_at"],
            "stats": out["stats"], "rules": out["rules"], "buckets": out["buckets"], "picks": out["picks"],
            "trending": {k: v for k, v in out["trending"].items() if k != "genres"}, "cards": cards, "rows": rows}
    lit = "const DATA: MoodData = " + json.dumps(page, ensure_ascii=False, separators=(",", ":")) + ";"
    open(os.path.join(OUT_DIR, "page-data-line.txt"), "w").write(lit + "\n")
    icons = [{"name": c["icon"], "path": G[i]["iconPath"]} for i, c in cards.items() if c.get("icon")]
    json.dump(icons, open(os.path.join(OUT_DIR, "icons-to-upload.json"), "w"), indent=1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=dt.date.today().isoformat())
    ap.add_argument("--week-start")
    ap.add_argument("--no-icons", action="store_true")
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today)
    week_start = dt.date.fromisoformat(a.week_start) if a.week_start else today - dt.timedelta(days=today.weekday())

    shared = json.load(open(SHARED))
    rated = {g["id"]: g for g in json.load(open(RATED))["games"]}
    judge = json.load(open(JUDGE))
    arche, jg = judge["archetypes"], judge["games"]

    games = []
    for s in shared["games"]:
        r = rated.get(s["id"], {}); v2 = r.get("v2", {}); j = jg.get(s["id"], {})
        at = j.get("archetype"); A = arche.get(at, {})
        sc = s.get("scores", {})
        g = clean({
            "id": s["id"], "name": s["name"], "platform": s.get("platform"), "category": s.get("category"),
            "developer": s.get("developer"), "genres": [x for x in s.get("genres", []) if x not in ("Mobile", "2D", "3D")],
            "url": s.get("store_url"), "overall": s.get("overall_score"),
            "momentum": sc.get("momentum"), "staying": sc.get("staying"), "size": sc.get("size"), "hook": sc.get("hook"),
            "monetisation": sc.get("monetisation"), "theme": sc.get("theme"), "feasibility": sc.get("feasibility"),
            "mashup": sc.get("mashup"), "input": s.get("input_type"), "cap": s.get("cap_applied"),
            "confidence": s.get("confidence"), "why": s.get("reason"), "themeIdeas": s.get("theme_ideas"),
            "released": s.get("released"), "ageDays": v2.get("age_days"), "ratedOn": r.get("rated_on"),
            "twist": j.get("why"), "archetype": at, "family": FAMILY.get(at, at), "familyWhy": A.get("why"), "wave": j.get("wave", A.get("wave")),
            "saturated": A.get("saturated"), "mechanics": (j.get("mashup") or {}).get("mechanics") or s.get("mashup_mechanics"),
            "dl30": v2.get("st_dl_30d"), "dlGrowth": v2.get("st_dl_growth"), "rev30": v2.get("st_rev_30d"),
            "dau": v2.get("st_dau"), "dauGrowth": v2.get("st_dau_growth"),
            "metrics": s.get("key_metrics"), "charts": s.get("chart_ranks"), "monetization": s.get("monetization"),
            "momentumSource": s.get("momentum_source"),
        })
        if g.get("saturated") is False: g["saturated"] = False
        p = ensure_icon(s, download=not a.no_icons)  # --no-icons: use cached icons only
        if p: g["iconPath"] = p
        games.append(g)

    def new_ok(g):
        return g.get("ageDays") is not None and g["ageDays"] <= NEW_MAX_AGE and (
            g.get("overall", 0) >= NEW_MIN_OVERALL and g.get("hook", 0) >= NEW_MIN_HOOK)
    new = sorted([g for g in games if new_ok(g)], key=lambda g: (-g.get("overall", 0), -g.get("hook", 0)))[:PER_BUCKET]
    used = {g["id"] for g in new}
    up = sorted([g for g in games if g["id"] not in used and g.get("momentum", 0) >= UP_MIN_MOMENTUM
                 and UP_SIZE[0] <= g.get("size", 0) <= UP_SIZE[1]],
                key=lambda g: (-g.get("momentum", 0), -(g.get("dlGrowth") or 0), -g.get("overall", 0)))[:PER_BUCKET]
    used |= {g["id"] for g in up}
    def novel(g):
        open_trend = g.get("saturated") is False and (g.get("wave") or 0) >= NG_MIN_WAVE
        mashup = (g.get("mashup") or 0) >= NG_MIN_MASHUP
        if g.get("archetype") in NG_MATCH3:  # plain match-3 + its usual meta is not a twist
            mashup = mashup and not (set(g.get("mechanics") or []) & NG_MATCH3_STANDARD_META)
        return open_trend or mashup
    def perf(g):
        dl, gr, rev = g.get("dl30") or 0, g.get("dlGrowth"), g.get("rev30") or 0
        return (g.get("momentum", 0) >= NG_MIN_MOMENTUM or (dl >= 1_000_000 and gr is not None and gr >= 0.2)
                or dl >= 5_000_000 or rev >= 5_000_000)
    def hc_fit(g):
        return (not g.get("cap") and g.get("platform") != "itch.io" and g.get("archetype") not in NG_CASUAL
                and g.get("overall", 0) >= NG_MIN_OVERALL and g.get("hook", 0) >= NG_MIN_HOOK
                and (g.get("feasibility") or 0) >= NG_MIN_FEAS)
    featured_fams = {g.get("family") for g in new + up}
    ng_all = sorted([g for g in games if g["id"] not in used and (g.get("family") not in featured_fams or (g.get("mashup") or 0) >= NG_MIN_MASHUP)
                     and novel(g) and perf(g) and hc_fit(g)],
                    key=lambda g: (-g.get("overall", 0), -g.get("momentum", 0)))
    ng, fam = [], collections.Counter()
    for g in ng_all:
        if fam[g.get("family")] >= MAX_PER_FAMILY_NEW_GENRE: continue
        fam[g.get("family")] += 1; ng.append(g)
        if len(ng) == PER_BUCKET_NEW_GENRE: break
    for g in ng:  # data-grounded "What's unique" + performance proof
        u = []
        if g.get("twist"): u.append(g["twist"].rstrip(".") + ".")
        if (g.get("mashup") or 0) >= NG_MIN_MASHUP and g.get("mechanics"):
            u.append(f"Mashup of {' + '.join(g['mechanics'])} scores {g['mashup']:g}/10 on Pintu's fit check.")
        if g.get("saturated") is False and g.get("wave"):
            u.append(f"{g['family']} trend is still open (Pintu stage {g['wave']}/10).")
        g["unique"] = " ".join(u)
        pr = []
        if g.get("dl30"): pr.append(f"{fmt_n(g['dl30'])} downloads")
        if g.get("dlGrowth") is not None: pr.append(f"{'+' if g['dlGrowth'] >= 0 else ''}{round(g['dlGrowth']*100)}% vs prior 30 days")
        if (g.get("rev30") or 0) >= 100_000: pr.append(f"${fmt_n(g['rev30'])} store revenue")
        txt = ("Last 30 days (Sensor Tower): " + ", ".join(pr) + ". ") if pr else ""
        g["perf"] = txt + f"Momentum {g.get('momentum')}/10" + (f" at {g['ageDays']} days old." if g.get("ageDays") else ".")
    # Golu's prototype picks: rising (New/Up) games, family wave not saturated, best overall, one per family
    picks, pf = [], set()
    for g in sorted(new + up, key=lambda g: (-g.get("overall", 0), -g.get("momentum", 0))):
        if g.get("saturated") is False and g.get("family") not in pf:
            picks.append(g["id"]); pf.add(g.get("family"))
        if len(picks) == 3: break

    ov = [g["overall"] for g in games if "overall" in g]
    st = [g for g in games if g.get("dlGrowth") is not None]
    big_st = [g for g in st if (g.get("dl30") or 0) >= 500_000] or st
    top_mover = max(big_st, key=lambda g: g["dlGrowth"]) if big_st else None
    new_week = [g for g in games if g.get("ratedOn") and g["ratedOn"] >= week_start.isoformat()]
    rising = [g for g in games if g.get("momentum", 0) >= RISING_MIN_MOMENTUM]
    def agg(items, key):
        c = collections.Counter()
        for g in items:
            v = g.get(key)
            for x in (v if isinstance(v, list) else [v]):
                if x: c[x] += 1
        return c.most_common()
    out = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="minutes"),
        "week_start": week_start.isoformat(), "ratings_updated_at": shared.get("updated_at"),
        "rules": {"new_max_age": NEW_MAX_AGE, "new_min_overall": NEW_MIN_OVERALL, "new_min_hook": NEW_MIN_HOOK,
                  "up_min_momentum": UP_MIN_MOMENTUM, "up_size": UP_SIZE,
                  "ng_min_wave": NG_MIN_WAVE, "ng_min_mashup": NG_MIN_MASHUP, "ng_min_momentum": NG_MIN_MOMENTUM,
                  "ng_min_overall": NG_MIN_OVERALL, "ng_min_hook": NG_MIN_HOOK, "ng_min_feas": NG_MIN_FEAS,
                  "ng_casual": sorted(FAMILY.get(x, x) for x in NG_CASUAL)},
        "stats": {"tracked": len(games), "new_this_week": len(new_week), "avg_overall": round(statistics.mean(ov), 1),
                  "median_overall": round(statistics.median(ov), 1), "st_matched": len(st),
                  "confidence": dict(collections.Counter(g.get("confidence") for g in games)),
                  "added_by_day": dict(sorted(collections.Counter(g.get("ratedOn") for g in games).items())),
                  "top_mover": clean({"name": top_mover["name"], "dlGrowth": top_mover["dlGrowth"], "id": top_mover["id"]}) if top_mover else None},
        "buckets": {"new": [g["id"] for g in new], "up": [g["id"] for g in up], "newGenre": [g["id"] for g in ng]},
        "picks": picks,
        "trending": {"rising_count": len(rising),
                     "families": [[f, n, round(statistics.mean(g["momentum"] for g in rising if g.get("family") == f), 1),
                                   next((g.get("saturated") for g in rising if g.get("family") == f), None)]
                                  for f, n in agg(rising, "family")],
                     "inputs": agg(rising, "input"), "genres": agg(rising, "genres"), "mechanics": agg(rising, "mechanics"),
                     "themes": [[g["name"], g["themeIdeas"], g.get("theme")] for g in sorted(rising, key=lambda g: -g.get("momentum", 0)) if g.get("themeIdeas")][:12]},
        "games": games,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in ("moodboard.json", f"moodboard-{week_start.isoformat()}.json"):
        json.dump(out, open(os.path.join(OUT_DIR, name), "w"), indent=1, ensure_ascii=False)
    write_page_literal(out)
    print(f"tracked {len(games)} | new {len(new)} | up {len(up)} | newGenre {len(ng)} | new this week {len(new_week)}"
          f" | icons {sum(1 for g in games if g.get('iconPath'))} -> {OUT_DIR}/moodboard.json")

if __name__ == "__main__":
    main()
