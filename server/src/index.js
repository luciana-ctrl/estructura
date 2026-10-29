import { createServer } from 'node:http';
import { join } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createNotifier } from './notifier.js';
import { seedIfEmpty } from './seed.js';

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || join(process.cwd(), 'data', 'reservas.db');

const db = openDb(DB_FILE);
if (process.env.SEED_DEMO !== 'false') seedIfEmpty(db);

const app = createApp({ db, notifier: createNotifier(), panelToken: process.env.PANEL_TOKEN || undefined });

createServer(app).listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(`  Panel:        http://localhost:${PORT}/`);
  console.log(`  Demo widget:  http://localhost:${PORT}/demo?hotel=hotel-mirador`);
  console.log(`  Base de datos: ${DB_FILE}`);
  if (!process.env.PANEL_TOKEN) console.log('  Aviso: PANEL_TOKEN no está definido; el panel no pide contraseña (solo para desarrollo).');
});
