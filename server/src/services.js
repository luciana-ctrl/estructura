import {
  HttpError,
  EMAIL_RE,
  isIsoDate,
  localDate,
  nowIso,
  parseJson,
  slugify,
  todayIn,
  weekday,
} from './util.js';
import { tx } from './db.js';

export const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];

export const REJECTION_REASONS = [
  { key: 'sin_disponibilidad', label: 'Sin disponibilidad en esas fechas' },
  { key: 'datos_incompletos', label: 'Datos del huésped incompletos o inválidos' },
  { key: 'habitacion_no_disponible', label: 'Tipo de habitación no disponible' },
  { key: 'duplicada', label: 'Solicitud duplicada' },
  { key: 'otro', label: 'Otro' },
];

const REASON_KEYS = new Set(REJECTION_REASONS.map((r) => r.key));

// ---------------------------------------------------------------- hoteles

function rowToHotel(r) {
  if (!r) return null;
  return { ...r, room_types: parseJson(r.room_types, []) };
}

export function listHotels(db) {
  return db.prepare('SELECT * FROM hotels ORDER BY name').all().map(rowToHotel);
}

export function getHotel(db, id) {
  const hotel = rowToHotel(db.prepare('SELECT * FROM hotels WHERE id = ?').get(id));
  if (!hotel) throw new HttpError(404, 'Hotel no encontrado');
  return hotel;
}

function cleanHotelInput(body, partial) {
  const out = {};
  if (body.name !== undefined || !partial) {
    if (!body.name || typeof body.name !== 'string') throw new HttpError(400, 'El nombre del hotel es obligatorio');
    out.name = body.name.trim();
  }
  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone });
    } catch {
      throw new HttpError(400, 'Zona horaria inválida');
    }
    out.timezone = body.timezone;
  }
  if (body.room_types !== undefined) {
    if (!Array.isArray(body.room_types)) throw new HttpError(400, 'room_types debe ser una lista');
    out.room_types = JSON.stringify(body.room_types.map((s) => String(s).trim()).filter(Boolean));
  }
  if (body.assign_by !== undefined) {
    if (!['check_in', 'created'].includes(body.assign_by)) throw new HttpError(400, 'assign_by debe ser check_in o created');
    out.assign_by = body.assign_by;
  }
  if (body.welcome_message !== undefined) out.welcome_message = body.welcome_message ? String(body.welcome_message) : null;
  if (body.logo_url !== undefined) {
    const url = body.logo_url ? String(body.logo_url).trim() : '';
    if (url && !/^https?:\/\/\S+$/i.test(url) && !/^\/logos\/[\w.-]+$/.test(url)) {
      throw new HttpError(400, 'El logo debe ser una dirección que empiece por https://');
    }
    out.logo_url = url || null;
  }
  if (body.primary_color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.primary_color)) throw new HttpError(400, 'Color inválido, usa #RRGGBB');
    out.primary_color = body.primary_color;
  }
  return out;
}

export function createHotel(db, body) {
  const data = cleanHotelInput(body, false);
  const id = body.id ? slugify(body.id) : slugify(data.name);
  if (!id) throw new HttpError(400, 'No se pudo generar el id del hotel');
  if (db.prepare('SELECT 1 FROM hotels WHERE id = ?').get(id)) throw new HttpError(409, `Ya existe un hotel con id "${id}"`);
  const row = { timezone: 'America/Argentina/Buenos_Aires', room_types: '[]', assign_by: 'check_in', primary_color: '#2f6bff', welcome_message: null, logo_url: null, ...data };
  db.prepare(
    `INSERT INTO hotels (id, name, timezone, room_types, assign_by, welcome_message, primary_color, logo_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, row.name, row.timezone, row.room_types, row.assign_by, row.welcome_message, row.primary_color, row.logo_url, nowIso());
  return getHotel(db, id);
}

export function updateHotel(db, id, body) {
  getHotel(db, id);
  const data = cleanHotelInput(body, true);
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE hotels SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => data[k]), id);
  }
  return getHotel(db, id);
}

/** Lo que el widget necesita saber del hotel (sin datos internos) */
export function publicHotelConfig(db, id) {
  const h = getHotel(db, id);
  return { id: h.id, name: h.name, primary_color: h.primary_color, welcome_message: h.welcome_message, logo_url: h.logo_url };
}

/** Datos públicos para la web de demo: habitaciones y extras activos (lo mismo que el chat ofrece) */
export function publicHotelSite(db, id) {
  const h = getHotel(db, id);
  const extras = db
    .prepare('SELECT name, price, condition_text FROM extras WHERE hotel_id = ? AND active = 1 ORDER BY sort, id')
    .all(h.id);
  return { ...publicHotelConfig(db, id), room_types: h.room_types, extras };
}

export function listPublicHotels(db) {
  return db.prepare('SELECT id, name FROM hotels ORDER BY name').all();
}

// ---------------------------------------------------------------- extras (Knowledge)

function rowToExtra(r) {
  return r && { ...r, active: Boolean(r.active) };
}

export function listExtras(db, hotelId, { onlyActive = false } = {}) {
  const sql = `SELECT * FROM extras WHERE hotel_id = ? ${onlyActive ? 'AND active = 1' : ''} ORDER BY sort, id`;
  return db.prepare(sql).all(hotelId).map(rowToExtra);
}

function cleanExtra(body, partial) {
  const out = {};
  if (body.name !== undefined || !partial) {
    if (!body.name) throw new HttpError(400, 'El extra necesita un nombre');
    out.name = String(body.name).trim();
  }
  for (const k of ['price', 'offer_text', 'condition_text']) {
    if (body[k] !== undefined) out[k] = body[k] ? String(body[k]).trim() : null;
  }
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (body.sort !== undefined) out.sort = Number(body.sort) || 0;
  return out;
}

export function createExtra(db, hotelId, body) {
  getHotel(db, hotelId);
  const data = cleanExtra(body, false);
  const key = slugify(body.key || data.name);
  if (db.prepare('SELECT 1 FROM extras WHERE hotel_id = ? AND key = ?').get(hotelId, key)) {
    throw new HttpError(409, `Ya existe un extra "${key}" en este hotel`);
  }
  const res = db
    .prepare(
      `INSERT INTO extras (hotel_id, key, name, price, offer_text, condition_text, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(hotelId, key, data.name, data.price ?? null, data.offer_text ?? null, data.condition_text ?? null, data.active ?? 1, data.sort ?? 0);
  return rowToExtra(db.prepare('SELECT * FROM extras WHERE id = ?').get(res.lastInsertRowid));
}

export function updateExtra(db, hotelId, extraId, body) {
  const existing = db.prepare('SELECT * FROM extras WHERE id = ? AND hotel_id = ?').get(extraId, hotelId);
  if (!existing) throw new HttpError(404, 'Extra no encontrado');
  const data = cleanExtra(body, true);
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE extras SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => data[k]), extraId);
  }
  return rowToExtra(db.prepare('SELECT * FROM extras WHERE id = ?').get(extraId));
}

export function deleteExtra(db, hotelId, extraId) {
  const res = db.prepare('DELETE FROM extras WHERE id = ? AND hotel_id = ?').run(extraId, hotelId);
  if (!res.changes) throw new HttpError(404, 'Extra no encontrado');
}

// ---------------------------------------------------------------- encargados

function rowToStaff(r) {
  return r && { ...r, weekdays: parseJson(r.weekdays, []), active: Boolean(r.active) };
}

export function listStaff(db, hotelId) {
  return db.prepare('SELECT * FROM staff WHERE hotel_id = ? ORDER BY name').all(hotelId).map(rowToStaff);
}

function cleanStaff(body, partial) {
  const out = {};
  if (body.name !== undefined || !partial) {
    if (!body.name) throw new HttpError(400, 'El encargado necesita un nombre');
    out.name = String(body.name).trim();
  }
  if (body.email !== undefined) {
    if (body.email && !EMAIL_RE.test(body.email)) throw new HttpError(400, 'Email del encargado inválido');
    out.email = body.email || null;
  }
  if (body.phone !== undefined) out.phone = body.phone || null;
  if (body.weekdays !== undefined) {
    if (!Array.isArray(body.weekdays) || body.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new HttpError(400, 'weekdays debe ser una lista de números 0-6 (0 = domingo)');
    }
    out.weekdays = JSON.stringify([...new Set(body.weekdays)].sort());
  }
  for (const k of ['date_from', 'date_to']) {
    if (body[k] !== undefined) {
      if (body[k] && !isIsoDate(body[k])) throw new HttpError(400, `${k} debe tener formato YYYY-MM-DD`);
      out[k] = body[k] || null;
    }
  }
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return out;
}

export function createStaff(db, hotelId, body) {
  getHotel(db, hotelId);
  const d = cleanStaff(body, false);
  const res = db
    .prepare(
      `INSERT INTO staff (hotel_id, name, email, phone, weekdays, date_from, date_to, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(hotelId, d.name, d.email ?? null, d.phone ?? null, d.weekdays ?? '[0,1,2,3,4,5,6]', d.date_from ?? null, d.date_to ?? null, d.active ?? 1);
  return rowToStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(res.lastInsertRowid));
}

export function updateStaff(db, hotelId, staffId, body) {
  if (!db.prepare('SELECT 1 FROM staff WHERE id = ? AND hotel_id = ?').get(staffId, hotelId)) throw new HttpError(404, 'Encargado no encontrado');
  const d = cleanStaff(body, true);
  const keys = Object.keys(d);
  if (keys.length) {
    db.prepare(`UPDATE staff SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => d[k]), staffId);
  }
  return rowToStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId));
}

export function deleteStaff(db, hotelId, staffId) {
  const res = db.prepare('DELETE FROM staff WHERE id = ? AND hotel_id = ?').run(staffId, hotelId);
  if (!res.changes) throw new HttpError(404, 'Encargado no encontrado');
}

/**
 * Encargados que deben recibir la solicitud.
 * Según el hotel, el día que cuenta es la fecha de llegada (check_in) o el día en que llega la solicitud (created).
 * Si nadie cubre ese día, se avisa a todos los encargados activos para que la solicitud no quede huérfana.
 */
export function staffOnDuty(db, hotel, { checkIn, createdDate }) {
  const day = hotel.assign_by === 'created' ? createdDate : checkIn;
  const wd = weekday(day);
  const active = listStaff(db, hotel.id).filter((s) => s.active);
  const onDuty = active.filter(
    (s) => s.weekdays.includes(wd) && (!s.date_from || s.date_from <= day) && (!s.date_to || s.date_to >= day)
  );
  return { day, staff: onDuty.length ? onDuty : active, fallback: onDuty.length === 0 };
}

// ---------------------------------------------------------------- solicitudes

function rowToRequest(r) {
  if (!r) return null;
  return {
    ...r,
    extras: parseJson(r.extras, []),
    extras_offered: parseJson(r.extras_offered, []),
    assigned_staff: parseJson(r.assigned_staff, []),
  };
}

/**
 * Crea una solicitud manual (desde el chatbot, el panel o un chatbot externo vía API).
 * Valida los datos, toma una foto de los extras aceptados y avisa a los encargados de ese día.
 */
export function createRequest(db, body, { notifier } = {}) {
  const hotel = getHotel(db, body.hotel_id);
  const errors = [];
  if (!isIsoDate(body.check_in)) errors.push('check_in debe tener formato YYYY-MM-DD');
  if (!isIsoDate(body.check_out)) errors.push('check_out debe tener formato YYYY-MM-DD');
  if (!errors.length && body.check_out <= body.check_in) errors.push('check_out debe ser posterior a check_in');
  const guests = Number(body.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > 50) errors.push('guests debe ser un número entre 1 y 50');
  if (!body.guest_name || String(body.guest_name).trim().length < 2) errors.push('guest_name es obligatorio');
  if (!body.guest_email && !body.guest_phone) errors.push('Hace falta email o teléfono del huésped');
  if (body.guest_email && !EMAIL_RE.test(body.guest_email)) errors.push('guest_email inválido');
  const source = body.source ?? 'chat';
  if (!['chat', 'manual'].includes(source)) errors.push('source debe ser chat o manual');
  const device = body.device ?? null;
  if (device && !['mobile', 'desktop'].includes(device)) errors.push('device debe ser mobile o desktop');

  const hotelExtras = listExtras(db, hotel.id);
  const byKey = new Map(hotelExtras.map((e) => [e.key, e]));
  const extraKeys = Array.isArray(body.extras) ? body.extras.map((e) => (typeof e === 'string' ? e : e?.key)) : [];
  const unknown = extraKeys.filter((k) => !byKey.has(k));
  if (unknown.length) errors.push(`Extras desconocidos para este hotel: ${unknown.join(', ')}`);
  if (errors.length) throw new HttpError(400, 'Datos de la solicitud inválidos', errors);

  const extras = extraKeys.map((k) => ({ key: k, name: byKey.get(k).name, price: byKey.get(k).price }));
  const offered = Array.isArray(body.extras_offered) ? body.extras_offered.filter((k) => byKey.has(k)) : [];
  const createdAt = nowIso();
  const { staff } = staffOnDuty(db, hotel, { checkIn: body.check_in, createdDate: localDate(new Date(createdAt), hotel.timezone) });

  const id = tx(db, () => {
    const res = db
      .prepare(
        `INSERT INTO requests (hotel_id, status, source, device, check_in, check_out, guests, room_type,
           guest_name, guest_email, guest_phone, notes, extras, extras_offered, assigned_staff, conversation_id, created_at)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hotel.id,
        source,
        device,
        body.check_in,
        body.check_out,
        guests,
        body.room_type || null,
        String(body.guest_name).trim(),
        body.guest_email || null,
        body.guest_phone || null,
        body.notes || null,
        JSON.stringify(extras),
        JSON.stringify([...new Set([...offered, ...extraKeys])]),
        JSON.stringify(staff.map((s) => s.id)),
        body.conversation_id || null,
        createdAt
      );
    const newId = Number(res.lastInsertRowid);
    const ins = db.prepare('INSERT INTO notifications (request_id, staff_id, channel, created_at) VALUES (?, ?, ?, ?)');
    for (const s of staff) ins.run(newId, s.id, 'panel', createdAt);
    return newId;
  });

  const request = getRequest(db, id);
  notifier?.requestCreated({ hotel, request, staff });
  return request;
}

export function getRequest(db, id) {
  const r = rowToRequest(db.prepare('SELECT * FROM requests WHERE id = ?').get(id));
  if (!r) throw new HttpError(404, 'Solicitud no encontrada');
  return r;
}

/** Solicitud + nombres de encargados + conversación del chat (para el detalle en el panel) */
export function getRequestDetail(db, id) {
  const r = getRequest(db, id);
  const staff = r.assigned_staff.length
    ? db.prepare(`SELECT id, name, email FROM staff WHERE id IN (${r.assigned_staff.map(() => '?').join(',')})`).all(...r.assigned_staff)
    : [];
  const conv = r.conversation_id ? db.prepare('SELECT messages FROM conversations WHERE id = ?').get(r.conversation_id) : null;
  return { ...r, assigned_staff_detail: staff, conversation: conv ? parseJson(conv.messages, []) : [] };
}

export function listRequests(db, q = {}) {
  const where = [];
  const args = [];
  if (q.hotelId) (where.push('hotel_id = ?'), args.push(q.hotelId));
  if (q.status) {
    const statuses = String(q.status).split(',').filter((s) => STATUSES.includes(s));
    if (statuses.length) (where.push(`status IN (${statuses.map(() => '?').join(',')})`), args.push(...statuses));
  }
  if (q.reason) (where.push('reject_reason = ?'), args.push(q.reason));
  if (q.source) (where.push('source = ?'), args.push(q.source));
  if (q.from) (where.push('check_in >= ?'), args.push(q.from));
  if (q.to) (where.push('check_in <= ?'), args.push(q.to));
  if (q.search) {
    where.push('(guest_name LIKE ? OR guest_email LIKE ? OR guest_phone LIKE ?)');
    const s = `%${q.search}%`;
    args.push(s, s, s);
  }
  const order = q.status === 'pending' ? 'check_in ASC, id ASC' : 'created_at DESC';
  const limit = Math.min(Number(q.limit) || 200, 500);
  const sql = `SELECT * FROM requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${limit}`;
  return db.prepare(sql).all(...args).map(rowToRequest);
}

function decide(db, id, allowedFrom, set) {
  const r = getRequest(db, id);
  if (!allowedFrom.includes(r.status)) {
    throw new HttpError(409, `No se puede hacer esto con una solicitud en estado "${r.status}"`);
  }
  const keys = Object.keys(set);
  db.prepare(`UPDATE requests SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), id);
  return getRequest(db, id);
}

export function confirmRequest(db, id, { by } = {}, { notifier } = {}) {
  const r = decide(db, id, ['pending'], { status: 'confirmed', decided_at: nowIso(), decided_by: by || null, reject_reason: null, reject_note: null });
  notifier?.requestDecided({ request: r });
  return r;
}

export function rejectRequest(db, id, { reason, note, by } = {}, { notifier } = {}) {
  if (!REASON_KEYS.has(reason)) throw new HttpError(400, 'Elige un motivo de rechazo válido');
  if (reason === 'otro' && !note) throw new HttpError(400, 'Con el motivo "Otro" hace falta una nota');
  const r = decide(db, id, ['pending'], { status: 'rejected', reject_reason: reason, reject_note: note || null, decided_at: nowIso(), decided_by: by || null });
  notifier?.requestDecided({ request: r });
  return r;
}

export function reopenRequest(db, id) {
  return decide(db, id, ['rejected', 'cancelled'], { status: 'pending', reject_reason: null, reject_note: null, decided_at: null, decided_by: null });
}

export function cancelRequest(db, id, { by } = {}) {
  return decide(db, id, ['confirmed'], { status: 'cancelled', decided_at: nowIso(), decided_by: by || null });
}

export function pendingCounts(db) {
  const rows = db.prepare("SELECT hotel_id, COUNT(*) AS n FROM requests WHERE status = 'pending' GROUP BY hotel_id").all();
  return Object.fromEntries(rows.map((r) => [r.hotel_id, r.n]));
}

// ---------------------------------------------------------------- analítica

/**
 * Métricas de reservas por chat.
 * Filtros: hotelId, from/to (YYYY-MM-DD, fecha local del hotel), dateField ('created' | 'check_in'), device, source.
 */
export function analytics(db, q = {}) {
  const hotels = q.hotelId ? [getHotel(db, q.hotelId)] : listHotels(db);
  const tzOf = new Map(hotels.map((h) => [h.id, h.timezone]));
  const nameOf = new Map(hotels.map((h) => [h.id, h.name]));
  const dateField = q.dateField === 'check_in' ? 'check_in' : 'created';
  const inRange = (d) => (!q.from || d >= q.from) && (!q.to || d <= q.to);

  const rows = db
    .prepare(`SELECT * FROM requests ${q.hotelId ? 'WHERE hotel_id = ?' : ''}`)
    .all(...(q.hotelId ? [q.hotelId] : []))
    .map(rowToRequest)
    .map((r) => ({ ...r, created_local: localDate(new Date(r.created_at), tzOf.get(r.hotel_id) ?? 'UTC') }))
    .filter((r) => inRange(dateField === 'created' ? r.created_local : r.check_in))
    .filter((r) => !q.device || r.device === q.device)
    .filter((r) => !q.source || r.source === q.source);

  const conversations = db
    .prepare(`SELECT hotel_id, device, created_at, request_id FROM conversations WHERE channel = 'web' ${q.hotelId ? 'AND hotel_id = ?' : ''}`)
    .all(...(q.hotelId ? [q.hotelId] : []))
    .filter((c) => inRange(localDate(new Date(c.created_at), tzOf.get(c.hotel_id) ?? 'UTC')))
    .filter((c) => !q.device || c.device === q.device);

  const count = (arr, pred) => arr.filter(pred).length;
  const totals = Object.fromEntries(STATUSES.map((s) => [s, count(rows, (r) => r.status === s)]));
  const decided = totals.confirmed + totals.rejected;

  const responseHours = rows
    .filter((r) => r.decided_at && (r.status === 'confirmed' || r.status === 'rejected'))
    .map((r) => (Date.parse(r.decided_at) - Date.parse(r.created_at)) / 36e5);

  const byDay = new Map();
  for (const r of rows) {
    const d = dateField === 'created' ? r.created_local : r.check_in;
    const e = byDay.get(d) ?? { date: d, total: 0, pending: 0, confirmed: 0, rejected: 0, cancelled: 0 };
    e.total += 1;
    e[r.status] += 1;
    byDay.set(d, e);
  }

  const reasons = REJECTION_REASONS.map((x) => ({ ...x, count: count(rows, (r) => r.reject_reason === x.key) })).filter((x) => x.count);

  const extrasMap = new Map();
  const extraNames = new Map(
    db.prepare(`SELECT key, name FROM extras ${q.hotelId ? 'WHERE hotel_id = ?' : ''}`).all(...(q.hotelId ? [q.hotelId] : [])).map((e) => [e.key, e.name])
  );
  for (const r of rows) {
    for (const k of r.extras_offered) {
      const e = extrasMap.get(k) ?? { key: k, name: extraNames.get(k) ?? k, offered: 0, accepted: 0 };
      e.offered += 1;
      extrasMap.set(k, e);
    }
    for (const x of r.extras) {
      const e = extrasMap.get(x.key) ?? { key: x.key, name: x.name, offered: 0, accepted: 0 };
      e.accepted += 1;
      extrasMap.set(x.key, e);
    }
  }

  const group = (keyFn, labelFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const e = m.get(k) ?? { key: k, label: labelFn(k), total: 0, confirmed: 0, rejected: 0, pending: 0 };
      e.total += 1;
      if (e[r.status] !== undefined) e[r.status] += 1;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  return {
    filters: { ...q, dateField },
    totals: { requests: rows.length, ...totals },
    confirmationRate: decided ? totals.confirmed / decided : null,
    avgResponseHours: responseHours.length ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length : null,
    funnel: {
      conversations: conversations.length,
      chatRequests: count(rows, (r) => r.source === 'chat'),
      confirmed: count(rows, (r) => r.source === 'chat' && r.status === 'confirmed'),
    },
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byReason: reasons,
    extras: [...extrasMap.values()].sort((a, b) => b.offered - a.offered),
    byHotel: group((r) => r.hotel_id, (k) => nameOf.get(k) ?? k),
    byDevice: group((r) => r.device ?? 'desconocido', (k) => ({ mobile: 'Móvil', desktop: 'Escritorio' })[k] ?? 'Sin dato'),
    bySource: group((r) => r.source, (k) => ({ chat: 'Chatbot', manual: 'Manual (panel)' })[k] ?? k),
    today: hotels[0] ? todayIn(hotels[0].timezone) : null,
  };
}
