import fs from 'fs';
import path from 'path';
import {
  loadEnv, getEnv, decrypt, escapeHtml, posterUrl,
  getISOWeek, mondayOfISOWeek, formatDate, formatDateISO, formatDayHeader,
  isoWeekLabel, monthLabel, monthKey, DAYS_SHORT,
  weeksInYear, getPrevWeek, getNextWeek, isAnniversaryOnDate,
  tmdbMovieUrl, letterboxdUrl, imdbUrl, ROOT, IMAGE_BASE,
} from './shared.js';

const RANGE_SPAN_YEARS = 1;

const SRC_DIR = path.join(ROOT, 'src');
const DOCS_DIR = path.join(ROOT, 'docs');
const WEEK_DIR = path.join(DOCS_DIR, 'week');
const MONTH_DIR = path.join(DOCS_DIR, 'month');
const ENC_FILE = path.join(SRC_DIR, 'movies.enc.json');

/* ------------------------------------------------------------------ */
/*  Anniversary helpers                                                */
/* ------------------------------------------------------------------ */

function buildMonthDayIndex(movies) {
  const index = new Map();
  for (const movie of movies) {
    if (!movie.release_date) continue;
    const parts = movie.release_date.split('-');
    if (parts.length !== 3) continue;
    const [ry, rm, rd] = parts.map(Number);
    movie._ry = ry;
    movie._rm = rm;
    movie._rd = rd;
    const key = `${String(rm).padStart(2, '0')}-${String(rd).padStart(2, '0')}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(movie);
  }
  return index;
}

function getAnniversaryMovies(movies, monthDayIndex, weekMonday) {
  return Array.from({ length: 7 }, (_, d) => {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + d);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const key = `${mm}-${dd}`;
    const candidates = monthDayIndex.get(key) || [];
    const entries = [];
    for (const movie of candidates) {
      const years = isAnniversaryOnDate(movie, date);
      if (years) entries.push({ movie, years });
    }
    entries.sort((a, b) => b.movie.popularity - a.movie.popularity);
    return entries;
  });
}

function getAnniversaryMoviesForMonth(movies, monthDayIndex, year, month) {
  const dim = new Date(year, month, 0).getDate();
  return Array.from({ length: dim + 1 }, (_, d) => {
    if (d === 0) return [];
    const date = new Date(year, month - 1, d);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const key = `${mm}-${dd}`;
    const candidates = monthDayIndex.get(key) || [];
    const entries = [];
    for (const movie of candidates) {
      const anniYears = isAnniversaryOnDate(movie, date);
      if (anniYears) entries.push({ movie, years: anniYears });
    }
    entries.sort((a, b) => b.movie.popularity - a.movie.popularity);
    return entries;
  });
}

function collectFilterValues(dayMap) {
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
  return {
    anniversaryValues,
    minYear: years[0] || 0,
    maxYear: years[years.length - 1] || 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Filter bar HTML + JS snippets                                      */
/* ------------------------------------------------------------------ */

function ratingOptions() {
  return [0,1,2,3,4,5,6,7,8,9,10].map(v =>
    `<option value="${v}">${v === 0 ? 'All' : v + '+'}</option>`
  ).join('');
}

function generateFilterBarHTML(anniversaryValues, minYear, maxYear, pageType) {
  const anniFilterHtml = anniversaryValues.map(v =>
    `<label class="filter-chk"><input type="checkbox" class="anni-cb" value="${v}" checked>${v}y</label>`
  ).join('');

  const extraGroups = pageType === 'week'
    ? ``
    : `<div class="filter-group">
        <label class="option-chk"><input type="checkbox" id="hide-empty">Hide empty</label>
      </div>
      <div class="filter-group">
        <label class="option-chk"><input type="checkbox" id="show-3">Show 3</label>
      </div>`;

  return `\
    <span class="filter-toggle" id="filter-toggle"><span class="filter-toggle__arrow">\u25BC</span> Filters</span>
    <div class="filter-wrap" id="filter-wrap">
    <div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">Rating</span>
        <select id="rating-filter" title="Filter by TMDB vote average">${ratingOptions()}</select>
      </div>
      <div class="filter-group">
        <span class="filter-label">Anniv.</span>
        <div class="filter-chks">${anniFilterHtml}</div>
        <button class="anni-all-btn btn btn--sm" data-action="all">All</button>
        <button class="anni-all-btn btn btn--sm" data-action="none">None</button>
      </div>
      <div class="filter-group">
        <span class="filter-label">Year</span>
        <span class="year-range">
          <input type="number" id="year-min" class="year-input" placeholder="${minYear}" min="${minYear}" max="${maxYear}">
          <span class="year-sep">\u2013</span>
          <input type="number" id="year-max" class="year-input" placeholder="${maxYear}" min="${minYear}" max="${maxYear}">
        </span>
      </div>
      <div class="filter-group">
        <span class="filter-label">Sort</span>
        <select id="sort-select" title="Sort movies">
          <option value="popularity">Popularity</option>
          <option value="rating">Rating</option>
          <option value="title">Title</option>
          <option value="year">Year</option>
          <option value="anniversary">Anniv.</option>
        </select>
      </div>
      ${extraGroups}
      <div class="filter-group">
        <button class="btn" id="reset-filters" title="Reset all filters">\u21BB Reset</button>
      </div>
    </div>
    </div>
    <p id="filter-count" class="filter-count"></p>`;
}

/* ------------------------------------------------------------------ */
/*  HTML shell                                                         */
/* ------------------------------------------------------------------ */

function footerHTML(prefix, ...extraLinks) {
  const links = [
    '<a href="https://github.com/normware/movie-anniversary" target="_blank" rel="noopener">GitHub</a>',
    `<a href="${prefix}datenschutz">Datenschutz</a>`,
    `<a href="${prefix}impressum">Impressum</a>`,
    ...extraLinks,
  ];
  return `
    <p>${links.join(' &middot; ')}</p>
    <p class="tmdb-attribution">
      <img src="${prefix}tmdb-logo.svg" alt="TMDB Logo" class="tmdb-logo" width="32" height="24">
      This product uses the TMDB API but is not endorsed or certified by TMDB.
    </p>`;
}

function generateShell(title, subtitle, bodyHTML, extraHTML = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Movie Anniversaries</h1>
      <span class="subtitle">${subtitle}</span>
      ${extraHTML}
    </header>
    ${bodyHTML}
    <footer>
      ${footerHTML('../')}
    </footer>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Movie HTML snippets                                                */
/* ------------------------------------------------------------------ */

function posterItemHtml(entry) {
  const { movie, years } = entry;
  const tmdb = tmdbMovieUrl(movie.id);
  const imgTag = movie.poster_path
    ? `<img src="${posterUrl(movie.poster_path, 'w92')}" alt="${escapeHtml(movie.title)}" loading="lazy">`
    : `<div class="poster-item__placeholder">${escapeHtml(movie.title)}</div>`;
  const year = movie.release_date ? movie.release_date.split('-')[0] : '?';
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '\u2014';
  return `<a href="${tmdb}" target="_blank" rel="noopener" class="poster-item" data-rating="${rating}" data-year="${year}" data-anniversary="${years}">
    ${imgTag}
    <div class="poster-item__info">
      <span class="poster-item__title">${escapeHtml(movie.title)}</span>
      <span class="poster-item__meta">${year} \u2605 ${rating}</span>
      <span class="poster-item__anni">${years}y</span>
    </div>
  </a>`;
}

function movieRowHtml(entry, dateStr) {
  const { movie, years } = entry;
  const imgTag = movie.poster_path
    ? `<img src="${posterUrl(movie.poster_path, 'w92')}" alt="${escapeHtml(movie.title)}" loading="lazy">`
    : '';

  const tmdb = tmdbMovieUrl(movie.id);
  const imdb = imdbUrl(movie.imdb_id);
  const lb = letterboxdUrl(movie.id);

  let linksHtml = `<a href="${tmdb}" target="_blank" rel="noopener">TMDB</a>`;
  if (imdb) linksHtml += `<a href="${imdb}" target="_blank" rel="noopener">IMDb</a>`;
  linksHtml += `<a href="${lb}" target="_blank" rel="noopener">LB</a>`;

  const year = movie.release_date ? movie.release_date.split('-')[0] : '?';
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '\u2014';

  return `<div class="movie-row" data-rating="${rating}" data-popularity="${movie.popularity.toFixed(1)}" data-year="${year}" data-anniversary="${years}" data-date="${dateStr}" data-title="${escapeHtml(movie.title).toLowerCase()}" data-tmdb="${movie.id}">
      <a href="${tmdb}" target="_blank" rel="noopener" class="movie-row__poster">${imgTag}</a>
      <div class="movie-row__info">
        <span class="movie-row__title"><a href="${tmdb}" target="_blank" rel="noopener">${escapeHtml(movie.title)}</a></span>
        <span class="movie-row__year">(${year})</span>
        <span class="movie-row__rating">\u2605 ${rating}</span>
        <span class="movie-row__anni">${years}y</span>
        <span class="movie-row__links">${linksHtml}</span>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Week page                                                          */
/* ------------------------------------------------------------------ */

function generateWeekPage(weekYear, weekNum, dayMap, weekMonday, weekSunday, hasPrev, hasNext, prevLink, nextLink) {
  const label = isoWeekLabel(weekYear, weekNum);
  const dateRange = `${formatDate(weekMonday)} \u2013 ${formatDate(weekSunday)}`;
  const { anniversaryValues, minYear, maxYear } = collectFilterValues(dayMap);

  let prevHtml = hasPrev
    ? `<a href="${prevLink}" class="btn">&larr; ${prevLink.replace('.html', '')}</a>`
    : '<span class="btn btn--disabled">&larr; Previous</span>';

  let nextHtml = hasNext
    ? `<a href="${nextLink}" class="btn">${nextLink.replace('.html', '')} &rarr;</a>`
    : '<span class="btn btn--disabled">Next &rarr;</span>';

  const daySections = [];
  const summaryLinks = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + d);
    const dateStr = formatDateISO(date);
    const dayEntries = dayMap[d];
    const dayShort = DAYS_SHORT[d];

    summaryLinks.push(`<a href="#${dateStr}">${dayShort}<span class="week-summary__count">${dayEntries.length}</span></a>`);

    if (dayEntries.length === 0) {
      daySections.push(`
      <section class="day-section" id="${dateStr}">
        <h2>${formatDayHeader(date)}</h2>
        <p class="empty-day">No movie anniversaries today.</p>
      </section>`);
    } else {
      const posterItems = dayEntries.map(e => posterItemHtml(e)).join('\n');
      daySections.push(`
      <section class="day-section" id="${dateStr}">
        <h2>${formatDayHeader(date)} <span class="badge">${dayEntries.length}</span></h2>
        <div class="poster-row">${posterItems}
        </div>
      </section>`);
    }
  }

  const exploreLinks = `<p class="explore-link"><a href="index.html">Browse all weeks</a> &middot; <a href="../month/index.html">Month view</a></p>`;
  const filterHtml = generateFilterBarHTML(anniversaryValues, minYear, maxYear, 'week');

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
      <span class="subtitle">${label} \u2014 ${dateRange}</span>
      ${exploreLinks}
      <nav class="week-nav">${prevHtml}<span class="btn btn--current">${label}</span>${nextHtml}<span class="week-nav__sep"></span><button class="btn btn--today" id="today-btn">Today</button><button class="btn" id="month-btn">Month</button></nav>
      <div class="week-summary">${summaryLinks.join('')}</div>
    </header>
    ${filterHtml}
    <main>${daySections.join('\n')}
    </main>
    <footer>
      ${footerHTML('../', '<a href="index.html">All Weeks</a>', '<a href="../month/index.html">Month</a>', '<a href="../today/index.html">Today</a>')}
    </footer>
  </div>
  ${filterWeekJS(label)}
</body>
  </html>`;
}

function filterWeekJS(label) {
  return `
  <script>
(function(){
  var STORAGE_KEY = 'movie-anni-filters';
  var PAGE_LABEL = '${label}';
  var sections = document.querySelectorAll('.day-section');
  var countEl = document.getElementById('filter-count');

  document.getElementById('today-btn').addEventListener('click', function(){
    location.href = '../today/index.html';
  });

  document.getElementById('month-btn').addEventListener('click', function(){
    var d = new Date();
    var m = String(d.getMonth()+1).padStart(2,'0');
    location.href = '../month/' + d.getFullYear() + '-' + m + '.html';
  });

  // Filter toggle
  var toggle = document.getElementById('filter-toggle');
  var wrap = document.getElementById('filter-wrap');
  if(toggle && wrap){
    var filterCollapsed = localStorage.getItem(STORAGE_KEY+'-collapsed') === '1';
    if(filterCollapsed){ toggle.classList.add('collapsed'); wrap.classList.add('collapsed'); }
    toggle.addEventListener('click', function(){
      wrap.classList.toggle('collapsed');
      toggle.classList.toggle('collapsed');
      try { localStorage.setItem(STORAGE_KEY+'-collapsed', wrap.classList.contains('collapsed') ? '1' : '0'); } catch(e){}
    });
  }

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

    sections.forEach(function(s){
      var vis = 0;
      var items = s.querySelectorAll('.poster-item');
      items.forEach(function(item){
        var r = parseFloat(item.getAttribute('data-rating')) || 0;
        var y = parseInt(item.getAttribute('data-year')) || 0;
        var a = parseInt(item.getAttribute('data-anniversary')) || 0;
        var show = r >= ratingVal;
        if(show && anniVals.length) show = anniVals.indexOf(a) !== -1;
        if(show) show = y >= yearMin && y <= yearMax;
        item.style.display = show ? '' : 'none';
        if(show) vis++;
      });

      // sort poster items within this section
      var row = s.querySelector('.poster-row');
      if(row){
        var sorted = Array.from(items).filter(function(el){ return el.style.display !== 'none'; }).sort(function(a,b){
          if(sortBy === 'title'){
            var av = (a.querySelector('.poster-item__title').textContent || '').toLowerCase();
            var bv = (b.querySelector('.poster-item__title').textContent || '').toLowerCase();
            return av < bv ? -1 : av > bv ? 1 : 0;
          }
          var attr = sortBy === 'anniversary' ? 'anniversary' : sortBy === 'year' ? 'year' : 'rating';
          var av = parseFloat(a.getAttribute('data-' + attr)) || 0;
          var bv = parseFloat(b.getAttribute('data-' + attr)) || 0;
          return bv - av;
        });
        sorted.forEach(function(el){ row.appendChild(el); });
      }

      visible += vis;
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
})();
  <\/script>`;
}

/* ------------------------------------------------------------------ */
/*  Today page                                                         */
/* ------------------------------------------------------------------ */

function generateTodayPage(movies, monthDayIndex, today, weekLabel, weekMonday, weekSunday) {
  const todayDate = new Date(today);
  const todayStr = formatDateISO(todayDate);
  const mm = String(todayDate.getMonth() + 1).padStart(2, '0');
  const dd = String(todayDate.getDate()).padStart(2, '0');
  const key = `${mm}-${dd}`;
  const candidates = monthDayIndex.get(key) || [];
  const dayEntries = [];
  for (const movie of candidates) {
    const years = isAnniversaryOnDate(movie, todayDate);
    if (years) dayEntries.push({ movie, years });
  }
  dayEntries.sort((a, b) => b.movie.popularity - a.movie.popularity);

  const headerDate = formatDayHeader(todayDate);
  let moviesHtml;
  if (dayEntries.length === 0) {
    moviesHtml = '<p class="today-empty">No movie anniversaries today.</p>';
  } else {
    const posters = dayEntries.slice(0, 30).map(e => posterItemHtml(e)).join('\n');
    moviesHtml = `<div class="today-grid">${posters}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Today \u2013 Movie Anniversaries</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <div class="container today-page">
    <header>
      <h1>Movie Anniversaries</h1>
    </header>
    <h2>${headerDate}</h2>
    <p class="today-date">${formatDate(todayDate)}</p>
    <div class="today-movies">${moviesHtml}</div>
    <p>${dayEntries.length} movie${dayEntries.length !== 1 ? 's' : ''} with anniversaries today</p>
    <div class="today-links">
      <a href="../week/${weekLabel}.html" class="btn">View this week</a>
      <a href="../month/${todayDate.getFullYear()}-${String(todayDate.getMonth()+1).padStart(2,'0')}.html" class="btn">View this month</a>
      <a href="../week/index.html" class="btn">Browse all weeks</a>
      <a href="../month/index.html" class="btn">Browse all months</a>
    </div>
    <footer>
      ${footerHTML('../', '<a href="../week/index.html">Weeks</a>', '<a href="../month/index.html">Months</a>')}
    </footer>
  </div>
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
    location.href = 'today/index.html';
  <\/script>
</head>
<body>
  <div class="container center-content">
    <h1>Movie Anniversaries</h1>
    <p>Redirecting to today...</p>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Week index page                                                    */
/* ------------------------------------------------------------------ */

function generateWeekIndex(allWeeks) {
  const rows = allWeeks.map(w => {
    const label = isoWeekLabel(w.year, w.week);
    const monday = mondayOfISOWeek(w.year, w.week);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return `      <li><a href="${label}.html">${label} \u2014 ${formatDate(monday)} \u2013 ${formatDate(sunday)}</a></li>`;
  }).join('\n');

  const body = `<main>
      <ul class="week-list">${rows}
      </ul>
    </main>`;

  const extra = `<p class="explore-link"><a href="../month/index.html">Month view</a> &middot; <a href="../today/index.html">Today</a></p>`;

  return generateShell(
    'All Weeks \u2013 Movie Anniversaries',
    'All available weeks',
    body,
    extra
  );
}

/* ------------------------------------------------------------------ */
/*  Month page                                                         */
/* ------------------------------------------------------------------ */

function generateMonthPage(year, month, movies, monthDayIndex, hasPrev, hasNext, prevLink, nextLink) {
  const dim = new Date(year, month, 0).getDate();
  const label = monthLabel(year, month);
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const mkey = monthKey(year, month);
  const dayMap = getAnniversaryMoviesForMonth(movies, monthDayIndex, year, month);
  const { anniversaryValues, minYear, maxYear } = collectFilterValues(dayMap);

  const dataArr = [];
  for (let d = 1; d <= dim; d++) {
    dataArr[d] = (dayMap[d] || []).map(e => ({
      id: e.movie.id,
      t: e.movie.title,
      r: e.movie.release_date,
      p: e.movie.popularity,
      po: e.movie.poster_path,
      v: e.movie.vote_average,
      im: e.movie.imdb_id || '',
      y: e.years,
    }));
  }
  const dataJson = JSON.stringify({ y: year, m: month, dim, pad: firstDow, data: dataArr });

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;
  const todayDay = today.getDate();

  let calHtml = '';
  DAYS_SHORT.forEach(d => {
    calHtml += `<div class="cal-hdr">${d}</div>`;
  });

  for (let i = 0; i < firstDow; i++) {
    calHtml += '<div class="cal-cell cal-emp"></div>';
  }

  for (let d = 1; d <= dim; d++) {
    const isToday = isCurrentMonth && d === todayDay;
    const entries = dayMap[d] || [];
    let moviesHtml = '';

    if (entries.length > 0) {
      const top = entries[0];
      const topM = top.movie;
      const topTu = tmdbMovieUrl(topM.id);
      const topPu = topM.poster_path ? `${IMAGE_BASE}/w92${topM.poster_path}` : '';
      const topThumb = topPu
        ? `<img src="${topPu}" alt="" class="cal-movie__thumb" loading="lazy">`
        : '';

      let subHtml = '';
      for (let si = 1; si < Math.min(entries.length, 3); si++) {
        const sub = entries[si];
        const subM = sub.movie;
        const subTu = tmdbMovieUrl(subM.id);
        subHtml += `<div class="cal-movie cal-movie--sub"><div class="cal-movie__info"><div class="cal-movie__title"><a href="${subTu}" target="_blank" rel="noopener">${escapeHtml(subM.title)}</a></div><div class="cal-movie__anni">${sub.years}y</div></div></div>`;
      }

      const extra = entries.length > 3 ? `<div class="cal-movie__title" style="color:#555;font-size:7px;padding-top:1px">+${entries.length-3} more</div>` : '';

      moviesHtml = `<div class="cal-movie cal-movie--top">${topThumb}<div class="cal-movie__info"><div class="cal-movie__title"><a href="${topTu}" target="_blank" rel="noopener">${escapeHtml(topM.title)}</a></div><div class="cal-movie__anni">${top.years}y</div></div></div>`
        + `<div class="cal-movie__subs">${subHtml}</div>`
        + extra;
    }

    calHtml += `<div class="cal-cell${isToday ? ' today' : ''}" id="c${d}">`
      + `<div class="cal-num">${d}</div>`
      + moviesHtml
      + `</div>`;
  }

  const totalCells = firstDow + dim;
  const remainder = totalCells % 7;
  if (remainder > 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      calHtml += '<div class="cal-cell cal-emp"></div>';
    }
  }

  let prevHtml = hasPrev
    ? `<a href="${prevLink}" class="btn">&larr; ${prevLink.replace('.html', '')}</a>`
    : '<span class="btn btn--disabled">&larr; Previous</span>';
  let nextHtml = hasNext
    ? `<a href="${nextLink}" class="btn">${nextLink.replace('.html', '')} &rarr;</a>`
    : '<span class="btn btn--disabled">Next &rarr;</span>';

  const filterHtml = generateFilterBarHTML(anniversaryValues, minYear, maxYear, 'month');

  const body = `\
    <p class="explore-link"><a href="index.html">Browse all months</a> &middot; <a href="../week/index.html">Week view</a></p>
    <nav class="week-nav">${prevHtml}<span class="btn btn--current">${label}</span>${nextHtml}<span class="week-nav__sep"></span><button class="btn btn--today" id="today-btn">Today</button><button class="btn" id="week-btn">Week</button></nav>
    ${filterHtml}
    <div id="cal">${calHtml}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Movie Anniversaries \u2014 ${label}</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Movie Anniversaries</h1>
      <span class="subtitle">${label}</span>
      <p class="explore-link"><a href="index.html">Browse all months</a> &middot; <a href="../week/index.html">Week view</a></p>
      <nav class="week-nav">${prevHtml}<span class="btn btn--current">${label}</span>${nextHtml}<span class="week-nav__sep"></span><button class="btn btn--today" id="today-btn">Today</button><button class="btn" id="week-btn">Week</button></nav>
    </header>
    ${filterHtml}
    <div id="cal">${calHtml}</div>
    <footer>
      ${footerHTML('../', '<a href="index.html">All months</a>')}
    </footer>
  </div>
  ${filterMonthJS(dataJson)}
</body>
</html>`;
}

function filterMonthJS(dataJson) {
  return `
  <script>
(function(){
  var STORAGE_KEY = 'movie-anni-filters';
  var D = ${dataJson};
  var countEl = document.getElementById('filter-count');

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function topHtml(m){
    var tu = 'https://www.themoviedb.org/movie/'+m.id;
    var pu = m.po ? 'https://image.tmdb.org/t/p/w92'+m.po : '';
    var thumb = pu ? '<img src="'+pu+'" alt="" class="cal-movie__thumb" loading="lazy">' : '';
    return '<div class="cal-movie cal-movie--top">'+thumb+'<div class="cal-movie__info"><div class="cal-movie__title"><a href="'+tu+'" target="_blank" rel="noopener">'+esc(m.t)+'</a></div><div class="cal-movie__anni">'+m.y+'y</div></div></div>';
  }

  function subHtml(m){
    var tu = 'https://www.themoviedb.org/movie/'+m.id;
    return '<div class="cal-movie cal-movie--sub"><div class="cal-movie__info"><div class="cal-movie__title"><a href="'+tu+'" target="_blank" rel="noopener">'+esc(m.t)+'</a></div><div class="cal-movie__anni">'+m.y+'y</div></div></div>';
  }

  function render(){
    var ratingVal = parseFloat(document.getElementById('rating-filter').value) || 0;
    var anniCbs = document.querySelectorAll('.anni-cb:checked');
    var anniVals = Array.from(anniCbs).map(function(cb){ return parseInt(cb.value); });
    var yearMin = parseInt(document.getElementById('year-min').value) || 0;
    var yearMax = parseInt(document.getElementById('year-max').value) || 9999;
    var sortBy = document.getElementById('sort-select').value;
    var hideEmpty = document.getElementById('hide-empty').checked;
    var show3 = document.getElementById('show-3').checked;
    var fld = sortBy === 'rating' ? 'v' : sortBy === 'popularity' ? 'p' : sortBy === 'title' ? 't' : sortBy === 'year' ? 'r' : 'y';
    var vis = 0;

    for(var d=1; d<=D.dim; d++){
      var arr = D.data[d] || [];
      var f = arr.filter(function(m){
        if((m.v||0) < ratingVal) return false;
        if(anniVals.length && anniVals.indexOf(m.y)===-1) return false;
        var yr = parseInt(m.r) || 0;
        return yr >= yearMin && yr <= yearMax;
      });
      if(fld === 't'){
        f.sort(function(a,b){ return (a.t||'').localeCompare(b.t||''); });
      } else if(fld === 'r'){
        f.sort(function(a,b){ return (parseInt(b.r)||0) - (parseInt(a.r)||0); });
      } else if(fld === 'y'){
        f.sort(function(a,b){ return (b.y||0) - (a.y||0); });
      } else {
        f.sort(function(a,b){ return (b[fld]||0) - (a[fld]||0); });
      }
      var el = document.getElementById('c'+d);
      if(!el) continue;
      var numEl = el.querySelector('.cal-num');
      el.innerHTML = '';
      if(numEl) el.appendChild(numEl);

      if(f.length > 0){
        var h = topHtml(f[0]);
        if(show3){
          for(var si=1; si<Math.min(f.length, 3); si++){
            h += subHtml(f[si]);
          }
          if(f.length > 3) h += '<div class="cal-movie__title" style="color:#555;font-size:7px;padding-top:1px">+'+(f.length-3)+' more</div>';
        } else {
          if(f.length > 1) h += '<div class="cal-movie__title" style="color:#555;font-size:7px;padding-top:1px">+'+(f.length-1)+' more</div>';
        }
        el.insertAdjacentHTML('beforeend', h);
        el.style.display = 'flex';
        vis++;
      } else {
        el.style.display = hideEmpty ? 'none' : 'flex';
      }
    }
    if(countEl) countEl.textContent = vis + ' day' + (vis!==1?'s':'') + ' with anniversaries';
    saveState();
  }

  document.getElementById('today-btn').addEventListener('click', function(){
    var now = new Date();
    location.href = '../month/' + now.getFullYear() + '-' + (now.getMonth()<9?'0':'') + (now.getMonth()+1) + '.html';
  });

  document.getElementById('week-btn').addEventListener('click', function(){
    location.href = '../week/index.html';
  });

  // Filter toggle
  var toggle = document.getElementById('filter-toggle');
  var wrap = document.getElementById('filter-wrap');
  if(toggle && wrap){
    var filterCollapsed = localStorage.getItem(STORAGE_KEY+'-collapsed') === '1';
    if(filterCollapsed){ toggle.classList.add('collapsed'); wrap.classList.add('collapsed'); }
    toggle.addEventListener('click', function(){
      wrap.classList.toggle('collapsed');
      toggle.classList.toggle('collapsed');
      try { localStorage.setItem(STORAGE_KEY+'-collapsed', wrap.classList.contains('collapsed') ? '1' : '0'); } catch(e){}
    });
  }

  function saveState(){
    var state = {
      rating: document.getElementById('rating-filter').value,
      anni: Array.from(document.querySelectorAll('.anni-cb')).map(function(cb){ return cb.checked; }),
      yearMin: document.getElementById('year-min').value,
      yearMax: document.getElementById('year-max').value,
      sort: document.getElementById('sort-select').value,
      hideEmpty: document.getElementById('hide-empty').checked,
      show3: document.getElementById('show-3').checked
    };
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
  }

  function loadState(){
    var raw;
    try{ raw = localStorage.getItem(STORAGE_KEY); }catch(e){}
    if(!raw) return;
    var state;
    try{ state = JSON.parse(raw); }catch(e){ return; }
    if(!state) return;
    if(state.rating) document.getElementById('rating-filter').value = state.rating;
    if(state.anni) document.querySelectorAll('.anni-cb').forEach(function(cb,i){
      if(state.anni[i]!==undefined) cb.checked = state.anni[i];
    });
    if(state.yearMin!==undefined) document.getElementById('year-min').value = state.yearMin;
    if(state.yearMax!==undefined) document.getElementById('year-max').value = state.yearMax;
    if(state.sort) document.getElementById('sort-select').value = state.sort;
    if(state.hideEmpty!==undefined) document.getElementById('hide-empty').checked = state.hideEmpty;
    if(state.show3!==undefined) document.getElementById('show-3').checked = state.show3;
  }

  loadState();
  document.getElementById('rating-filter').addEventListener('change', render);
  document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.addEventListener('change', render); });
  document.querySelectorAll('.anni-all-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var checked = btn.getAttribute('data-action')==='all';
      document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.checked = checked; });
      render();
    });
  });
  document.getElementById('year-min').addEventListener('input', render);
  document.getElementById('year-max').addEventListener('input', render);
  document.getElementById('sort-select').addEventListener('change', render);
  document.getElementById('hide-empty').addEventListener('change', render);
  document.getElementById('show-3').addEventListener('change', render);
  document.getElementById('reset-filters').addEventListener('click', function(){
    document.getElementById('rating-filter').value = '0';
    document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.checked = true; });
    document.getElementById('year-min').value = '';
    document.getElementById('year-max').value = '';
    document.getElementById('sort-select').value = 'popularity';
    document.getElementById('hide-empty').checked = false;
    document.getElementById('show-3').checked = false;
    render();
  });
  render();
})();
  <\/script>`;
}

function generateMonthIndex(allMonths) {
  const rows = allMonths.map(m => {
    const key = monthKey(m.year, m.month);
    const label = monthLabel(m.year, m.month);
    return `      <li><a href="${key}.html">${label}</a></li>`;
  }).join('\n');

  const body = `<main>
      <ul class="week-list">${rows}
      </ul>
    </main>`;

  const extra = `<p class="explore-link"><a href="../week/index.html">Week view</a> &middot; <a href="../today/index.html">Today</a></p>`;

  return generateShell(
    'All Months \u2013 Movie Anniversaries',
    'All available months',
    body,
    extra
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('=== MovieAnniversary: Build Site ===\n');

  loadEnv();
  const encKey = getEnv('DATA_ENCRYPTION_KEY');

  const args = process.argv.slice(2);
  let singleWeek = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week' && args[i + 1]) {
      singleWeek = args[i + 1];
      i++;
    }
  }

  if (!fs.existsSync(ENC_FILE)) {
    console.error(`  [ERR]  Encrypted data not found at ${ENC_FILE}`);
    console.error('        Run "npm run fetch-data" first.');
    process.exit(1);
  }
  const encData = fs.readFileSync(ENC_FILE, 'utf8');
  const payload = decrypt(encData, encKey);
  const movies = payload.movies;
  console.log(`  [INFO] Loaded ${movies.length} movies (fetched ${payload.fetchedAt})`);

  const monthDayIndex = buildMonthDayIndex(movies);
  console.log(`  [INFO] Built month-day index (${monthDayIndex.size} unique dates)\n`);

  const weeksToBuild = [];

  if (singleWeek) {
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

  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  if (!fs.existsSync(WEEK_DIR)) fs.mkdirSync(WEEK_DIR, { recursive: true });

  // Determine today/week for the today page
  const now = new Date();
  const todayISO = getISOWeek(now);
  const todayMonday = mondayOfISOWeek(todayISO.year, todayISO.week);
  const todayLabel = isoWeekLabel(todayISO.year, todayISO.week);

  const builtWeeks = [];
  for (const w of weeksToBuild) {
    const monday = mondayOfISOWeek(w.year, w.week);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const dayMap = getAnniversaryMovies(movies, monthDayIndex, monday);
    const label = isoWeekLabel(w.year, w.week);

    const prevWeek = getPrevWeek(w.year, w.week);
    const nextWeek = getNextWeek(w.year, w.week);
    const prevKey = isoWeekLabel(prevWeek.year, prevWeek.week);
    const nextKey = isoWeekLabel(nextWeek.year, nextWeek.week);

    const hasPrev = weeksToBuild.some(x => x.year === prevWeek.year && x.week === prevWeek.week);
    const hasNext = weeksToBuild.some(x => x.year === nextWeek.year && x.week === nextWeek.week);

    const html = generateWeekPage(
      w.year, w.week, dayMap, monday, sunday,
      hasPrev, hasNext, `${prevKey}.html`, `${nextKey}.html`,
    );

    fs.writeFileSync(path.join(WEEK_DIR, `${label}.html`), html, 'utf8');
    builtWeeks.push(w);

    const movieCount = dayMap.reduce((sum, arr) => sum + arr.length, 0);
    console.log(`  [BUILD] ${label}  (${movieCount} movies)`);
  }

  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), generateIndexPage(), 'utf8');
  console.log('\n  [OK]   index.html written');

  fs.writeFileSync(path.join(WEEK_DIR, 'index.html'), generateWeekIndex(builtWeeks), 'utf8');
  console.log('  [OK]   week/index.html written');

  // Build today page (uses current week's movie data)
  const TODAY_DIR = path.join(DOCS_DIR, 'today');
  if (!fs.existsSync(TODAY_DIR)) fs.mkdirSync(TODAY_DIR, { recursive: true });
  const todayHtml = generateTodayPage(movies, monthDayIndex, now, todayLabel, todayMonday, new Date(todayMonday.getTime() + 6*86400000));
  fs.writeFileSync(path.join(TODAY_DIR, 'index.html'), todayHtml, 'utf8');
  console.log('  [OK]   today/index.html written (with today\'s movies)');

  // Build month pages
  if (!singleWeek) {
    const startDate = new Date(now);
    startDate.setFullYear(now.getFullYear() - RANGE_SPAN_YEARS);
    const endDate = new Date(now);
    endDate.setFullYear(now.getFullYear() + RANGE_SPAN_YEARS);

    const monthsToBuild = [];
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= endDate) {
      monthsToBuild.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    if (!fs.existsSync(MONTH_DIR)) fs.mkdirSync(MONTH_DIR, { recursive: true });

    const builtMonths = [];
    for (const m of monthsToBuild) {
      const label = monthKey(m.year, m.month);

      const prevM = m.month > 1 ? { year: m.year, month: m.month - 1 } : { year: m.year - 1, month: 12 };
      const nextM = m.month < 12 ? { year: m.year, month: m.month + 1 } : { year: m.year + 1, month: 1 };
      const prevKey = monthKey(prevM.year, prevM.month);
      const nextKey = monthKey(nextM.year, nextM.month);

      const hasPrev = monthsToBuild.some(x => x.year === prevM.year && x.month === prevM.month);
      const hasNext = monthsToBuild.some(x => x.year === nextM.year && x.month === nextM.month);

      const html = generateMonthPage(m.year, m.month, movies, monthDayIndex, hasPrev, hasNext, `${prevKey}.html`, `${nextKey}.html`);
      fs.writeFileSync(path.join(MONTH_DIR, `${label}.html`), html, 'utf8');
      builtMonths.push(m);
      console.log(`  [BUILD] ${label}`);
    }

    fs.writeFileSync(path.join(MONTH_DIR, 'index.html'), generateMonthIndex(builtMonths), 'utf8');
    console.log('  [OK]   month/index.html written');
  }

  console.log(`\n  [DONE] ${builtWeeks.length} weeks built. Open docs/index.html to view.`);
}

main().catch(err => {
  console.error('\n  [FATAL]', err.message);
  process.exit(1);
});
