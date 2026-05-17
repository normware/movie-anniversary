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

function getAnniversaryMovies(movies, weekMonday) {
  return Array.from({ length: 7 }, (_, d) => {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + d);
    const entries = [];
    for (const movie of movies) {
      const years = isAnniversaryOnDate(movie, date);
      if (years) entries.push({ movie, years });
    }
    entries.sort((a, b) => b.movie.popularity - a.movie.popularity);
    return entries;
  });
}

function getAnniversaryMoviesForMonth(movies, year, month) {
  const dim = new Date(year, month, 0).getDate();
  return Array.from({ length: dim + 1 }, (_, d) => {
    if (d === 0) return [];
    const date = new Date(year, month - 1, d);
    const entries = [];
    for (const movie of movies) {
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

function generateFilterBarHTML(anniversaryValues, minYear, maxYear) {
  const anniFilterHtml = anniversaryValues.map(v =>
    `<label class="filter-chk"><input type="checkbox" class="anni-cb" value="${v}" checked>${v}y</label>`
  ).join('');

  return `\
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
        <span class="year-sep">\u2013</span>
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
      <p class="subtitle">${subtitle}</p>
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
/*  Page generators                                                    */
/* ------------------------------------------------------------------ */

function movieCardHtml(entry, dateStr) {
  const { movie, years } = entry;
  const imgTag = movie.poster_path
    ? `<img src="${posterUrl(movie.poster_path)}" alt="${escapeHtml(movie.title)}" loading="lazy">`
    : `<div class="poster-placeholder">${escapeHtml(movie.title)}</div>`;

  const tmdb = tmdbMovieUrl(movie.id);
  const imdb = imdbUrl(movie.imdb_id);
  const lb = letterboxdUrl(movie.id);

  let linksHtml = `<a href="${tmdb}" target="_blank" rel="noopener">TMDB</a>`;
  if (imdb) linksHtml += `<a href="${imdb}" target="_blank" rel="noopener">IMDb</a>`;
  linksHtml += `<a href="${lb}" target="_blank" rel="noopener">Letterboxd</a>`;

  const year = movie.release_date ? movie.release_date.split('-')[0] : '?';
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '\u2014';

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

function generateWeekPage(weekYear, weekNum, dayMap, weekMonday, weekSunday, hasPrev, hasNext, prevLink, nextLink) {
  const label = isoWeekLabel(weekYear, weekNum);
  const dateRange = `${formatDate(weekMonday)} \u2013 ${formatDate(weekSunday)}`;
  const { anniversaryValues, minYear, maxYear } = collectFilterValues(dayMap);

  let prevHtml = hasPrev
    ? `<a href="${prevLink}">&larr; ${prevLink.replace('.html', '')}</a>`
    : '<span class="disabled">&larr; Previous</span>';

  let nextHtml = hasNext
    ? `<a href="${nextLink}">${nextLink.replace('.html', '')} &rarr;</a>`
    : '<span class="disabled">Next &rarr;</span>';

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

  const exploreLinks = `<p class="explore-link"><a href="index.html">Browse all weeks</a> &middot; <a href="../month/index.html">Month view</a></p>`;
  const filterHtml = generateFilterBarHTML(anniversaryValues, minYear, maxYear);

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
      <p class="subtitle">${label} \u2014 ${dateRange}</p>
      ${exploreLinks}
      <nav class="week-nav">${prevHtml}<span class="current">${label}</span>${nextHtml} <button id="today-btn">Today</button> <button id="month-btn">Month</button></nav>
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
  var cards = document.querySelectorAll('.movie-card');
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
      var week = getISOWeek(new Date());
      var params = new URLSearchParams(location.search);
      if(params.has('week')) week = params.get('week');
      window.location.href = 'week/' + week + '.html?week=' + week;
    })();
  </script>
</head>
<body>
  <div class="container center-content">
    <h1>Movie Anniversaries</h1>
    <p>Redirecting to the current week...</p>
    <footer>
      ${footerHTML('/', '<a href="week/index.html">Browse all weeks</a>')}
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
  <title>Today \u2013 Movie Anniversaries</title>
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
  <div class="container center-content">
    <h1>Movie Anniversaries</h1>
    <p>Redirecting to today\u2019s movies...</p>
    <footer>
      ${footerHTML('../', '<a href="../week/index.html">Browse all weeks</a>')}
    </footer>
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

  const extra = `<p class="explore-link"><a href="../month/index.html">Month view</a></p>`;

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

function generateMonthPage(year, month, movies, hasPrev, hasNext, prevLink, nextLink) {
  const dim = new Date(year, month, 0).getDate();
  const label = monthLabel(year, month);
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const mkey = monthKey(year, month);
  const dayMap = getAnniversaryMoviesForMonth(movies, year, month);
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
    let cardHtml = '';

    if (entries.length > 0) {
      const top = entries[0];
      const m = top.movie;
      const pu = m.poster_path ? `${IMAGE_BASE}/w92${m.poster_path}` : '';
      const tu = tmdbMovieUrl(m.id);
      const iu = imdbUrl(m.imdb_id);
      const lu = letterboxdUrl(m.id);

      let links = `<a href="${tu}" target="_blank" rel="noopener">TMDB</a>`;
      if (iu) links += ` <a href="${iu}" target="_blank" rel="noopener">IMDb</a>`;
      links += ` <a href="${lu}" target="_blank" rel="noopener">LB</a>`;

      const thumbHtml = pu
        ? `<img src="${pu}" alt="${escapeHtml(m.title)}" class="cal-thumb" loading="lazy">`
        : `<div class="cal-thumb cal-thumb--missing"></div>`;

      cardHtml = `<div class="cal-card" id="cc${d}">`
        + `<a href="${tu}" target="_blank" rel="noopener" class="cal-thumb-link">${thumbHtml}</a>`
        + `<div class="cal-info">`
        + `<div class="cal-title"><a href="${tu}" target="_blank" rel="noopener">${escapeHtml(m.title)}</a></div>`
        + `<div class="cal-anni">${top.years} years</div>`
        + `<div class="cal-links">${links}</div>`
        + `</div></div>`;
    }

    calHtml += `<div class="cal-cell${isToday ? ' today' : ''}" id="c${d}">`
      + `<div class="cal-num">${d}</div>`
      + cardHtml
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
    ? `<a href="${prevLink}">&larr; ${prevLink.replace('.html', '')}</a>`
    : '<span class="disabled">&larr; Previous</span>';
  let nextHtml = hasNext
    ? `<a href="${nextLink}">${nextLink.replace('.html', '')} &rarr;</a>`
    : '<span class="disabled">Next &rarr;</span>';

  const filterHtml = generateFilterBarHTML(anniversaryValues, minYear, maxYear);

  const body = `\
    <p class="explore-link"><a href="index.html">Browse all months</a> &middot; <a href="../week/index.html">Week view</a></p>
    <nav class="week-nav">${prevHtml}<span class="current">${label}</span>${nextHtml} <button id="today-btn">Today</button> <button id="week-btn">Week</button></nav>
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
      <p class="subtitle">${label}</p>
      <p class="explore-link"><a href="index.html">Browse all months</a> &middot; <a href="../week/index.html">Week view</a></p>
      <nav class="week-nav">${prevHtml}<span class="current">${label}</span>${nextHtml} <button id="today-btn">Today</button> <button id="week-btn">Week</button></nav>
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

  function cardHtml(m){
    var pu = m.po ? 'https://image.tmdb.org/t/p/w92'+m.po : '';
    var tu = 'https://www.themoviedb.org/movie/'+m.id;
    var iu = m.im ? 'https://www.imdb.com/title/'+m.im : '';
    var lu = 'https://letterboxd.com/tmdb/'+m.id+'/';
    var links = '<a href="'+tu+'" target="_blank" rel="noopener">TMDB</a>'
      + (iu?' <a href="'+iu+'" target="_blank" rel="noopener">IMDb</a>':'')
      + ' <a href="'+lu+'" target="_blank" rel="noopener">LB</a>';
    var thumb = pu
      ? '<img src="'+pu+'" alt="'+esc(m.t)+'" class="cal-thumb" loading="lazy">'
      : '<div class="cal-thumb cal-thumb--missing"></div>';
    return '<a href="'+tu+'" target="_blank" rel="noopener" class="cal-thumb-link">'+thumb+'</a>'
      + '<div class="cal-info">'
      + '<div class="cal-title"><a href="'+tu+'" target="_blank" rel="noopener">'+esc(m.t)+'</a></div>'
      + '<div class="cal-anni">'+m.y+' years</div>'
      + '<div class="cal-links">'+links+'</div>'
      + '</div>';
  }

  function render(){
    var ratingVal = parseFloat(document.getElementById('rating-filter').value) || 0;
    var anniCbs = document.querySelectorAll('.anni-cb:checked');
    var anniVals = Array.from(anniCbs).map(function(cb){ return parseInt(cb.value); });
    var yearMin = parseInt(document.getElementById('year-min').value) || 0;
    var yearMax = parseInt(document.getElementById('year-max').value) || 9999;
    var sortBy = document.getElementById('sort-select').value;
    var fld = sortBy === 'rating' ? 'v' : 'p';
    var vis = 0;

    for(var d=1; d<=D.dim; d++){
      var arr = D.data[d] || [];
      var f = arr.filter(function(m){
        if((m.v||0) < ratingVal) return false;
        if(anniVals.length && anniVals.indexOf(m.y)===-1) return false;
        var yr = parseInt(m.r) || 0;
        return yr >= yearMin && yr <= yearMax;
      });
      f.sort(function(a,b){ return (b[fld]||0) - (a[fld]||0); });
      var top = f[0] || null;
      var el = document.getElementById('cc'+d);
      if(!el) continue;
      if(top){
        vis++;
        el.innerHTML = cardHtml(top);
        el.style.display = 'flex';
      } else {
        el.innerHTML = '';
        el.style.display = 'none';
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

  function saveState(){
    var state = {
      rating: document.getElementById('rating-filter').value,
      anni: Array.from(document.querySelectorAll('.anni-cb')).map(function(cb){ return cb.checked; }),
      yearMin: document.getElementById('year-min').value,
      yearMax: document.getElementById('year-max').value,
      sort: document.getElementById('sort-select').value
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
  document.getElementById('reset-filters').addEventListener('click', function(){
    document.getElementById('rating-filter').value = '0';
    document.querySelectorAll('.anni-cb').forEach(function(cb){ cb.checked = true; });
    document.getElementById('year-min').value = '';
    document.getElementById('year-max').value = '';
    document.getElementById('sort-select').value = 'popularity';
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

  const extra = `<p class="explore-link"><a href="../week/index.html">Week view</a></p>`;

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
  console.log(`  [INFO] Loaded ${movies.length} movies (fetched ${payload.fetchedAt})\n`);

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

  const builtWeeks = [];
  for (const w of weeksToBuild) {
    const monday = mondayOfISOWeek(w.year, w.week);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const dayMap = getAnniversaryMovies(movies, monday);
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

  const TODAY_DIR = path.join(DOCS_DIR, 'today');
  if (!fs.existsSync(TODAY_DIR)) fs.mkdirSync(TODAY_DIR, { recursive: true });
  fs.writeFileSync(path.join(TODAY_DIR, 'index.html'), generateTodayPage(), 'utf8');
  console.log('  [OK]   today/index.html written');

  // Build month pages
  if (!singleWeek) {
    const now = new Date();
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

      const html = generateMonthPage(m.year, m.month, movies, hasPrev, hasNext, `${prevKey}.html`, `${nextKey}.html`);
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
