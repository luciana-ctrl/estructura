import { createExtra, createHotel, createRequest, createStaff, confirmRequest, rejectRequest } from './services.js';
import { addDays, todayIn } from './util.js';

/**
 * Datos de ejemplo: dos hoteles con extras, encargados y algunas solicitudes de las últimas semanas,
 * para poder probar el panel y la analítica desde el primer arranque.
 * Solo se cargan si la base está vacía.
 */
export function seedIfEmpty(db, { withRequests = true } = {}) {
  if (db.prepare('SELECT COUNT(*) AS n FROM hotels').get().n > 0) return false;

  const mirador = createHotel(db, {
    id: 'hotel-mirador',
    name: 'Hotel Mirador',
    room_types: ['Doble estándar', 'Doble superior', 'Suite familiar'],
    welcome_message: '¡Hola! Soy el asistente del Hotel Mirador. Te ayudo a pedir tu reserva en un minuto.',
  });
  const posada = createHotel(db, {
    id: 'posada-del-rio',
    name: 'Posada del Río',
    room_types: ['Cabaña', 'Habitación doble'],
    assign_by: 'created',
    primary_color: '#b4532a',
  });

  createExtra(db, mirador.id, { key: 'parking', name: 'Parking', price: '10 € por noche', offer_text: '¿Vienes en coche? Te podemos reservar un puesto de parking por 10 € la noche.', condition_text: 'Plazas limitadas' });
  createExtra(db, mirador.id, { key: 'desayuno', name: 'Desayuno', price: '12 € por persona y día', offer_text: '¿Te gustaría añadir el desayuno buffet? Son 12 € por persona y día.' });
  createExtra(db, mirador.id, { key: 'late-checkout', name: 'Late checkout', price: '25 €', active: false });
  createExtra(db, posada.id, { key: 'desayuno', name: 'Desayuno', price: 'incluido en cabañas', offer_text: '¿Quieres que te preparemos el desayuno casero cada mañana?' });

  const ana = createStaff(db, mirador.id, { name: 'Ana Gómez', email: 'ana@hotelmirador.test', weekdays: [1, 2, 3, 4, 5] });
  createStaff(db, mirador.id, { name: 'Luis Pereyra', email: 'luis@hotelmirador.test', weekdays: [0, 6] });
  createStaff(db, posada.id, { name: 'Carla Benítez', email: 'carla@posadadelrio.test' });

  if (!withRequests) return true;

  const today = todayIn(mirador.timezone);
  const people = [
    ['Martina López', 'martina@example.com'],
    ['Diego Fernández', 'diego@example.com'],
    ['Sofía Romero', 'sofia@example.com'],
    ['Julián Acosta', 'julian@example.com'],
    ['Valentina Ruiz', 'valen@example.com'],
    ['Tomás Herrera', 'tomas@example.com'],
    ['Lucía Sosa', 'lucia@example.com'],
    ['Mateo Álvarez', 'mateo@example.com'],
  ];
  const quiet = { requestCreated() {}, requestDecided() {} };
  const setCreated = db.prepare('UPDATE requests SET created_at = ?, decided_at = CASE WHEN decided_at IS NULL THEN NULL ELSE ? END WHERE id = ?');
  const addConv = db.prepare("INSERT INTO conversations (id, hotel_id, device, state, messages, created_at, updated_at) VALUES (?, ?, ?, '{}', '[]', ?, ?)");

  // 28 días de historia, determinista
  for (let i = 0; i < 28; i++) {
    const day = addDays(today, -27 + i);
    const perDay = 1 + ((i * 7) % 3);
    for (let j = 0; j < perDay; j++) {
      const k = i * 3 + j;
      const hotel = k % 4 === 3 ? posada : mirador;
      const [name, email] = people[k % people.length];
      const device = k % 3 === 0 ? 'desktop' : 'mobile';
      const createdAt = `${day}T${String(10 + (k % 9)).padStart(2, '0')}:15:00.000Z`;
      addConv.run(`seed-${k}`, hotel.id, device, createdAt, createdAt);
      if (k % 5 === 4) continue; // conversaciones que no terminan en solicitud
      const checkIn = addDays(day, 5 + (k % 20));
      const offered = hotel === mirador ? ['parking', 'desayuno'] : ['desayuno'];
      const accepted = offered.filter((_, idx) => (k + idx) % 3 === 0);
      const r = createRequest(
        db,
        {
          hotel_id: hotel.id,
          source: k % 7 === 6 ? 'manual' : 'chat',
          device,
          check_in: checkIn,
          check_out: addDays(checkIn, 1 + (k % 4)),
          guests: 1 + (k % 4),
          room_type: hotel.room_types[k % hotel.room_types.length],
          guest_name: name,
          guest_email: email,
          extras: accepted,
          extras_offered: offered,
          conversation_id: `seed-${k}`,
        },
        { notifier: quiet }
      );
      const decidedAt = `${day}T${String(12 + (k % 9)).padStart(2, '0')}:40:00.000Z`;
      if (i < 25) {
        if (k % 4 === 1) rejectRequest(db, r.id, { reason: ['sin_disponibilidad', 'datos_incompletos', 'habitacion_no_disponible', 'duplicada'][k % 4 === 1 ? (k >> 2) % 4 : 0], by: ana.name }, { notifier: quiet });
        else confirmRequest(db, r.id, { by: ana.name }, { notifier: quiet });
      }
      setCreated.run(createdAt, decidedAt, r.id);
      db.prepare('UPDATE conversations SET request_id = ? WHERE id = ?').run(r.id, `seed-${k}`);
    }
  }
  return true;
}
