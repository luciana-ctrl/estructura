# Reservas por chatbot

El chatbot recoge los datos del huésped y crea una **solicitud manual** de reserva. La solicitud llega al panel del hotel y a los encargados de ese día, que la **confirman o la rechazan**. Las rechazadas van a una lista aparte, clasificada por motivo. Cada hotel configura en **Knowledge** los extras que quiere ofrecer (parking, desayuno…) y el chatbot los propone de forma suave. Un **dashboard** mide cuántas reservas genera el chat.

No necesita un PMS: el panel hace de PMS ligero para cada hotel.

## Qué incluye

| Parte | Dónde | Qué hace |
| --- | --- | --- |
| Servidor | `server/` | API, base de datos SQLite, chatbot guiado, asignación de encargados, avisos |
| Widget | `widget/widget.js` | Chat embebible con una línea; minimizable; pantalla completa en móvil |
| Panel | `web/` | React: Solicitudes, Knowledge y Analítica |
| Demo | `widget/demo.html` | Web de hotel de ejemplo con el widget instalado |

## Arrancar

Requisitos: **Node.js 22.5 o superior** (usa el SQLite que trae Node; el servidor no tiene dependencias).

```bash
npm install        # React y esbuild, solo para compilar el panel
npm run build      # compila el panel en web/dist
npm start          # http://localhost:3000
```

- Panel: http://localhost:3000/
- Web de demo con el widget: http://localhost:3000/demo?hotel=hotel-mirador

El primer arranque carga dos hoteles de ejemplo con extras, encargados y un mes de solicitudes para ver la analítica. Para empezar vacío: `SEED_DEMO=false npm start` con una base nueva.

Desarrollo: `npm run dev` (servidor con recarga) y `npm run dev:web` (panel con recarga) en dos terminales. Tests: `npm test`.

## Instalar el widget en la web de un hotel

```html
<script src="https://TU-SERVIDOR/widget.js" data-hotel="hotel-mirador" async></script>
```

Es el mismo archivo para todos los hoteles; solo cambia `data-hotel`. El panel (Knowledge → Instalar el widget) muestra la línea lista para copiar.

Opciones: `data-position="left"`, `data-label="Reservar"`, `data-open="true"`, `data-api="https://otra-url"`.
Desde JavaScript: `ReservasChat.open()`, `ReservasChat.minimize()`, `ReservasChat.toggle()`, `ReservasChat.reset()`.

En móvil el chat ocupa toda la pantalla, se ajusta cuando aparece el teclado, usa el calendario nativo para las fechas y se puede minimizar sin perder la conversación (se guarda en el navegador y en el servidor).

## Configuración

| Variable | Para qué | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto | `3000` |
| `DB_FILE` | Archivo de la base de datos | `./data/reservas.db` |
| `PANEL_TOKEN` | Clave del panel. **Ponla en producción**: sin ella el panel está abierto | — |
| `WEBHOOK_URL` | Recibe un POST por cada solicitud nueva, confirmada o rechazada. Úsalo con n8n, Make o Zapier para mandar email o WhatsApp a los encargados | — |
| `SEED_DEMO` | `false` para no cargar datos de ejemplo | `true` |

## Cómo se decide quién recibe la solicitud

Cada encargado tiene días de la semana y, opcionalmente, un rango de fechas (turnos de temporada). Cada hotel elige qué día cuenta:

- **Día de llegada del huésped** (por defecto): la recibe quien cubre la fecha de check-in.
- **Día en que llega la solicitud**: la recibe quien está de turno ese día.

Si nadie cubre ese día, se avisa a todos los encargados activos para que ninguna solicitud quede sin dueño.

## Conectar otro chatbot

Si ya tienen un chatbot (por ejemplo, con un modelo de lenguaje), puede crear solicitudes directamente:

```bash
curl -X POST https://TU-SERVIDOR/api/requests \
  -H "authorization: Bearer $PANEL_TOKEN" -H "content-type: application/json" \
  -d '{"hotel_id":"hotel-mirador","source":"chat","device":"mobile",
       "check_in":"2026-11-14","check_out":"2026-11-17","guests":2,
       "guest_name":"Martina López","guest_email":"martina@example.com",
       "extras":["parking"],"extras_offered":["parking","desayuno"]}'
```

Los extras activos de cada hotel se leen en `GET /api/hotels/:id/extras`. El detalle de la API está en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Pendiente de decidir con el equipo

- Canal de aviso a encargados (email, WhatsApp, Slack) → hoy vía `WEBHOOK_URL`.
- Email automático al huésped cuando se confirma o rechaza.
- Plazo máximo de respuesta del hotel y qué pasa si no responde.
- Cuentas por hotel en el panel (hoy hay una sola clave para todo el panel).
- Si más adelante se conecta un PMS real, el punto de enganche es `createRequest` / `confirmRequest` en `server/src/services.js`.
