# Deploy Golu Studio online (Render)

This puts the **full working app** on a public `https://….onrender.com` link. Mockups, new ideas and Create H5 still run through your Cursor plan. Your existing `http://localhost:5173` copy is unchanged and can stay running.

The link is public, so set an **APP_PASSWORD**. Anyone who can open the site can use your Cursor credits.

## 1. Get a Cursor API key

Hosted Golu cannot open a browser login. It authenticates the Cursor CLI with `CURSOR_API_KEY`.

1. Open [https://cursor.com/dashboard/api](https://cursor.com/dashboard/api) (Cursor Dashboard → **API Keys**).
2. Create a new user API key. Name it something like `Golu Studio`.
3. Copy the secret immediately — it is shown only once.

Official Cursor CLI docs: set `CURSOR_API_KEY`, or pass `--api-key`. See [Authentication](https://cursor.com/docs/cli/reference/authentication) and [Headless CLI](https://cursor.com/docs/cli/headless).

## 2. Put the project on GitHub

Render deploys from a Git repo. A private repo is fine.

### Option A — GitHub website (no git commands)

1. Sign in at [https://github.com](https://github.com) and click **New repository**.
2. Name it `golu-studio`. You can leave it **Private**. Do not add a README (the project already has one). Create the repository.
3. On the empty repo page, click **uploading an existing file**.
4. Drag every file and folder from the `golu-studio` folder into the page (including `Dockerfile`, `render.yaml`, `package.json`, `server.js`, `lib`, `public`, `data`). Do **not** upload `node_modules` or a `.env` file.
5. Click **Commit changes**.

### Option B — git commands

```bash
cd golu-studio
git init
git add .
git commit -m "Golu Studio"
# Create an empty GitHub repo first, then:
git branch -M main
git remote add origin https://github.com/YOUR_USER/golu-studio.git
git push -u origin main
```

Replace `YOUR_USER` with your GitHub username.

## 3. Create the Render service

1. Sign up or log in at [https://dashboard.render.com](https://dashboard.render.com). Connect your GitHub account when asked.
2. Click **New** → **Blueprint** and select the `golu-studio` repo (this reads `render.yaml`).
   - Or: **New** → **Web Service**, pick the same repo, set Language / Runtime to **Docker**, instance type **Free**.
3. When prompted for environment variables, paste:

   | Variable | Value |
   | --- | --- |
   | `CURSOR_API_KEY` | the key from step 1 |
   | `APP_PASSWORD` | a password you will share with teammates |

   Leave the username as `golu` (the app default). To use a different username, add `APP_USER` in Render’s Environment tab.
4. Create / apply the Blueprint and wait for the first deploy (several minutes: it installs Node, Chromium and the Cursor CLI).
5. When the service is Live, Render shows a URL like `https://golu-studio.onrender.com`. Open it, sign in with username `golu` and your `APP_PASSWORD`, and use the app as usual.

You do **not** need to set `PORT`, `HOST`, `AI_PROVIDER`, `CHROME_PATH` or `NO_OPEN` — the Dockerfile already sets them. Render supplies `$PORT` at runtime.

## 4. What to expect on the free plan

These are the current Render free-tier rules ([Render free-tier docs](https://render.com/docs/free)):

- The service **sleeps after 15 minutes** with no traffic. The next visit takes **about one minute** to wake (Render shows a loading page).
- You get **750 free instance hours** per workspace per calendar month. Hours only count while the service is awake. If you run out, free services pause until the next month.
- The disk is **temporary**. Files written by the app (new mockups, GIFs, H5 games) are **lost when the service sleeps, restarts, or is redeployed**. Free services cannot attach a persistent disk. Download any H5 game you want to keep (the in-app .zip button).
- A free instance is 0.1 CPU and 512 MB RAM. A heavy Create H5 run can be tight. If builds fail with out-of-memory errors, switch the service to a paid plan.

## 5. Updating later

Change files, push to GitHub, and Render redeploys automatically. To refresh Pintu’s ratings, replace `data/pintu_ratings.json` (or run `npm run update-data -- /path/to/pintu_ratings.json` first) and push. Remember: a redeploy wipes generated games on the server.

To change the API key or site password: Render Dashboard → your service → **Environment**.
