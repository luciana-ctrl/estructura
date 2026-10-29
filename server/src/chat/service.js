import { randomUUID } from 'node:crypto';
import * as engine from './engine.js';
import { createRequest, getHotel, listExtras } from '../services.js';
import { HttpError, nowIso, parseJson, todayIn } from '../util.js';

const MAX_MESSAGES = 200;

function context(db, hotelId) {
  const hotel = getHotel(db, hotelId);
  return { hotel, extras: listExtras(db, hotelId, { onlyActive: true }), today: todayIn(hotel.timezone) };
}

function save(db, conv, state, messages, requestId) {
  db.prepare('UPDATE conversations SET state = ?, messages = ?, request_id = COALESCE(?, request_id), updated_at = ? WHERE id = ?').run(
    JSON.stringify(state),
    JSON.stringify(messages.slice(-MAX_MESSAGES)),
    requestId ?? null,
    nowIso(),
    conv.id
  );
}

const stamp = (from, reply) => ({ from, ...reply, at: nowIso() });

/**
 * Un turno del chat.
 * Sin conversationId (o con uno que no existe) arranca una conversación nueva.
 */
export function handleChat(db, { hotelId, conversationId, message, device }, { notifier } = {}) {
  if (!hotelId) throw new HttpError(400, 'Falta hotelId');
  const ctx = context(db, hotelId);
  const dev = ['mobile', 'desktop'].includes(device) ? device : null;

  let conv = conversationId ? db.prepare('SELECT * FROM conversations WHERE id = ? AND hotel_id = ?').get(conversationId, hotelId) : null;

  if (!conv) {
    const id = randomUUID();
    const now = nowIso();
    const { state, replies } = engine.start(ctx);
    const messages = replies.map((r) => stamp('bot', r));
    db.prepare('INSERT INTO conversations (id, hotel_id, device, state, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      hotelId,
      dev,
      JSON.stringify(state),
      JSON.stringify(messages),
      now,
      now
    );
    return { conversationId: id, replies: messages, step: state.step };
  }

  const text = String(message ?? '').slice(0, 1000);
  let messages = parseJson(conv.messages, []);
  let { state, replies, action } = engine.step(parseJson(conv.state, {}), text, ctx);
  if (text.trim()) messages.push(stamp('guest', { text }));

  let requestId = null;
  if (action?.type === 'create_request') {
    try {
      const request = createRequest(
        db,
        { ...action.payload, hotel_id: hotelId, source: 'chat', device: conv.device ?? dev, conversation_id: conv.id },
        { notifier }
      );
      requestId = request.id;
      ({ state, replies } = engine.sent(state, request));
    } catch (err) {
      const detail = err.details?.join(' · ') ?? err.message;
      state = { ...state, step: 'summary' };
      replies = [{ text: `No pude enviar la solicitud: ${detail}. Puedes corregir los datos o intentarlo de nuevo.`, options: ['Enviar solicitud', 'Corregir datos'] }];
    }
  }

  const stamped = replies.map((r) => stamp('bot', r));
  messages = [...messages, ...stamped];
  save(db, conv, state, messages, requestId);
  return { conversationId: conv.id, replies: stamped, step: state.step, requestId: requestId ?? undefined };
}

/** Historial para que el widget restaure la conversación (p. ej. al cambiar de página) */
export function getConversation(db, hotelId, id) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND hotel_id = ?').get(id, hotelId);
  if (!conv) throw new HttpError(404, 'Conversación no encontrada');
  const state = parseJson(conv.state, {});
  return { conversationId: conv.id, messages: parseJson(conv.messages, []), step: state.step };
}
