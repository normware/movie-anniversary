/**
 * Build the static anniversary website
 *
 * Reads the encrypted movie cache (src/movies.enc.json), identifies every
 * movie whose anniversary date (month+day) falls inside the target ISO week
 * where (currentYear − releaseYear) is a positive multiple of 5, and
 * generates static HTML pages under docs/.
 *
 * Usage:
 *   node scripts/build.js                          # full range (±1 year)
 *   node scripts/build.js --week 2026-W20          # single week only
 *
 * Env:  TMDB_API_KEY, DATA_ENCRYPTION_KEY (see .env.template)
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
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w342';
const REQUEST_DELAY_MS = 280;
const ALGORITHM = 'aes-256-cbc';
const RANGE_SPAN_YEARS = 1;          // build weeks ±N years from today

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DOCS_DIR = path.join(ROOT, 'docs');
const WEEK_DIR = path.join(DOCS_DIR, 'week');
const ENC_FILE = path.join(SRC_DIR, 'movies.enc.json');
const CSS_FILE = path.join(SRC_DIR, 'style.css');
const CSS_OUT = path.join(DOCS_DIR, 'style.css');

/* ------------------------------------------------------------------ */
/*  Environment                                                       */
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
    process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
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
/*  Crypto                                                            */
/* ------------------------------------------------------------------ */

function deriveKey(passphrase) {
  return crypto.scryptSync(passphrase, 'movie-anniversary-salt', 32);
}

function decrypt(data, passphrase) {
  const key = deriveKey(passphrase);
  const parts = data.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const enc = parts.join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return JSON.parse(dec);
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
/*  ISO week helpers                                                  */
/* ------------------------------------------------------------------ */

function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dayNum = (d.getDay() + 6) % 7;       // Monday=0
  d.setDate(d.getDate() - dayNum + 3);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
  return { year: d.getFullYear(), week: weekNum };
}

function mondayOfISOWeek(year, week) {
  const jan4 = new Date(year, 0, 4);
  const dayOffset = (jan4.getDay() + 6) % 7;  // Monday=0
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dayOffset);
  const target = new Date(week1Monday);
  target.setDate(week1Monday.getDate() + (week - 1) * 7);
  target.setHours(0, 0, 0, 0);
  return target;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDayHeader(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isoWeekLabel(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Anniversary logic                                                 */
/* ------------------------------------------------------------------ */

function isAnniversaryOnDate(movie, date) {
  if (!movie.release_date) return null;
  const parts = movie.release_date.split('-');
  if (parts.length !== 3) return null;
  const [releaseYear, releaseMonth, releaseDay] = parts.map(Number);

  const dateYear = date.getFullYear();
  const dateMonth = date.getMonth();       // 0-indexed
  const dateDay = date.getDate();

  let match = false;
  if (releaseMonth === 2 && releaseDay === 29) {
    // Feb 29 → check Feb 28 in non-leap years
    const isLeap = (dateYear % 4 === 0 && dateYear % 100 !== 0) || (dateYear % 400 === 0);
    if (!isLeap) {
      match = dateMonth === 1 && dateDay === 28;
    } else {
      match = dateMonth === 1 && dateDay === 29;
    }
  } else {
    match = dateMonth === releaseMonth - 1 && dateDay === releaseDay;
  }

  if (match) {
    const diff = dateYear - releaseYear;
    if (diff > 0 && diff % 5 === 0) return diff;
  }
  return null;
}

function getAnniversaryMovies(movies, weekMonday) {
  const dayMap = []; // array of 7 arrays

  for (let d = 0; d < 7; d++) {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + d);
    dayMap[d] = [];

    for (const movie of movies) {
      const years = isAnniversaryOnDate(movie, date);
      if (years) {
        dayMap[d].push({ movie, years });
      }
    }

    // Sort by popularity descending
    dayMap[d].sort((a, b) => b.movie.popularity - a.movie.popularity);
  }

  return dayMap;
}

/* ------------------------------------------------------------------ */
/*  TMDB helpers for IMDb ID backfill                                 */
/* ------------------------------------------------------------------ */

async function tmdbFetch(pathname, params = {}) {
  const token = getEnv('TMDB_TOKEN');
  const url = new URL(`${TMDB_BASE}${pathname}`);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${pathname}`);
  return res.json();
}

async function backfillImdbIds(movies, signal) {
  const needingIds = movies.filter(m => !m.imdb_id);
  if (needingIds.length === 0) return false;

  console.log(`  [INFO] Fetching IMDb IDs for ${needingIds.length} movies...`);
  let updated = false;

  for (const movie of needingIds) {
    if (signal?.aborted) throw new Error('Aborted');
    try {
      const data = await tmdbFetch(`/movie/${movie.id}/external_ids`);
      if (data.imdb_id) {
        movie.imdb_id = data.imdb_id;
        updated = true;
      }
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    } catch (err) {
      console.error(`    - Failed IMDb ID for TMDB ${movie.id}: ${err.message}`);
    }
  }

  return updated;
}

/* ------------------------------------------------------------------ */
/*  HTML generation                                                   */
/* ------------------------------------------------------------------ */

function posterUrl(posterPath) {
  if (!posterPath) return '';
  return `${IMAGE_BASE}/${POSTER_SIZE}${posterPath}`;
}

function movieCardHtml(entry, dateStr) {
  const { movie, years } = entry;
  const poster = posterUrl(movie.poster_path);
  const imgTag = poster
    ? `<img src="${poster}" alt="${escapeHtml(movie.title)}" loading="lazy">`
    : `<div class="poster-placeholder">${escapeHtml(movie.title)}</div>`;

  const tmdbUrl = `https://www.themoviedb.org/movie/${movie.id}`;
  const imdbUrl = movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}` : null;
  const lboxdUrl = `https://letterboxd.com/tmdb/${movie.id}/`;

  let linksHtml = `<a href="${tmdbUrl}" target="_blank" rel="noopener">TMDB</a>`;
  if (imdbUrl) {
    linksHtml += `<a href="${imdbUrl}" target="_blank" rel="noopener">IMDb</a>`;
  }
  linksHtml += `<a href="${lboxdUrl}" target="_blank" rel="noopener">Letterboxd</a>`;

  const year = movie.release_date ? movie.release_date.split('-')[0] : '?';
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '—';

  return `
        <div class="movie-card" data-rating="${rating}" data-popularity="${movie.popularity.toFixed(1)}" data-year="${year}" data-anniversary="${years}" data-date="${dateStr}" data-title="${escapeHtml(movie.title)}" data-tmdb="${movie.id}">
          ${imgTag}
          <div class="info">
            <div class="title">${escapeHtml(movie.title)}</div>
            <div class="meta">${year} &#9733; ${rating}</div>
            <div class="anniversary">${years} years</div>
            <div class="links">${linksHtml}</div>
          </div>
        </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateWeekPage(weekYear, weekNum, dayMap, weekMonday, weekSunday, hasPrev, hasNext, prevLink, nextLink) {
  const label = isoWeekLabel(weekYear, weekNum);
  const dateRange = `${formatDate(weekMonday)} – ${formatDate(weekSunday)}`;

  let prevHtml = hasPrev
    ? `<a href="${prevLink}">&larr; ${prevLink.replace('.html', '')}</a>`
    : '<span class="disabled">&larr; Previous</span>';

  let nextHtml = hasNext
    ? `<a href="${nextLink}">${nextLink.replace('.html', '')} &rarr;</a>`
    : '<span class="disabled">Next &rarr;</span>';

  // Collect unique anniversary values and year range for filter bar
  const anniSet = new Set();
  const yearSet = new Set();
  for (const day of dayMap) {
    for (const entry of day) {
      anniSet.add(entry.years);
      const y = entry.movie.release_date ? entry.movie.release_date.split('-')[0] : null;
      if (y) yearSet.add(parseInt(y));
    }
  }
  const anniversaryValues = [...anniSet].sort((a, b) => a - b);
  const years = [...yearSet].sort((a, b) => a - b);
  const minYear = years[0] || 0;
  const maxYear = years[years.length - 1] || 0;

  // Generate anniversary filter checkboxes
  const anniFilterHtml = anniversaryValues.map(v =>
    `<label class="filter-chk"><input type="checkbox" class="anni-cb" value="${v}" checked>${v}y</label>`
  ).join('');

  const daySections = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + d);
    const dateStr = formatDateISO(date);
    const dayEntries = dayMap[d];

    if (dayEntries.length === 0) {
      daySections.push(`
      <section class="day-section" id="${dateStr}">
        <h2>${formatDayHeader(date)}</h2>
        <p class="empty-day">No movie anniversaries today.</p>
      </section>`);
    } else {
      const cards = dayEntries.map(e => movieCardHtml(e, dateStr)).join('\n');
      daySections.push(`
      <section class="day-section" id="${dateStr}">
        <h2>${formatDayHeader(date)}</h2>
        <div class="movie-grid">${cards}
        </div>
      </section>`);
    }
  }

  // Escape values for inline JS
  const anniJson = JSON.stringify(anniversaryValues);

  const filterHtml = `\
    <div class="filter-bar">
      <div class="filter-group">
        <label class="filter-label">Rating</label>
        <select id="rating-filter" title="Filter by TMDB vote average">
          <option value="0">All</option>
          <option value="7">7+</option>
          <option value="8">8+</option>
          <option value="9">9+</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Anniversary</label>
        <div class="filter-chks">${anniFilterHtml}</div>
        <button class="anni-all-btn" data-action="all">All</button>
        <button class="anni-all-btn" data-action="none">None</button>
      </div>
      <div class="filter-group">
        <label class="filter-label">Year</label>
        <input type="number" id="year-min" class="year-input" placeholder="${minYear}" min="${minYear}" max="${maxYear}">
        <span class="year-sep">–</span>
        <input type="number" id="year-max" class="year-input" placeholder="${maxYear}" min="${minYear}" max="${maxYear}">
      </div>
      <div class="filter-group filter-group-btn">
        <button id="reset-filters" title="Reset all filters">&#8635; Reset</button>
      </div>
      <div class="filter-group">
        <label class="filter-label">Sort</label>
        <select id="sort-select" title="Sort by TMDB popularity or vote average">
          <option value="popularity">Popularity</option>
          <option value="rating">Rating</option>
        </select>
      </div>
    </div>
    <p id="filter-count" class="filter-count"></p>`;

  const filterScript = `
  <script>
(function(){
  var STORAGE_KEY = 'movie-anni-filters';
  var PAGE_LABEL = '${label}';
  var cards = document.querySelectorAll('.movie-card');
  var sections = document.querySelectorAll('.day-section');
  var countEl = document.getElementById('filter-count');

  function getISOWeek(d){
    var t = new Date(d);
    t.setHours(0,0,0,0);
    var day = (t.getDay() + 6) % 7;
    t.setDate(t.getDate() - day + 3);
    var jan4 = new Date(t.getFullYear(), 0, 4);
    var week = 1 + Math.round(((t - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
    return t.getFullYear() + '-W' + String(week).padStart(2, '0');
  }

  // Add week as query parameter to URL
  var u = new URL(location);
  u.searchParams.set('week', PAGE_LABEL);
  history.replaceState(null, '', u);

  document.getElementById('today-btn').addEventListener('click', function(){
    location.href = '../today/index.html';
  });

  function saveState(){
    var state = {
      rating: document.getElementById('rating-filter').value,
      anni: Array.from(document.querySelectorAll('.anni-cb')).map(function(cb){ return cb.checked; }),
      yearMin: document.getElementById('year-min').value,
      yearMax: document.getElementById('year-max').value,
      sort: document.getElementById('sort-select').value
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){}
  }

  function loadState(){
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch(e){}
    if(!raw) return;
    var state;
    try { state = JSON.parse(raw); } catch(e){ return; }
    if(!state) return;
    if(state.rating) document.getElementById('rating-filter').value = state.rating;
    if(state.anni) document.querySelectorAll('.anni-cb').forEach(function(cb,i){
      if(state.anni[i] !== undefined) cb.checked = state.anni[i];
    });
    if(state.yearMin !== undefined) document.getElementById('year-min').value = state.yearMin;
    if(state.yearMax !== undefined) document.getElementById('year-max').value = state.yearMax;
    if(state.sort) document.getElementById('sort-select').value = state.sort;
  }

  function applyFilters(){
    var ratingVal = parseFloat(document.getElementById('rating-filter').value) || 0;
    var anniCbs = document.querySelectorAll('.anni-cb:checked');
    var anniVals = Array.from(anniCbs).map(function(cb){ return parseInt(cb.value); });
    var yearMin = parseInt(document.getElementById('year-min').value) || 0;
    var yearMax = parseInt(document.getElementById('year-max').value) || 9999;
    var sortBy = document.getElementById('sort-select').value;
    var visible = 0;

    cards.forEach(function(card){
      var r = parseFloat(card.getAttribute('data-rating')) || 0;
      var y = parseInt(card.getAttribute('data-year')) || 0;
      var a = parseInt(card.getAttribute('data-anniversary')) || 0;
      var show = r >= ratingVal;
      if(show && anniVals.length) show = anniVals.indexOf(a) !== -1;
      if(show) show = y >= yearMin && y <= yearMax;
      card.style.display = show ? '' : 'none';
      if(show) visible++;
    });

    sections.forEach(function(s){
      var vis = Array.from(s.querySelectorAll('.movie-card')).some(function(c){ return c.style.display !== 'none'; });
      s.style.display = vis ? '' : 'none';
    });

    sections.forEach(function(s){
      var grid = s.querySelector('.movie-grid');
      if(!grid) return;
      var sorted = Array.from(grid.querySelectorAll('.movie-card')).sort(function(a,b){
        var av = parseFloat(a.getAttribute('data-'+sortBy)) || 0;
        var bv = parseFloat(b.getAttribute('data-'+sortBy)) || 0;
        return bv - av;
      });
      sorted.forEach(function(el){ grid.appendChild(el); });
    });

    if(countEl) countEl.textContent = visible + ' movie' + (visible!==1?'s':'') + ' shown';
    saveState();
  }

  loadState();
  document.getElementById('rating-filter').addEventListener('change', applyFilters);
  document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.addEventListener('change', applyFilters); });
  document.querySelectorAll('.anni-all-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var checked = btn.getAttribute('data-action') === 'all';
      document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.checked = checked; });
      applyFilters();
    });
  });
  document.getElementById('year-min').addEventListener('input', applyFilters);
  document.getElementById('year-max').addEventListener('input', applyFilters);
  document.getElementById('sort-select').addEventListener('change', applyFilters);
  document.getElementById('reset-filters').addEventListener('click', function(){
    document.getElementById('rating-filter').value = '0';
    document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.checked = true; });
    document.getElementById('year-min').value = '';
    document.getElementById('year-max').value = '';
    document.getElementById('sort-select').value = 'popularity';
    applyFilters();
  });

  applyFilters();

  // Scroll to today if URL has hash
  if(location.hash){
    var el = document.getElementById(location.hash.substring(1));
    if(el) setTimeout(function(){ el.scrollIntoView({behavior:'smooth'}); }, 200);
  }
})();
  <\/script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Movie Anniversaries - ${label}</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Movie Anniversaries</h1>
      <p class="subtitle">${label} — ${dateRange}</p>
      <p class="explore-link"><a href="index.html">Browse all weeks</a></p>
      <nav class="week-nav">${prevHtml}<span class="current">${label}</span>${nextHtml} <button id="today-btn">Today</button></nav>
    </header>
    ${filterHtml}
    <main>${daySections.join('\n')}
    </main>
    <footer>
      <p><a href="https://github.com/normware/movie-anniversary" target="_blank" rel="noopener">GitHub</a> &middot; <a href="../datenschutz">Datenschutz</a> &middot; <a href="../impressum">Impressum</a> &middot; <a href="index.html">All Weeks</a> &middot; <a href="../today/index.html">Today</a> &middot; Data from <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a></p>
    </footer>
  </div>
  ${filterScript}
</body>
  </html>`;
}

/* ------------------------------------------------------------------ */
/*  Index page with JS redirect                                       */
/* ------------------------------------------------------------------ */

function generateIndexPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Movie Anniversaries</title>
  <link rel="stylesheet" href="style.css">
  <script>
    (function() {
      function getISOWeek(d) {
        var t = new Date(d);
        t.setHours(0,0,0,0);
        var day = (t.getDay() + 6) % 7;
        t.setDate(t.getDate() - day + 3);
        var jan4 = new Date(t.getFullYear(), 0, 4);
        var week = 1 + Math.round(((t - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
        return t.getFullYear() + '-W' + String(week).padStart(2, '0');
      }
      var week = getISOWeek(new Date());
      var params = new URLSearchParams(location.search);
      if(params.has('week')){
        week = params.get('week');
      }
      window.location.href = 'week/' + week + '.html?week=' + week;
    })();
  </script>
</head>
<body>
  <div class="container" style="text-align:center;padding-top:80px">
    <h1>Movie Anniversaries</h1>
    <p>Redirecting to the current week...</p>
    <footer>
      <p><a href="https://github.com/normware/movie-anniversary" target="_blank" rel="noopener">GitHub</a> &middot; <a href="/datenschutz">Datenschutz</a> &middot; <a href="/impressum">Impressum</a> &middot; <a href="week/index.html">Browse all weeks</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Week index / sitemap page                                         */
/* ------------------------------------------------------------------ */

function generateWeekIndex(allWeeks) {
  const rows = allWeeks.map(w => {
    const label = isoWeekLabel(w.year, w.week);
    const monday = mondayOfISOWeek(w.year, w.week);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return `      <li><a href="${label}.html">${label} \u2014 ${formatDate(monday)} \u2013 ${formatDate(sunday)}</a></li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>All Weeks \u2013 Movie Anniversaries</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Movie Anniversaries</h1>
      <p class="subtitle">All available weeks</p>
    </header>
    <main>
      <ul class="week-list">${rows}
      </ul>
    </main>
    <footer>
      <p><a href="https://github.com/normware/movie-anniversary" target="_blank" rel="noopener">GitHub</a> &middot; <a href="../datenschutz">Datenschutz</a> &middot; <a href="../impressum">Impressum</a> &middot; Data from <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Today page with JS redirect                                       */
/* ------------------------------------------------------------------ */

function generateTodayPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Today &ndash; Movie Anniversaries</title>
  <link rel="stylesheet" href="../style.css">
  <script>
    (function() {
      function pad2(n){ return n < 10 ? '0' + n : '' + n; }
      function getISOWeek(d) {
        var t = new Date(d);
        t.setHours(0,0,0,0);
        var day = (t.getDay() + 6) % 7;
        t.setDate(t.getDate() - day + 3);
        var jan4 = new Date(t.getFullYear(), 0, 4);
        var week = 1 + Math.round(((t - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
        return t.getFullYear() + '-W' + String(week).padStart(2, '0');
      }
      var d = new Date();
      var week = getISOWeek(d);
      var today = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
      window.location.href = '../week/' + week + '.html#' + today;
    })();
  </script>
</head>
<body>
  <div class="container" style="text-align:center;padding-top:80px">
    <h1>Movie Anniversaries</h1>
    <p>Redirecting to today&rsquo;s movies...</p>
    <footer>
      <p><a href="https://github.com/normware/movie-anniversary" target="_blank" rel="noopener">GitHub</a> &middot; <a href="../datenschutz">Datenschutz</a> &middot; <a href="../impressum">Impressum</a> &middot; <a href="../week/index.html">Browse all weeks</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('=== MovieAnniversary: Build Site ===\n');

  loadEnv();
  const encKey = getEnv('DATA_ENCRYPTION_KEY');

  // Parse args
  const args = process.argv.slice(2);
  let singleWeek = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week' && args[i + 1]) {
      singleWeek = args[i + 1];
      i++;
    }
  }

  // Read & decrypt movie data
  if (!fs.existsSync(ENC_FILE)) {
    console.error(`  [ERR]  Encrypted data not found at ${ENC_FILE}`);
    console.error('        Run "npm run fetch-data" first.');
    process.exit(1);
  }
  const encData = fs.readFileSync(ENC_FILE, 'utf8');
  const payload = decrypt(encData, encKey);
  const movies = payload.movies;
  console.log(`  [INFO] Loaded ${movies.length} movies (fetched ${payload.fetchedAt})\n`);

  // Determine which weeks to build
  const weeksToBuild = [];

  if (singleWeek) {
    // Parse 2026-W20 format
    const match = singleWeek.match(/^(\d{4})-W(\d{1,2})$/);
    if (!match) {
      console.error('  [ERR]  Invalid week format. Use YYYY-WXX (e.g. 2026-W20)');
      process.exit(1);
    }
    weeksToBuild.push({ year: parseInt(match[1]), week: parseInt(match[2]) });
  } else {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setFullYear(now.getFullYear() - RANGE_SPAN_YEARS);
    const endDate = new Date(now);
    endDate.setFullYear(now.getFullYear() + RANGE_SPAN_YEARS);

    const startISO = getISOWeek(startDate);
    const endISO = getISOWeek(endDate);

    // Enumerate all weeks from start to end
    let current = { year: startISO.year, week: startISO.week };
    const endKey = `${endISO.year}-${String(endISO.week).padStart(2, '0')}`;

    while (`${current.year}-${String(current.week).padStart(2, '0')}` <= endKey) {
      weeksToBuild.push({ ...current });
      current.week++;
      const maxWeek = weeksInYear(current.year);
      if (current.week > maxWeek) {
        current.week = 1;
        current.year++;
      }
    }
  }

  console.log(`  [INFO] Building ${weeksToBuild.length} week(s)\n`);

  // Ensure output directories
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  if (!fs.existsSync(WEEK_DIR)) fs.mkdirSync(WEEK_DIR, { recursive: true });

  // Copy CSS
  if (fs.existsSync(CSS_FILE)) {
    fs.copyFileSync(CSS_FILE, CSS_OUT);
  }

  // Build each week
  const builtWeeks = [];
  for (const w of weeksToBuild) {
    const monday = mondayOfISOWeek(w.year, w.week);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const dayMap = getAnniversaryMovies(movies, monday);
    const label = isoWeekLabel(w.year, w.week);

    // Determine prev/next links
    const prevWeek = getPrevWeek(w.year, w.week);
    const nextWeek = getNextWeek(w.year, w.week);
    const prevKey = isoWeekLabel(prevWeek.year, prevWeek.week);
    const nextKey = isoWeekLabel(nextWeek.year, nextWeek.week);

    const hasPrev = weeksToBuild.some(x => x.year === prevWeek.year && x.week === prevWeek.week);
    const hasNext = weeksToBuild.some(x => x.year === nextWeek.year && x.week === nextWeek.week);

    const html = generateWeekPage(
      w.year, w.week, dayMap, monday, sunday,
      hasPrev, hasNext,
      `${prevKey}.html`, `${nextKey}.html`,
    );

    const outPath = path.join(WEEK_DIR, `${label}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    builtWeeks.push(w);

    const movieCount = dayMap.reduce((sum, arr) => sum + arr.length, 0);
    console.log(`  [BUILD] ${label}  (${movieCount} movies)`);
  }

  // Generate index page
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), generateIndexPage(), 'utf8');
  console.log('\n  [OK]   index.html written');

  // Generate week index page
  fs.writeFileSync(path.join(WEEK_DIR, 'index.html'), generateWeekIndex(builtWeeks), 'utf8');
  console.log('  [OK]   week/index.html written');

  // Generate today page
  const TODAY_DIR = path.join(DOCS_DIR, 'today');
  if (!fs.existsSync(TODAY_DIR)) fs.mkdirSync(TODAY_DIR, { recursive: true });
  fs.writeFileSync(path.join(TODAY_DIR, 'index.html'), generateTodayPage(), 'utf8');
  console.log('  [OK]   today/index.html written');

  console.log(`\n  [DONE] ${builtWeeks.length} weeks built. Open docs/index.html to view.`);
}

/* ------------------------------------------------------------------ */
/*  Week arithmetic helpers                                           */
/* ------------------------------------------------------------------ */

function weeksInYear(year) {
  // ISO week count = week number of Dec 28
  const dec28 = new Date(year, 11, 28);
  return getISOWeek(dec28).week;
}

function getPrevWeek(year, week) {
  if (week > 1) return { year, week: week - 1 };
  return { year: year - 1, week: weeksInYear(year - 1) };
}

function getNextWeek(year, week) {
  const maxWeek = weeksInYear(year);
  if (week < maxWeek) return { year, week: week + 1 };
  return { year: year + 1, week: 1 };
}

main().catch(err => {
  console.error('\n  [FATAL]', err.message);
  process.exit(1);
});
