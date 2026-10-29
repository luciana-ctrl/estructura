import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HttpError } from './util.js';
import { getHotel } from './services.js';

const MAX_BYTES = 1024 * 1024; // 1 MB
// SVG no se acepta: puede llevar scripts y se serviría desde nuestro dominio
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Comprueba la firma real del archivo, no solo lo que dice el navegador */
function sniff(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function removeLocal(dir, url) {
  if (!url?.startsWith('/logos/')) return;
  try {
    unlinkSync(join(dir, basename(url)));
  } catch {
    /* ya no existía */
  }
}

/**
 * Guarda el logo subido desde el panel (data URL en base64) y lo asigna al hotel.
 * El nombre lleva la fecha para que los navegadores no muestren el logo viejo en caché.
 */
export function saveLogo(db, dir, hotelId, dataUrl) {
  const hotel = getHotel(db, hotelId);
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new HttpError(400, 'Envía la imagen como data URL en base64');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new HttpError(400, 'La imagen está vacía');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'El logo no puede pesar más de 1 MB');
  const type = sniff(buf);
  if (!type || !TYPES[type]) throw new HttpError(400, 'Formato no admitido: usa PNG, JPG o WebP');

  mkdirSync(dir, { recursive: true });
  const file = `${hotel.id}-${Date.now()}.${TYPES[type]}`;
  writeFileSync(join(dir, file), buf);
  removeLocal(dir, hotel.logo_url);
  db.prepare('UPDATE hotels SET logo_url = ? WHERE id = ?').run(`/logos/${file}`, hotel.id);
  return getHotel(db, hotel.id);
}

export function deleteLogo(db, dir, hotelId) {
  const hotel = getHotel(db, hotelId);
  removeLocal(dir, hotel.logo_url);
  db.prepare('UPDATE hotels SET logo_url = NULL WHERE id = ?').run(hotel.id);
  return getHotel(db, hotel.id);
}
