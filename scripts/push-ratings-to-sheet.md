# Push Pintu ratings to the shared Google Sheet

This is the refresh procedure a routine (or a future agent) should follow after Pintu updates `/workspace/shared/pintu_ratings.json` (around 10 AM and 6 PM IST). It is idempotent: **clear the tabs, then rewrite them**. Do not share the sheet with anyone by email and do not change sharing.

## Sheet

- Title: `Golu Studio - Pintu Ratings Sync`
- Spreadsheet ID: `1jToJ8Jt5pfbEwCM_rJBu2e60o6HUOdyEiTweK1T9sAY`
- URL: https://docs.google.com/spreadsheets/d/1jToJ8Jt5pfbEwCM_rJBu2e60o6HUOdyEiTweK1T9sAY/edit
- Tabs:
  - `games` (gid / sheetId `120944992`) — columns `id`, `json` (one row per game; `json` is that game's full JSON object)
  - `meta` (gid / sheetId `1093157980`) — columns `key`, `value` (`updated_at`, `rating_scale`, `categories`, `page_url`, `count`)
- CSV URLs the app fetches (need "Anyone with the link → Viewer"):
  - Games: https://docs.google.com/spreadsheets/d/1jToJ8Jt5pfbEwCM_rJBu2e60o6HUOdyEiTweK1T9sAY/export?format=csv&gid=120944992
  - Meta: https://docs.google.com/spreadsheets/d/1jToJ8Jt5pfbEwCM_rJBu2e60o6HUOdyEiTweK1T9sAY/export?format=csv&gid=1093157980

Use the **Google Sheets connector** (`user-Google-sheets`). Call `GetDynamicTools` first. Do not use Google Drive sharing tools, and do not invite anyone.

## Steps (clear and rewrite)

1. Read `/workspace/shared/pintu_ratings.json`. It must have a `games` array. Typical keys: `updated_at`, `rating_scale`, `categories`, `page_url`, `count`, `games`.
2. Build the values (compact JSON, no pretty-print):
   - `games` rows: header `["id","json"]`, then one `[game.id, JSON.stringify(game)]` per game. Use `JSON.stringify(game)` / `json.dumps(game, ensure_ascii=False, separators=(",",":"))`.
   - `meta` rows:

     ```
     ["key","value"]
     ["updated_at", <updated_at>]
     ["rating_scale", <rating_scale>]
     ["categories", JSON.stringify(categories)]
     ["page_url", <page_url>]
     ["count", String(games.length)]
     ```

   A generator you can run on the box:

   ```bash
   python3 - << 'PY'
   import json, os
   src = "/workspace/shared/pintu_ratings.json"
   out = "/tmp/pintu-sheet"
   os.makedirs(out, exist_ok=True)
   d = json.load(open(src))
   games = [["id","json"]] + [[g["id"], json.dumps(g, ensure_ascii=False, separators=(",",":"))] for g in d["games"]]
   meta = [
     ["key","value"],
     ["updated_at", d.get("updated_at") or ""],
     ["rating_scale", d.get("rating_scale") or ""],
     ["categories", json.dumps(d.get("categories") or [], ensure_ascii=False, separators=(",",":"))],
     ["page_url", d.get("page_url") or ""],
     ["count", str(len(d["games"]))],
   ]
   json.dump(meta, open(f"{out}/meta.json","w"), ensure_ascii=False, separators=(",",":"))
   BATCH = 40
   # first batch includes the header
   start = 1
   n = 0
   i = 0
   while i < len(games):
       chunk = games[i:i+BATCH]
       end = start + len(chunk) - 1
       path = f"{out}/games_{n:02d}.json"
       json.dump(chunk, open(path,"w"), ensure_ascii=False, separators=(",",":"))
       print(f"write games A{start}:B{end} from {path} ({len(chunk)} rows)")
       start = end + 1
       i += BATCH
       n += 1
   print(f"write meta A1:B6 from {out}/meta.json")
   print(f"games={len(d['games'])} updated_at={d.get('updated_at')}")
   PY
   ```

3. `clear_range` on spreadsheet `1jToJ8Jt5pfbEwCM_rJBu2e60o6HUOdyEiTweK1T9sAY`:
   - sheet `games`, cells `A:B`
   - sheet `meta`, cells `A:B`
   This drops leftover rows when the game count shrinks.
4. `write_range` with `parseInput: false` (required so JSON stays literal text, not a formula):
   - sheet `games`, in batches of about 40 rows, starting at `A1`, then `A41`, etc. Use the generator's printed ranges. In this environment you can pass `"values": "$file:/tmp/pintu-sheet/games_00.json"` (the file contents are substituted as a JSON array).
   - sheet `meta`, cells `A1:B6`, values from `meta.json`.
5. Do not reformat unless a tab was damaged. Header formatting and banding are already applied. Do not add email shares. Do not create a new spreadsheet.

## After a successful write

Local copies of Golu Studio (Anurag's and Jyoti's) pull the CSV on start and every 30 minutes. No new package is needed.

If a copy still shows old data, check that the sheet is still shared as **Anyone with the link → Viewer**, and that the app can reach the CSV URL (a 401/403 HTML login page means sharing is off).
