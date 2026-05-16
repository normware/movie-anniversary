/**
 * Fetch movie data from TMDB API
 *
 * Scrapes the top 500 most popular movies per year for the last 100 years,
 * merges in any manually specified movies, and writes the result as an
 * encrypted JSON file (src/movies.enc.json) so the raw data cannot easily
 * be re-hosted.
 *
 * Usage:  node scripts/fetch-data.js
 * Env:    TMDB_API_KEY, DATA_ENCRYPTION_KEY (see .env.template)
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const MIN_YEAR = 1926;
const MAX_YEAR = new Date().getFullYear();             // dynamic: current year
const MOVIES_PER_YEAR = 500;                           // top 500 per year
const PAGES_PER_YEAR = Math.ceil(MOVIES_PER_YEAR / 20);
const REQUEST_DELAY_MS = 280;                          // ~3.5 req/s, safe for free tier
const ALGORITHM = 'aes-256-cbc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const ENC_FILE = path.join(SRC_DIR, 'movies.enc.json');
const MANUAL_FILE = path.join(SRC_DIR, 'movies-manual.json');

/* ------------------------------------------------------------------ */
/*  Load environment                                                  */
/* ------------------------------------------------------------------ */

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('  [ERR]  No .env file found. Copy .env.template to .env and fill in your keys.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = val;
  }
}

function getEnv(name) {
  const val = process.env[name];
  if (!val || val.startsWith('your_')) {
    console.error(`  [ERR]  ${name} is not set in .env`);
    process.exit(1);
  }
  return val;
}

/* ------------------------------------------------------------------ */
/*  Encryption helpers                                                */
/* ------------------------------------------------------------------ */

function deriveKey(passphrase) {
  return crypto.scryptSync(passphrase, 'movie-anniversary-salt', 32);
}

function encrypt(data, passphrase) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

/* ------------------------------------------------------------------ */
/*  TMDB helpers                                                      */
/* ------------------------------------------------------------------ */

async function tmdbFetch(pathname, params = {}) {
  const token = getEnv('TMDB_TOKEN');
  const url = new URL(`${TMDB_BASE}${pathname}`);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${res.status} for ${pathname}: ${text}`);
  }
  return res.json();
}

async function fetchYearMovies(year, signal) {
  const movies = [];
  let page = 1;
  let totalPages = Infinity;

  while (page <= Math.min(totalPages, PAGES_PER_YEAR) && movies.length < MOVIES_PER_YEAR) {
    if (signal?.aborted) throw new Error('Aborted');

    const data = await tmdbFetch('/discover/movie', {
      primary_release_year: year,
      sort_by: 'popularity.desc',
      'vote_count.gte': 10,            // skip ultra-obscure entries
      page,
    });

    totalPages = data.total_pages;
    movies.push(...data.results);

    const pct = Math.min(100, Math.round((movies.length / MOVIES_PER_YEAR) * 100));
    process.stdout.write(`\r  Year ${year}: ${movies.length} movies (page ${page}/${Math.min(totalPages, PAGES_PER_YEAR)}) [${pct}%]`);

    if (page >= Math.min(totalPages, PAGES_PER_YEAR)) break;
    page++;
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log(); // newline after progress
  return movies.slice(0, MOVIES_PER_YEAR);
}

async function fetchMovieDetails(tmdbId, signal) {
  if (signal?.aborted) throw new Error('Aborted');
  const data = await tmdbFetch(`/movie/${tmdbId}`, {});
  await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  return data;
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('=== MovieAnniversary: Fetch Data ===\n');

  loadEnv();
  const encKey = getEnv('DATA_ENCRYPTION_KEY');

  // Ensure src/ exists
  if (!fs.existsSync(SRC_DIR)) fs.mkdirSync(SRC_DIR, { recursive: true });

  // 1. Load manual additions --------------------------------------------------
  const manualMovies = [];
  if (fs.existsSync(MANUAL_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
    manualMovies.push(...raw.movies.map(m => m.tmdb_id));
    console.log(`  [INFO] Loaded ${manualMovies.length} manual TMDB IDs from movies-manual.json\n`);
  }

  // 2. Fetch movies per year --------------------------------------------------
  const allMovies = [];           // Map<tmdb_id, movie>
  const uniqueIds = new Set();

  for (let year = MIN_YEAR; year <= MAX_YEAR; year++) {
    const movies = await fetchYearMovies(year);
    for (const m of movies) {
      if (!uniqueIds.has(m.id)) {
        uniqueIds.add(m.id);
        allMovies.push(normalizeMovie(m));
      }
    }
    // Small extra pause between years
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n  [DONE] Fetched ${allMovies.length} unique movies across ${MAX_YEAR - MIN_YEAR + 1} years\n`);

  // 3. Resolve manual movies that might be missing ---------------------------
  const existingIds = new Set(allMovies.map(m => m.id));
  const missingManual = manualMovies.filter(id => !existingIds.has(id));

  if (missingManual.length > 0) {
    console.log(`  [INFO] Resolving ${missingManual.length} manual movies not in fetched data...\n`);
    for (const id of missingManual) {
      try {
        const detail = await fetchMovieDetails(id);
        allMovies.push(normalizeMovie(detail));
        console.log(`    + Resolved TMDB ${id}: ${detail.title}`);
      } catch (err) {
        console.error(`    - Failed to resolve TMDB ${id}: ${err.message}`);
      }
    }
    console.log();
  }

  // 4. Build output object and encrypt ----------------------------------------
  const payload = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    movieCount: allMovies.length,
    years: `${MIN_YEAR}–${MAX_YEAR}`,
    movies: allMovies,
  };

  const encrypted = encrypt(payload, encKey);
  fs.writeFileSync(ENC_FILE, encrypted, 'utf8');
  console.log(`  [OK]   Encrypted data written to ${path.relative(ROOT, ENC_FILE)}`);
  console.log(`  [INFO] ${allMovies.length} movies stored\n`);
}

/* ------------------------------------------------------------------ */
/*  Normalise a TMDB movie object to our slim format                  */
/* ------------------------------------------------------------------ */

function normalizeMovie(m) {
  return {
    id: m.id,
    title: m.title,
    release_date: m.release_date || '',
    popularity: m.popularity || 0,
    poster_path: m.poster_path || '',
    vote_average: m.vote_average || 0,
    imdb_id: m.imdb_id || '',       // may be filled later by build script
  };
}

main().catch(err => {
  console.error('\n  [FATAL]', err.message);
  process.exit(1);
});
