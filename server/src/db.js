import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hotels (
  id              TEXT PRIMARY KEY,           -- slug, se usa en el widget: data-hotel="hotel-sol"
  name            TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  room_types      TEXT NOT NULL DEFAULT '[]', -- JSON: ["Doble", "Suite"]
  assign_by       TEXT NOT NULL DEFAULT 'check_in', -- 'check_in' | 'created'
  welcome_message TEXT,
  primary_color   TEXT NOT NULL DEFAULT '#2f6bff',
  logo_url        TEXT,
  created_at      TEXT NOT NULL
);

-- Encargados de registrar reservas, por día de la semana y rango de fechas
CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id   TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  weekdays   TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', -- JSON, 0 = domingo
  date_from  TEXT,  -- YYYY-MM-DD opcional
  date_to    TEXT,  -- YYYY-MM-DD opcional
  active     INTEGER NOT NULL DEFAULT 1
);

-- Extras que cada hotel configura en su Knowledge (parking, desayuno...)
CREATE TABLE IF NOT EXISTS extras (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  name           TEXT NOT NULL,
  price          TEXT,           -- texto libre: "10 € / noche", "incluido", "a consultar"
  offer_text     TEXT,           -- frase suave que usa el chatbot
  condition_text TEXT,           -- "plazas limitadas"
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  UNIQUE (hotel_id, key)
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  device      TEXT,
  channel     TEXT NOT NULL DEFAULT 'web', -- web (widget en la web del hotel) | panel (chat del personal)
  state       TEXT NOT NULL DEFAULT '{}',
  messages    TEXT NOT NULL DEFAULT '[]',
  request_id  INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id         TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected | cancelled
  source           TEXT NOT NULL DEFAULT 'chat',    -- chat | manual
  device           TEXT,                            -- mobile | desktop
  check_in         TEXT NOT NULL,
  check_out        TEXT NOT NULL,
  guests           INTEGER NOT NULL,
  room_type        TEXT,
  guest_name       TEXT NOT NULL,
  guest_email      TEXT,
  guest_phone      TEXT,
  notes            TEXT,
  extras           TEXT NOT NULL DEFAULT '[]',  -- JSON: extras aceptados [{key,name,price}]
  extras_offered   TEXT NOT NULL DEFAULT '[]',  -- JSON: keys ofrecidas por el chatbot
  assigned_staff   TEXT NOT NULL DEFAULT '[]',  -- JSON: ids de encargados avisados
  conversation_id  TEXT,
  reject_reason    TEXT,
  reject_note      TEXT,
  decided_by       TEXT,
  created_at       TEXT NOT NULL,
  decided_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_hotel_status ON requests (hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests (created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  staff_id    INTEGER,
  channel     TEXT NOT NULL,   -- panel | webhook
  created_at  TEXT NOT NULL
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Cambios de esquema para bases creadas con versiones anteriores */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
  if (!cols.includes('channel')) db.exec("ALTER TABLE conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'web'");
  const hotelCols = db.prepare('PRAGMA table_info(hotels)').all().map((c) => c.name);
  if (!hotelCols.includes('logo_url')) db.exec('ALTER TABLE hotels ADD COLUMN logo_url TEXT');
}

/** Ejecuta fn dentro de una transacción. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
