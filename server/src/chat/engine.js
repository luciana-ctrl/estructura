/**
 * Motor del chatbot de reservas.
 *
 * Es una máquina de estados pura: recibe el estado, el texto del huésped y el contexto del hotel,
 * y devuelve el estado nuevo, las respuestas del bot y (al final) una acción "create_request".
 * No toca la base de datos, así que se puede probar sola o reemplazar por un modelo de lenguaje
 * que devuelva las mismas acciones.
 *
 * Respuesta del bot: { text, options?: string[], input?: 'date' | 'email' | 'tel' | 'text', min?: 'YYYY-MM-DD' }
 */
import { EMAIL_RE, addDays, formatDateEs, nightsBetween, parseUserDate } from '../util.js';

const MAX_NIGHTS = 60;
const MAX_GUESTS = 20;

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿?.]/g, '')
    .trim();

const YES = /^(si|sí|s|claro|dale|ok|okay|vale|por favor|porfa|yes|quiero|me interesa|anadir|añadir|si,? anadir|si,? por favor)\b/;
const NO = /^(no|nop|nope|paso|sin|no gracias|no,? gracias|ninguno|nada)\b/;
const RESTART = /^(reiniciar|empezar de nuevo|nueva solicitud|nueva reserva|nueva|corregir datos|corregir)$/;

export function isYes(text) {
  return YES.test(norm(text));
}
export function isNo(text) {
  return NO.test(norm(text));
}

function freshState() {
  return { step: 'check_in', data: {}, offered: [], accepted: [], extraIdx: 0, requestId: null };
}

function askCheckIn(ctx) {
  return { text: '¿Qué día quieres llegar?', input: 'date', min: ctx.today };
}

function askCheckOut(state) {
  return {
    text: '¿Y qué día te vas? También puedes decirme cuántas noches, por ejemplo «3 noches».',
    input: 'date',
    min: addDays(state.data.check_in, 1),
    options: ['1 noche', '2 noches', '3 noches'],
  };
}

const askGuests = () => ({ text: '¿Cuántas personas se alojan?', options: ['1', '2', '3', '4'], input: 'text' });

function askRoomType(ctx) {
  return { text: '¿Qué tipo de habitación prefieres?', options: [...ctx.hotel.room_types, 'Me da igual'] };
}

const askName = () => ({ text: '¿A nombre de quién hacemos la solicitud?', input: 'text' });
const askEmail = () => ({ text: '¿Cuál es tu email? Te escribiremos ahí cuando el hotel confirme.', input: 'email' });
const askPhone = () => ({ text: '¿Nos dejas un teléfono de contacto? Es opcional.', input: 'tel', options: ['Omitir'] });
const askNotes = () => ({
  text: '¿Hay algo más que el hotel deba saber? Hora de llegada, cuna, alergias…',
  input: 'text',
  options: ['No, nada más'],
});

export function offerText(extra) {
  const base = extra.offer_text?.trim() || `¿Quieres añadir ${extra.name.toLowerCase()}${extra.price ? ` (${extra.price})` : ''}?`;
  return extra.condition_text ? `${base} ${extra.condition_text}.`.replace('..', '.') : base;
}

function askExtra(extra) {
  return { text: offerText(extra), options: ['Sí, añadir', 'No, gracias'] };
}

function summary(state, ctx) {
  const d = state.data;
  const nights = nightsBetween(d.check_in, d.check_out);
  const extras = state.accepted.map((k) => ctx.extras.find((e) => e.key === k)?.name).filter(Boolean);
  const lines = [
    'Revisa tu solicitud:',
    `• Llegada: ${formatDateEs(d.check_in)}`,
    `• Salida: ${formatDateEs(d.check_out)} (${nights} ${nights === 1 ? 'noche' : 'noches'})`,
    `• Personas: ${d.guests}`,
    d.room_type ? `• Habitación: ${d.room_type}` : null,
    `• Nombre: ${d.guest_name}`,
    `• Email: ${d.guest_email}`,
    d.guest_phone ? `• Teléfono: ${d.guest_phone}` : null,
    extras.length ? `• Extras: ${extras.join(', ')}` : null,
    d.notes ? `• Notas: ${d.notes}` : null,
    '',
    'El hotel revisará la disponibilidad y te confirmará por email. Todavía no es una reserva confirmada.',
  ];
  return { text: lines.filter((l) => l !== null).join('\n'), options: ['Enviar solicitud', 'Corregir datos'] };
}

/** Siguiente pregunta tras completar `step` */
function advance(state, ctx) {
  const order = ['check_in', 'check_out', 'guests', 'room_type', 'guest_name', 'guest_email', 'guest_phone', 'extras', 'notes', 'summary'];
  let i = order.indexOf(state.step) + 1;
  for (; i < order.length; i++) {
    const s = order[i];
    if (s === 'room_type' && !ctx.hotel.room_types?.length) continue;
    if (s === 'extras' && !ctx.extras.length) continue;
    break;
  }
  const next = order[i];
  const st = { ...state, step: next };
  const ask = {
    check_out: () => askCheckOut(st),
    guests: askGuests,
    room_type: () => askRoomType(ctx),
    guest_name: askName,
    guest_email: askEmail,
    guest_phone: askPhone,
    extras: () => {
      st.extraIdx = 0;
      st.offered = [ctx.extras[0].key];
      return askExtra(ctx.extras[0]);
    },
    notes: askNotes,
    summary: () => summary(st, ctx),
  }[next]();
  return { state: st, replies: [ask] };
}

/** Primer mensaje de la conversación */
export function start(ctx) {
  const welcome = ctx.hotel.welcome_message?.trim() || `¡Hola! Soy el asistente de reservas de ${ctx.hotel.name}. Te ayudo a enviar tu solicitud en un minuto.`;
  return { state: freshState(), replies: [{ text: welcome }, askCheckIn(ctx)] };
}

/**
 * Procesa un mensaje del huésped.
 * @returns {{ state, replies, action?: { type: 'create_request', payload } }}
 */
export function step(state, input, ctx) {
  const text = String(input ?? '').trim();
  const n = norm(text);
  const err = (msg, again) => ({ state, replies: [{ text: msg }, again] });

  if (RESTART.test(n) && state.step !== 'summary') {
    return { state: freshState(), replies: [{ text: 'Perfecto, empezamos una solicitud nueva.' }, askCheckIn(ctx)] };
  }
  if (!text) return { state, replies: [] };

  switch (state.step) {
    case 'check_in': {
      const date = parseUserDate(text, ctx.today);
      if (!date) return err('No entendí la fecha. Escríbela así: 14/11/2026, o elígela en el calendario.', askCheckIn(ctx));
      if (date < ctx.today) return err('Esa fecha ya pasó. ¿Qué día quieres llegar?', askCheckIn(ctx));
      return advance({ ...state, data: { ...state.data, check_in: date } }, ctx);
    }

    case 'check_out': {
      const nightsMatch = n.match(/^(\d{1,2})\s*noches?$/);
      const date = nightsMatch ? addDays(state.data.check_in, Number(nightsMatch[1])) : parseUserDate(text, ctx.today);
      if (!date) return err('No entendí la fecha de salida. Escríbela así: 17/11/2026, o dime cuántas noches.', askCheckOut(state));
      if (date <= state.data.check_in) return err('La salida tiene que ser después de la llegada.', askCheckOut(state));
      if (nightsBetween(state.data.check_in, date) > MAX_NIGHTS) {
        return err(`Por el chat podemos gestionar estancias de hasta ${MAX_NIGHTS} noches. Para más, contacta al hotel.`, askCheckOut(state));
      }
      return advance({ ...state, data: { ...state.data, check_out: date } }, ctx);
    }

    case 'guests': {
      const m = n.match(/\d+/);
      const g = m ? Number(m[0]) : NaN;
      if (!(g >= 1 && g <= MAX_GUESTS)) return err(`Dime un número de personas entre 1 y ${MAX_GUESTS}.`, askGuests());
      return advance({ ...state, data: { ...state.data, guests: g } }, ctx);
    }

    case 'room_type': {
      if (/^(me da igual|cualquiera|indiferente|da igual)$/.test(n)) {
        return advance({ ...state, data: { ...state.data, room_type: null } }, ctx);
      }
      const match = ctx.hotel.room_types.find((r) => norm(r) === n) ?? ctx.hotel.room_types.find((r) => norm(r).includes(n) && n.length >= 3);
      if (!match) return err('Elige una de las opciones, por favor.', askRoomType(ctx));
      return advance({ ...state, data: { ...state.data, room_type: match } }, ctx);
    }

    case 'guest_name': {
      if (text.length < 2 || text.length > 80) return err('¿Me dices el nombre completo?', askName());
      return advance({ ...state, data: { ...state.data, guest_name: text } }, ctx);
    }

    case 'guest_email': {
      if (!EMAIL_RE.test(text)) return err('Ese email no parece válido. Revísalo, por favor.', askEmail());
      return advance({ ...state, data: { ...state.data, guest_email: text.toLowerCase() } }, ctx);
    }

    case 'guest_phone': {
      if (/^(omitir|no|no tengo|paso|sin telefono)$/.test(n)) return advance({ ...state, data: { ...state.data, guest_phone: null } }, ctx);
      if (!/^\+?[\d\s\-()]{6,20}$/.test(text)) return err('Ese teléfono no parece válido. Escríbelo con el código de país, o pulsa «Omitir».', askPhone());
      return advance({ ...state, data: { ...state.data, guest_phone: text } }, ctx);
    }

    case 'extras': {
      const extra = ctx.extras[state.extraIdx];
      let accepted = state.accepted;
      if (isYes(text)) accepted = [...accepted, extra.key];
      else if (!isNo(text)) return err('¿Lo añadimos? Responde sí o no.', askExtra(extra));
      const nextIdx = state.extraIdx + 1;
      if (nextIdx < ctx.extras.length) {
        const nextExtra = ctx.extras[nextIdx];
        const st = { ...state, accepted, extraIdx: nextIdx, offered: [...state.offered, nextExtra.key] };
        const ack = accepted.length > state.accepted.length ? [{ text: `Anotado: ${extra.name}.` }] : [];
        return { state: st, replies: [...ack, askExtra(nextExtra)] };
      }
      const out = advance({ ...state, accepted }, ctx);
      if (accepted.length > state.accepted.length) out.replies.unshift({ text: `Anotado: ${extra.name}.` });
      return out;
    }

    case 'notes': {
      const none = /^(no|no,? nada mas|nada|nada mas|ninguna)$/.test(n);
      return advance({ ...state, data: { ...state.data, notes: none ? null : text.slice(0, 500) } }, ctx);
    }

    case 'summary': {
      if (/^(enviar|enviar solicitud|si|confirmar|ok|dale|listo)/.test(n)) {
        return {
          state: { ...state, step: 'sending' },
          replies: [],
          action: {
            type: 'create_request',
            payload: { ...state.data, extras: state.accepted, extras_offered: state.offered },
          },
        };
      }
      if (/^(corregir|corregir datos|cambiar|editar|no|reiniciar|empezar de nuevo)/.test(n)) {
        return { state: freshState(), replies: [{ text: 'Sin problema, volvamos a empezar.' }, askCheckIn(ctx)] };
      }
      return err('¿Envío la solicitud al hotel?', summary(state, ctx));
    }

    case 'sent':
      if (RESTART.test(n)) return { state: freshState(), replies: [{ text: 'Perfecto, empezamos una solicitud nueva.' }, askCheckIn(ctx)] };
      return {
        state,
        replies: [{ text: `Tu solicitud #${state.requestId} ya está en manos del hotel. Si quieres hacer otra, pulsa «Nueva solicitud».`, options: ['Nueva solicitud'] }],
      };

    default:
      return { state: freshState(), replies: [askCheckIn(ctx)] };
  }
}

/** Mensaje final tras guardar la solicitud */
export function sent(state, request) {
  return {
    state: { ...state, step: 'sent', requestId: request.id },
    replies: [
      {
        text: `¡Listo! Tu solicitud #${request.id} fue enviada al hotel. Te escribiremos a ${request.guest_email ?? 'tu contacto'} cuando la confirmen.`,
        options: ['Nueva solicitud'],
      },
    ],
  };
}
