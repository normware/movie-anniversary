# MovieAnniversary

A zero-dependency static site that shows movies celebrating a modulo-5 anniversary (5, 10, 15, 20… years) in the current ISO week. Built with vanilla Node.js and TMDB data.

**Live site: [movie-anniversary.normware.org](https://movie-anniversary.normware.org)**

## How it works

1. **`node scripts/fetch-data.js`** fetches the 500 most popular movies per year from TMDB (last 100 years), encrypts the data with AES-256-CBC, and saves it to `src/movies.enc.json`.
2. **`node scripts/build.js`** decrypts the cache, identifies movies whose release date falls in the current ISO week with a 5-year anniversary, and generates static HTML pages in `docs/`.
3. **GitHub Pages** serves `docs/` as the published site. The `index.html` automatically redirects to the current week via JavaScript.

The encrypted data is committed to the repo so the build can run anywhere (local or CI), but the decryption key stays in `.env` (or a GitHub secret).

## Quick start

```bash
cp .env.template .env
# Fill in TMDB_API_KEY and DATA_ENCRYPTION_KEY

npm run fetch-data   # ~10 minutes (2500 TMDB API calls)
npm run build        # generates docs/
```

## Manual movie additions

Add TMDB IDs to `src/movies-manual.json`:

```json
{
  "movies": [
    {"tmdb_id": 550, "note": "Fight Club"}
  ]
}
```

These IDs are resolved during `fetch-data` and merged into the encrypted cache. The manual file is plain JSON (public TMDB IDs only — no encryption needed).

## Site features

- Per-day grid: movies grouped by day of the week, sorted by TMDB popularity
- Each poster links to TMDB, IMDb, and Letterboxd
- Week navigation: previous / next week browsing
- All weeks index at `week/index.html`
- IMDb IDs fetched lazily only for anniversary movies
- "Today" button scrolls to the current day on the week page
- Filter bar: filter by rating, anniversary year range, or sort by popularity/rating
- Filter state is persisted in localStorage
- Footer links to GitHub, Datenschutz, and Impressum on every page

## Privacy & Legal

The site uses no cookies, trackers, or analytics. Filter preferences are stored in `localStorage` (client-side only). The TMDB API is called server-side during builds — no API calls are made from the browser.

Datenschutz and Impressum pages are linked from the footer. Create `/datenschutz/index.html` and `/impressum/index.html` in the `docs/` directory with your legal text.

## Stack

- Node.js (native `fetch`, `crypto`, `fs`, plus `node-fetch` for Node 16 compat)
- TMDB API (free tier, 40 req / 10s)
- AES-256-CBC data encryption
- GitHub Pages for hosting
- Cloudflare Workers (available for future cron-based refresh)

## License

MIT
