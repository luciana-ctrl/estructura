# Arquitectura

```
 Web del hotel                     Servidor (Node 22, sin dependencias)              Personal del hotel
┌──────────────┐  POST /api/chat  ┌───────────────────────────────────────┐        ┌─────────────────┐
│  widget.js   │ ───────────────▶ │ chat/engine.js  (máquina de estados)  │        │ Panel React     │
│ (shadow DOM) │ ◀─────────────── │ chat/service.js (guarda conversación) │        │  Solicitudes    │
└──────────────┘                  │        │ create_request                │ ◀────▶ │  Knowledge      │
                                  │        ▼                              │  /api  │  Analítica      │
                                  │ services.js → SQLite (data/*.db)      │        └─────────────────┘
                                  │        │                              │
                                  │        ▼                              │
                                  │ notifier.js → panel + WEBHOOK_URL ────┼──▶ email / WhatsApp (n8n, Make…)
                                  └───────────────────────────────────────┘
```

## Estados de una solicitud

```
pending ──confirmar──▶ confirmed ──cancelar──▶ cancelled
   │                                              │
   └──rechazar (motivo)──▶ rejected ──reabrir──▶ pending ◀──reabrir──┘
```

Motivos de rechazo (clasifican la lista de rechazadas): `sin_disponibilidad`, `datos_incompletos`, `habitacion_no_disponible`, `duplicada`, `otro` (exige nota). Se cambian en `REJECTION_REASONS` de `server/src/services.js`.

## Tablas

| Tabla | Contenido |
| --- | --- |
| `hotels` | Nombre, tipos de habitación, color del widget, zona horaria, regla de asignación |
| `extras` | Knowledge de cada hotel: nombre, precio, frase de oferta, condición, activo |
| `staff` | Encargados: días de la semana, rango de fechas opcional, contacto |
| `conversations` | Estado y mensajes de cada chat (para restaurarlo y para el embudo) |
| `requests` | Solicitudes: datos, extras aceptados y ofrecidos, encargados avisados, decisión |
| `notifications` | Registro de a quién se avisó de cada solicitud |

## API

Pública (la usa el widget, sin token):

| Método | Ruta | |
| --- | --- | --- |
| GET | `/api/public/hotels/:id` | Nombre y color del hotel |
| POST | `/api/chat` | `{hotelId, conversationId?, message?, device}` → respuestas del bot |
| GET | `/api/public/hotels/:id/conversations/:cid` | Restaurar una conversación |

Panel (con `Authorization: Bearer PANEL_TOKEN` si está definido):

| Método | Ruta | |
| --- | --- | --- |
| GET/POST | `/api/hotels` | Listar / crear hotel |
| GET/PUT | `/api/hotels/:id` | Ver / editar ajustes |
| GET/POST | `/api/hotels/:id/extras` | Extras (Knowledge) |
| PUT/DELETE | `/api/hotels/:id/extras/:extraId` | |
| GET/POST | `/api/hotels/:id/staff` | Encargados |
| PUT/DELETE | `/api/hotels/:id/staff/:staffId` | |
| GET | `/api/requests?hotelId&status&reason&source&from&to&search` | Listar solicitudes |
| POST | `/api/requests` | Crear solicitud (panel u otro chatbot) |
| GET | `/api/requests/:id` | Detalle + conversación + encargados avisados |
| POST | `/api/requests/:id/confirm` · `/reject` · `/reopen` · `/cancel` | Decisiones |
| GET | `/api/analytics?hotelId&from&to&dateField&device&source` | Métricas |
| GET | `/api/meta` | Motivos de rechazo y pendientes por hotel |

## Webhook

Con `WEBHOOK_URL` definido, cada evento envía un POST JSON:

- `request.created` → `{ hotel, request, notify: [{id, name, email, phone}] }`
- `request.confirmed` / `request.rejected` → `{ request }`

## Cambiar el chatbot por un modelo de lenguaje

`chat/engine.js` es una función pura: `step(state, texto, contexto) → { state, replies, action }`. Un motor basado en LLM puede sustituirla si devuelve la misma acción `create_request` con los datos del huésped; el resto (guardado, asignación, avisos, panel, analítica) no cambia.

## Producción

- Poner `PANEL_TOKEN` y servir detrás de HTTPS (nginx, Caddy, Render, Railway…).
- `DB_FILE` en un disco persistente; hacer copia del archivo `.db` periódicamente.
- Si el volumen crece mucho, la capa `services.js` se puede migrar a Postgres sin tocar el widget ni el panel.
