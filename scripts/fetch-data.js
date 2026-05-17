import fs from 'fs';
import path from 'path';
import { loadEnv, getEnv, encrypt, tmdbFetch, ROOT, REQUEST_DELAY_MS } from './shared.js';

const MIN_YEAR = 1926;
const MAX_YEAR = new Date().getFullYear();
const MOVIES_PER_YEAR = 500;
const PAGES_PER_YEAR = Math.ceil(MOVIES_PER_YEAR / 20);

const SRC_DIR = path.join(ROOT, 'src');
const ENC_FILE = path.join(SRC_DIR, 'movies.enc.json');
const MANUAL_FILE = path.join(SRC_DIR, 'movies-manual.json');

async function fetchYearMovies(year, signal) {
  const movies = [];
  let page = 1;
  let totalPages = Infinity;

  while (page <= Math.min(totalPages, PAGES_PER_YEAR) && movies.length < MOVIES_PER_YEAR) {
    if (signal?.aborted) throw new Error('Aborted');

    const data = await tmdbFetch('/discover/movie', {
      primary_release_year: year,
      sort_by: 'popularity.desc',
      'vote_count.gte': 10,
      include_adult: false,
      without_genres: '10769',
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

  console.log();
  return movies.slice(0, MOVIES_PER_YEAR);
}

async function fetchMovieDetails(tmdbId, signal) {
  if (signal?.aborted) throw new Error('Aborted');
  const data = await tmdbFetch(`/movie/${tmdbId}`, {});
  await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  return data;
}

function normalizeMovie(m) {
  return {
    id: m.id,
    title: m.title,
    release_date: m.release_date || '',
    popularity: m.popularity || 0,
    poster_path: m.poster_path || '',
    vote_average: m.vote_average || 0,
    imdb_id: m.imdb_id || '',
  };
}

async function main() {
  console.log('=== MovieAnniversary: Fetch Data ===\n');

  loadEnv();
  const encKey = getEnv('DATA_ENCRYPTION_KEY');

  if (!fs.existsSync(SRC_DIR)) fs.mkdirSync(SRC_DIR, { recursive: true });

  const manualMovies = [];
  if (fs.existsSync(MANUAL_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
    manualMovies.push(...raw.movies.map(m => m.tmdb_id));
    console.log(`  [INFO] Loaded ${manualMovies.length} manual TMDB IDs from movies-manual.json\n`);
  }

  const allMovies = [];
  const uniqueIds = new Set();

  for (let year = MIN_YEAR; year <= MAX_YEAR; year++) {
    const movies = await fetchYearMovies(year);
    for (const m of movies) {
      if (!uniqueIds.has(m.id)) {
        uniqueIds.add(m.id);
        allMovies.push(normalizeMovie(m));
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n  [DONE] Fetched ${allMovies.length} unique movies across ${MAX_YEAR - MIN_YEAR + 1} years\n`);

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

main().catch(err => {
  console.error('\n  [FATAL]', err.message);
  process.exit(1);
});
