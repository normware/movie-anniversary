# AGENTS.md — MovieAnniversary

## Project Overview

A static site that shows which movies have a modulo-5 anniversary (5, 10, 15, 20… years) in the current ISO week. Built with vanilla Node.js, no frameworks.

## Architecture

```
.env.template         # Env var template (TMDB_API_KEY, DATA_ENCRYPTION_KEY)
scripts/
  fetch-data.js       # Fetches top-500 movies/year from TMDB, stores encrypted
  build.js            # Decrypts data, finds anniversaries, generates HTML
src/
  movies.enc.json     # Encrypted movie cache (AES-256-CBC)
  movies-manual.json  # Manual TMDB IDs to always include
  style.css           # Shared stylesheet
docs/                 # GitHub Pages root (committed)
  index.html          # JS redirect to current week
  style.css
  week/
    index.html        # Browse all weeks
    YYYY-Www.html     # Individual week pages
```

## Key Design Decisions

- **Data encryption**: Movie metadata is AES-256-CBC encrypted so the raw dataset cannot be easily re-hosted if the repo is cloned. The passphrase lives in `.env` (local) or GitHub secrets (CI).
- **Manual additions**: `movies-manual.json` is plain JSON (just TMDB IDs — public info). No encryption needed.
- **IMDb IDs** are backfilled lazily during `build.js` — only fetched for anniversary movies, then saved back into the encrypted cache.
- **Dependencies**: `node-fetch` (needed for Node 16; will be removed when we drop Node 16).

## Scripts

| Command | Description |
|---|---|
| `npm run fetch-data` | Fetch top 500 movies/year from TMDB and encrypt |
| `npm run build` | Build all week pages for ±1 year window |
| `npm run rebuild` | Fetch + build |
| `node scripts/build.js --week 2026-W20` | Build a single week |

## Environment Variables (.env)

```
TMDB_TOKEN=xxx         # API Read Access Token (v4) from TMDB
DATA_ENCRYPTION_KEY=   # 32+ chars for AES-256 encryption
```

## Weekly Update Workflow

1. `npm run fetch-data` — refresh movie data from TMDB (takes ~10 min, 2500 API calls)
2. `npm run build` — regenerate week pages
3. Commit + push `docs/` and `src/movies.enc.json`

For a quick refresh without re-fetching all data:
- Just run `npm run build` — it reuses the encrypted cache and only fetches missing IMDb IDs.

## GitHub Pages

The `docs/` folder is the publishing source. Configure in repo Settings > Pages > Source: "Deploy from branch" > `main` / `/docs`.

## Future: Cloudflare Workers

If the data refresh becomes too heavy for local builds, the scripts can be wrapped in a Cloudflare Worker cron trigger (free tier). The Worker would:
1. Call TMDB API (need to proxy through a CORS-friendly endpoint)
2. Encrypt and write updated data
3. Regenerate static pages

## Conventions

- All code in English
- JSDoc comments on public functions
- No frameworks — vanilla Node.js + CSS
