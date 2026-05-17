import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

export const TMDB_BASE = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const POSTER_SIZE = 'w342';
export const REQUEST_DELAY_MS = 280;
export const ALGORITHM = 'aes-256-cbc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export function loadEnv() {
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

export function getEnv(name) {
  const val = process.env[name];
  if (!val || val.startsWith('your_')) {
    console.error(`  [ERR]  ${name} is not set in .env`);
    process.exit(1);
  }
  return val;
}

function deriveKey(passphrase) {
  return crypto.scryptSync(passphrase, 'movie-anniversary-salt', 32);
}

export function decrypt(data, passphrase) {
  const key = deriveKey(passphrase);
  const parts = data.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const enc = parts.join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return JSON.parse(dec);
}

export function encrypt(data, passphrase) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

export async function tmdbFetch(pathname, params = {}, retries = 3) {
  const token = getEnv('TMDB_TOKEN');
  const url = new URL(`${TMDB_BASE}${pathname}`);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res.json();
    if (attempt < retries) {
      const wait = Math.min(1000 * Math.pow(2, attempt), 8000);
      console.error(`    [RETRY] TMDB ${res.status} for ${pathname} (attempt ${attempt}/${retries}, waiting ${wait}ms)`);
      await new Promise(r => setTimeout(r, wait));
    } else {
      const text = await res.text();
      throw new Error(`TMDB ${res.status} for ${pathname}: ${text}`);
    }
  }
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function posterUrl(posterPath) {
  if (!posterPath) return '';
  return `${IMAGE_BASE}/${POSTER_SIZE}${posterPath}`;
}

export function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
  return { year: d.getFullYear(), week: weekNum };
}

export function mondayOfISOWeek(year, week) {
  const jan4 = new Date(year, 0, 4);
  const dayOffset = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dayOffset);
  const target = new Date(week1Monday);
  target.setDate(week1Monday.getDate() + (week - 1) * 7);
  target.setHours(0, 0, 0, 0);
  return target;
}

export function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDayHeader(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function isoWeekLabel(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function weeksInYear(year) {
  const dec28 = new Date(year, 11, 28);
  return getISOWeek(dec28).week;
}

export function getPrevWeek(year, week) {
  if (week > 1) return { year, week: week - 1 };
  return { year: year - 1, week: weeksInYear(year - 1) };
}

export function getNextWeek(year, week) {
  const maxWeek = weeksInYear(year);
  if (week < maxWeek) return { year, week: week + 1 };
  return { year: year + 1, week: 1 };
}

export function isAnniversaryOnDate(movie, date) {
  if (!movie.release_date) return null;
  const parts = movie.release_date.split('-');
  if (parts.length !== 3) return null;
  const [releaseYear, releaseMonth, releaseDay] = parts.map(Number);

  const dateYear = date.getFullYear();
  const dateMonth = date.getMonth();
  const dateDay = date.getDate();

  let match = false;
  if (releaseMonth === 2 && releaseDay === 29) {
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

export function tmdbMovieUrl(id) {
  return `https://www.themoviedb.org/movie/${id}`;
}

export function letterboxdUrl(id) {
  return `https://letterboxd.com/tmdb/${id}/`;
}

export function imdbUrl(imdbId) {
  return imdbId ? `https://www.imdb.com/title/${imdbId}` : null;
}
