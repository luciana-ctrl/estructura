/**
 * Avisos a los encargados.
 *
 * - Siempre: la solicitud aparece en el panel del hotel (bandeja "Pendientes") y queda registrada en `notifications`.
 * - Opcional: si WEBHOOK_URL está definido, se envía un POST JSON por cada evento. Desde ahí se puede
 *   reenviar a email, WhatsApp o Slack con n8n, Make o Zapier sin tocar este código.
 */
export function createNotifier({ webhookUrl = process.env.WEBHOOK_URL, log = console } = {}) {
  async function post(event, payload) {
    if (!webhookUrl) return;
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, ...payload }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) log.warn(`[webhook] ${event} respondió ${res.status}`);
    } catch (err) {
      log.warn(`[webhook] ${event} falló: ${err.message}`);
    }
  }

  return {
    requestCreated({ hotel, request, staff }) {
      log.info?.(
        `[solicitud #${request.id}] ${hotel.name} · ${request.check_in} → ${request.check_out} · avisados: ${
          staff.map((s) => s.name).join(', ') || 'nadie (no hay encargados activos)'
        }`
      );
      void post('request.created', {
        hotel: { id: hotel.id, name: hotel.name },
        request,
        notify: staff.map(({ id, name, email, phone }) => ({ id, name, email, phone })),
      });
    },
    requestDecided({ request }) {
      log.info?.(`[solicitud #${request.id}] ${request.status}${request.reject_reason ? ` (${request.reject_reason})` : ''}`);
      void post(`request.${request.status}`, { request });
    },
  };
}

export const silentNotifier = { requestCreated() {}, requestDecided() {} };
