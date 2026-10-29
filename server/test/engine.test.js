import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/chat/engine.js';
import { parseUserDate } from '../src/util.js';

const ctx = {
  today: '2026-10-29',
  hotel: { name: 'Hotel Test', room_types: ['Doble', 'Suite'], welcome_message: null },
  extras: [
    { key: 'parking', name: 'Parking', price: '10 €', offer_text: '¿Vienes en coche? Te reservamos un puesto.' },
    { key: 'desayuno', name: 'Desayuno', price: null, offer_text: null },
  ],
};

function run(messages, c = ctx) {
  let { state, replies } = engine.start(c);
  let action;
  const transcript = [...replies];
  for (const m of messages) {
    ({ state, replies, action } = engine.step(state, m, c));
    transcript.push(...replies);
  }
  return { state, action, transcript, last: transcript.at(-1) };
}

test('parseUserDate entiende los formatos habituales', () => {
  const today = '2026-10-29';
  assert.equal(parseUserDate('2026-11-14', today), '2026-11-14');
  assert.equal(parseUserDate('14/11/2026', today), '2026-11-14');
  assert.equal(parseUserDate('14/11', today), '2026-11-14');
  assert.equal(parseUserDate('5/1', today), '2027-01-05'); // ya pasó este año → el próximo
  assert.equal(parseUserDate('14 de noviembre', today), '2026-11-14');
  assert.equal(parseUserDate('3 dic 2026', today), '2026-12-03');
  assert.equal(parseUserDate('mañana', today), '2026-10-30');
  assert.equal(parseUserDate('31/02/2026', today), null);
  assert.equal(parseUserDate('cualquier cosa', today), null);
});

test('flujo completo: recoge datos, ofrece extras y pide crear la solicitud', () => {
  const { action, transcript } = run([
    '14/11/2026',
    '3 noches',
    '2',
    'suite',
    'Martina López',
    'Martina@Example.com',
    'Omitir',
    'Sí, añadir', // parking
    'No, gracias', // desayuno
    'Llegamos tarde, 23 h',
    'Enviar solicitud',
  ]);
  assert.ok(transcript.some((r) => r.text === '¿Vienes en coche? Te reservamos un puesto.'), 'usa la frase del hotel');
  assert.ok(transcript.some((r) => r.text.startsWith('¿Quieres añadir desayuno')), 'frase por defecto si el hotel no puso una');
  assert.equal(action.type, 'create_request');
  assert.deepEqual(action.payload, {
    check_in: '2026-11-14',
    check_out: '2026-11-17',
    guests: 2,
    room_type: 'Suite',
    guest_name: 'Martina López',
    guest_email: 'martina@example.com',
    guest_phone: null,
    notes: 'Llegamos tarde, 23 h',
    extras: ['parking'],
    extras_offered: ['parking', 'desayuno'],
  });
});

test('rechaza fechas pasadas y salida anterior a la llegada', () => {
  let r = run(['01/10/2026']);
  assert.match(r.transcript.at(-2).text, /ya pasó/);
  r = run(['14/11/2026', '10/11/2026']);
  assert.match(r.transcript.at(-2).text, /después de la llegada/);
});

test('sin tipos de habitación ni extras, se salta esas preguntas', () => {
  const c = { ...ctx, hotel: { ...ctx.hotel, room_types: [] }, extras: [] };
  const { last } = run(['14/11/2026', '15/11/2026', '1', 'Ana', 'ana@test.com', '+54 376 4123456', 'No'], c);
  assert.ok(last.text.startsWith('Revisa tu solicitud'));
  assert.ok(!last.text.includes('Habitación'));
});

test('insiste con amabilidad si la respuesta al extra no es sí ni no', () => {
  const { last, state } = run(['14/11/2026', '1 noche', '2', 'Doble', 'Ana', 'ana@test.com', 'Omitir', 'quizás']);
  assert.equal(state.step, 'extras');
  assert.deepEqual(last.options, ['Sí, añadir', 'No, gracias']);
});

test('«Corregir datos» en el resumen vuelve a empezar', () => {
  const { state } = run(['14/11/2026', '1 noche', '2', 'Doble', 'Ana', 'ana@test.com', 'Omitir', 'no', 'no', 'No, nada más', 'Corregir datos']);
  assert.equal(state.step, 'check_in');
  assert.deepEqual(state.data, {});
});
