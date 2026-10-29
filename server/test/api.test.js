import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedIfEmpty } from '../src/seed.js';
import { addDays, todayIn, weekday } from '../src/util.js';

let server;
let base;
const events = [];
const notifier = {
  requestCreated: (e) => events.push(['created', e]),
  requestDecided: (e) => events.push(['decided', e]),
};

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db, { withRequests: false });
  server = createServer(createApp({ db, notifier, panelToken: 'secreto' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const auth = { authorization: 'Bearer secreto' };

test('la API del panel exige token; el widget no', async () => {
  assert.equal((await call('GET', '/api/hotels')).status, 401);
  assert.equal((await call('GET', '/api/hotels', undefined, { authorization: 'Bearer otro' })).status, 401);
  assert.equal((await call('GET', '/api/hotels', undefined, auth)).status, 200);
  const pub = await call('GET', '/api/public/hotels/hotel-mirador');
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.body).sort(), ['id', 'name', 'primary_color', 'welcome_message']);
});

test('conversación por el widget crea una solicitud pendiente asignada a los encargados de ese día', async () => {
  const today = todayIn('America/Argentina/Buenos_Aires');
  // Próximo sábado: en el Mirador lo cubre Luis (sábado y domingo)
  let checkIn = addDays(today, 7);
  while (weekday(checkIn) !== 6) checkIn = addDays(checkIn, 1);

  let r = await call('POST', '/api/chat', { hotelId: 'hotel-mirador', device: 'mobile' });
  assert.equal(r.status, 200);
  const conversationId = r.body.conversationId;
  assert.equal(r.body.replies.at(-1).input, 'date');

  const say = async (message) => (await call('POST', '/api/chat', { hotelId: 'hotel-mirador', conversationId, message })).body;
  for (const m of [checkIn, '2 noches', '2', 'Doble superior', 'Diego Fernández', 'diego@example.com', '+54 9 376 400 0000']) await say(m);
  let out = await say('sí');
  assert.match(out.replies.at(-1).text, /desayuno/i, 'ofrece el segundo extra activo');
  out = await say('no');
  out = await say('No, nada más');
  assert.match(out.replies.at(-1).text, /Revisa tu solicitud/);
  assert.ok(!/Late checkout/.test(out.replies.at(-1).text), 'los extras inactivos no se ofrecen');
  out = await say('Enviar solicitud');
  assert.ok(out.requestId, 'devuelve el id de la solicitud');
  assert.match(out.replies[0].text, new RegExp(`#${out.requestId}`));

  const detail = await call('GET', `/api/requests/${out.requestId}`, undefined, auth);
  assert.equal(detail.body.status, 'pending');
  assert.equal(detail.body.device, 'mobile');
  assert.equal(detail.body.source, 'chat');
  assert.deepEqual(detail.body.extras.map((e) => e.key), ['parking']);
  assert.deepEqual(detail.body.extras_offered, ['parking', 'desayuno']);
  assert.deepEqual(detail.body.assigned_staff_detail.map((s) => s.name), ['Luis Pereyra']);
  assert.ok(detail.body.conversation.length > 10, 'guarda la conversación');
  assert.equal(events.at(-1)[0], 'created');

  const restored = await call('GET', `/api/public/hotels/hotel-mirador/conversations/${conversationId}`);
  assert.equal(restored.body.step, 'sent');
});

test('crear manual, confirmar, rechazar con motivo y reabrir', async () => {
  const base = { hotel_id: 'hotel-mirador', check_in: '2030-03-10', check_out: '2030-03-12', guests: 2, guest_name: 'Sofía Romero', guest_email: 'sofia@example.com' };

  const bad = await call('POST', '/api/requests', { ...base, check_out: '2030-03-09', extras: ['jacuzzi'] }, auth);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.details.length, 2);

  const a = (await call('POST', '/api/requests', { ...base, extras: ['desayuno'] }, auth)).body;
  assert.equal(a.source, 'manual');
  assert.equal(a.status, 'pending');
  // 10/03/2030 es domingo → Luis
  assert.equal(a.assigned_staff.length, 1);

  const c = await call('POST', `/api/requests/${a.id}/confirm`, { by: 'Ana' }, auth);
  assert.equal(c.body.status, 'confirmed');
  assert.equal((await call('POST', `/api/requests/${a.id}/reject`, { reason: 'duplicada' }, auth)).status, 409, 'no se rechaza una ya confirmada');

  const b = (await call('POST', '/api/requests', base, auth)).body;
  assert.equal((await call('POST', `/api/requests/${b.id}/reject`, { reason: 'inventado' }, auth)).status, 400);
  assert.equal((await call('POST', `/api/requests/${b.id}/reject`, { reason: 'otro' }, auth)).status, 400, '"otro" exige nota');
  const rj = await call('POST', `/api/requests/${b.id}/reject`, { reason: 'sin_disponibilidad', by: 'Ana' }, auth);
  assert.equal(rj.body.status, 'rejected');

  const rejected = await call('GET', '/api/requests?hotelId=hotel-mirador&status=rejected&reason=sin_disponibilidad', undefined, auth);
  assert.deepEqual(rejected.body.map((r) => r.id), [b.id]);

  const reopened = await call('POST', `/api/requests/${b.id}/reopen`, {}, auth);
  assert.equal(reopened.body.status, 'pending');
  assert.equal(reopened.body.reject_reason, null);
});

test('Knowledge: el hotel configura sus extras y el chatbot los usa', async () => {
  const created = await call('POST', '/api/hotels/posada-del-rio/extras', { name: 'Parking', price: 'gratis', offer_text: '¿Vienes en coche? Tenemos parking gratis.' }, auth);
  assert.equal(created.status, 201);
  assert.equal(created.body.key, 'parking');
  assert.equal((await call('POST', '/api/hotels/posada-del-rio/extras', { name: 'Parking' }, auth)).status, 409);

  const first = await call('POST', '/api/chat', { hotelId: 'posada-del-rio' });
  const conversationId = first.body.conversationId;
  const say = async (message) => (await call('POST', '/api/chat', { hotelId: 'posada-del-rio', conversationId, message })).body;
  let out;
  for (const m of ['2030-05-01', '1 noche', '2', 'Cabaña', 'Ana', 'ana@test.com', 'Omitir', 'no']) out = await say(m);
  assert.equal(out.replies.at(-1).text, '¿Vienes en coche? Tenemos parking gratis.');

  await call('PUT', `/api/hotels/posada-del-rio/extras/${created.body.id}`, { active: false }, auth);
  const list = await call('GET', '/api/hotels/posada-del-rio/extras', undefined, auth);
  assert.equal(list.body.find((e) => e.key === 'parking').active, false);
});

test('analítica: totales, tasa de confirmación y filtros', async () => {
  const all = (await call('GET', '/api/analytics?hotelId=hotel-mirador', undefined, auth)).body;
  assert.ok(all.totals.requests >= 3);
  assert.equal(all.totals.requests, all.totals.pending + all.totals.confirmed + all.totals.rejected + all.totals.cancelled);
  assert.ok(all.funnel.conversations >= 1);
  assert.ok(all.extras.find((e) => e.key === 'parking').offered >= 1);

  const mobile = (await call('GET', '/api/analytics?hotelId=hotel-mirador&device=mobile', undefined, auth)).body;
  assert.equal(mobile.totals.requests, 1);
  const manual = (await call('GET', '/api/analytics?hotelId=hotel-mirador&source=manual', undefined, auth)).body;
  assert.equal(manual.totals.requests, all.totals.requests - 1);
  const future = (await call('GET', '/api/analytics?from=2099-01-01', undefined, auth)).body;
  assert.equal(future.totals.requests, 0);
  assert.equal(future.confirmationRate, null);
});

test('encargados: valida días y fechas', async () => {
  assert.equal((await call('POST', '/api/hotels/hotel-mirador/staff', { name: 'X', weekdays: [7] }, auth)).status, 400);
  assert.equal((await call('POST', '/api/hotels/hotel-mirador/staff', { name: 'X', date_from: '2026-13-01' }, auth)).status, 400);
  const s = await call('POST', '/api/hotels/hotel-mirador/staff', { name: 'Temporada alta', weekdays: [1], date_from: '2030-12-01', date_to: '2031-02-28' }, auth);
  assert.equal(s.status, 201);
  assert.deepEqual(s.body.weekdays, [1]);
});
