const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** "2026-11-14" → "14 nov" (+ año si no es el actual) */
export function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const year = y !== new Date().getFullYear() ? ` ${y}` : '';
  return `${d} ${MONTHS[m - 1]}${year}`;
}

export function nights(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
}

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

export const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);

export function hours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1).replace('.', ',')} h`;
}

export const todayIso = () => new Date().toLocaleDateString('en-CA');
export function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

export const STATUS_LABEL = { pending: 'Pendiente', confirmed: 'Confirmada', rejected: 'Rechazada', cancelled: 'Cancelada' };
export const SOURCE_LABEL = { chat: 'Chatbot', manual: 'Manual' };
export const DEVICE_LABEL = { mobile: 'Móvil', desktop: 'Escritorio' };

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
