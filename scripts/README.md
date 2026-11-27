# Scripts

## Refreshing Pintu's ratings (`data/pintu_ratings.json`)

The server re-reads `data/pintu_ratings.json` on **every request**, so you can swap the file while the app is running and just refresh the browser. Games are keyed by `id`, so idea history and cached themes survive a refresh.

Pintu (the rating agent) keeps the latest copy at `/workspace/shared/pintu_ratings.json` on the Grok Bot box, and re-checks Chotu's page around 10 AM and 6 PM IST. To update:

1. Get a fresh `pintu_ratings.json` (ask Golu/Pintu to send it, or download it).
2. Run one of:
   - `npm run update-data -- ~/Downloads/pintu_ratings.json`  (validates it, keeps a `.prev.json` backup, downloads new icons)
   - or simply copy it over `data/pintu_ratings.json` and run `npm run icons` to cache new icons.

The server also auto-syncs from the shared Google Sheet **Golu Studio - Pintu Ratings Sync** on start and every 30 minutes (`lib/sync-ratings.js`). If the sheet is unreachable, it keeps the local file. See `scripts/push-ratings-to-sheet.md` for how to refresh the sheet from `/workspace/shared/pintu_ratings.json`. You can override the URL with `RATINGS_SHEET_URL`, or set it to `off` to disable sync.

You can also point the server at another file with `RATINGS_FILE=/path/to/file.json npm start`.

## Other scripts

| Script | What it does |
| --- | --- |
| `npm run icons` | Downloads any missing game icons into `data/icons/` (also runs in the background on server start). Missing icons fall back to the remote URL. |
| `npm run mock` | Starts the app in offline demo mode (no API key; mock themes/mockups and a built-in playable template game). |
| `node scripts/e2e-screenshots.js [--mock]` | With the server running (`BASE=http://localhost:5173`), drives the whole flow in headless Chrome and saves screenshots to `screenshots/`. |

## Weekly Ideation Mood Board
`python3 scripts/moodboard-data.py` rebuilds the mood board buckets (New / Up-and-coming / New genre) from
Pintu's v2 ratings + Chotu's finds into `data/moodboard/`. See the script header for the weekly Page refresh steps
(EditCanvas the one DATA line, re-upload the 20 slot icons).
