export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const nowIso = () => new Date().toISOString();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** true si es una fecha real con formato YYYY-MM-DD */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del hotel */
export function todayIn(timeZone) {
  return localDate(new Date(), timeZone);
}

/** Fecha local (YYYY-MM-DD) de un instante, en la zona horaria dada */
export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
}

export function parseJson(text, fallback) {
  try {
    return text == null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const MONTHS_ES = ['jan', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_FULL_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-11-14" → "14 de noviembre de 2026" */
export function formatDateEs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS_FULL_ES[m - 1]} de ${y}`;
}

/**
 * Interpreta fechas escritas por un huésped.
 * Acepta: 2026-11-14 · 14/11/2026 · 14-11-26 · 14/11 · "14 de noviembre" · "14 nov 2026" · hoy · mañana · pasado mañana
 * Sin año → la próxima vez que caiga esa fecha a partir de hoy.
 */
export function parseUserDate(input, today) {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!text) return null;
  if (text === 'hoy') return today;
  if (text === 'manana') return addDays(today, 1);
  if (text === 'pasado manana') return addDays(today, 2);
  if (isIsoDate(text)) return text;

  let d;
  let m;
  let y;
  let match = text.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (match) {
    [, d, m, y] = match;
  } else {
    match = text.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?(?:\s*(?:de\s+)?(\d{4}))?$/);
    if (!match) return null;
    const monthIdx = monthIndex(match[2]);
    if (monthIdx < 0) return null;
    [d, m, y] = [match[1], String(monthIdx + 1), match[3]];
  }

  const day = Number(d);
  const month = Number(m);
  let year = y ? Number(y) : Number(today.slice(0, 4));
  if (y && y.length === 2) year += 2000;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isIsoDate(iso)) return null;
  if (!y && iso < today) return `${year + 1}${iso.slice(4)}`;
  return iso;
}

function monthIndex(word) {
  const w = word.slice(0, 3);
  const alt = { ene: 0, jan: 0, apr: 3, aug: 7, set: 8, dec: 11 };
  if (w in alt) return alt[w];
  return MONTHS_ES.indexOf(w);
}
