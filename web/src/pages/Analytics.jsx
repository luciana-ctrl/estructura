import { useState } from 'react';
import { api, errorText } from '../api.js';
import { Empty, Spinner, useData } from '../ui.jsx';
import { daysAgoIso, hours, pct, shortDate, todayIso } from '../format.js';

const RANGES = [
  { key: '7', label: '7 días' },
  { key: '30', label: '30 días' },
  { key: '90', label: '90 días' },
  { key: 'all', label: 'Todo' },
];

export default function Analytics({ hotelId }) {
  const [range, setRange] = useState('30');
  const [dateField, setDateField] = useState('created');
  const [device, setDevice] = useState('');
  const [source, setSource] = useState('');
  const from = range === 'all' ? undefined : daysAgoIso(Number(range) - 1);
  const to = range === 'all' || dateField === 'check_in' ? undefined : todayIso();

  const res = useData(() => api('/analytics', { query: { hotelId, from, to, dateField, device, source } }), [hotelId, from, to, dateField, device, source]);
  const a = res.data;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Analítica de reservas por chat</h1>
          <p className="muted">Cuántas solicitudes genera el chatbot y qué pasa con ellas.</p>
        </div>
      </div>

      <div className="filters" role="group" aria-label="Filtros">
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? 'is-active' : ''} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <select className="input input-sm" value={dateField} onChange={(e) => setDateField(e.target.value)} aria-label="Fecha que se filtra">
          <option value="created">Por fecha de solicitud</option>
          <option value="check_in">Por fecha de llegada</option>
        </select>
        <select className="input input-sm" value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Dispositivo">
          <option value="">Todos los dispositivos</option>
          <option value="mobile">Móvil</option>
          <option value="desktop">Escritorio</option>
        </select>
        <select className="input input-sm" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Origen">
          <option value="">Chatbot y manuales</option>
          <option value="chat">Solo chatbot</option>
          <option value="manual">Solo manuales</option>
        </select>
      </div>

      {!a ? (
        res.error ? <Empty title="No se pudo cargar la analítica">{errorText(res.error)}</Empty> : <Spinner />
      ) : (
        <div className={`analytics ${res.loading ? 'is-loading' : ''}`}>
          <div className="kpis">
            <Kpi label="Solicitudes" value={a.totals.requests} sub={`${a.funnel.chatRequests} por chatbot`} />
            <Kpi label="Tasa de confirmación" value={pct(a.confirmationRate)} sub={`${a.totals.confirmed} confirmadas · ${a.totals.rejected} rechazadas`} />
            <Kpi label="Pendientes" value={a.totals.pending} sub="esperando respuesta del hotel" accent={a.totals.pending > 0} />
            <Kpi label="Tiempo medio de respuesta" value={hours(a.avgResponseHours)} sub="desde que llega hasta que se decide" />
          </div>

          <div className="chart-grid">
            <div className="card card-wide">
              <h2>Solicitudes por día</h2>
              <p className="muted small">{dateField === 'created' ? 'Según el día en que llegó la solicitud' : 'Según el día de llegada del huésped'}</p>
              <DailyChart days={a.byDay} />
            </div>

            <div className="card card-wide">
              <h2>Extras</h2>
              <p className="muted small">Cuántas veces se ofrecieron y cuántas se aceptaron.</p>
              {a.extras.length ? (
                <ul className="extras-stats">
                  {a.extras.map((x) => (
                    <li key={x.key}>
                      <div className="row-between">
                        <strong>{x.name}</strong>
                        <span>
                          {x.accepted} de {x.offered} · <strong>{pct(x.offered ? x.accepted / x.offered : null)}</strong>
                        </span>
                      </div>
                      <div className="meter">
                        <span style={{ width: `${x.offered ? (x.accepted / x.offered) * 100 : 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Todavía no se ofrecieron extras.</p>
              )}
            </div>

            <div className="card">
              <h2>Embudo del chatbot</h2>
              <p className="muted small">De cada conversación abierta en el widget a reserva confirmada.</p>
              <Funnel funnel={a.funnel} />
            </div>

            <div className="card">
              <h2>Motivos de rechazo</h2>
              {a.byReason.length ? <Bars rows={a.byReason.map((r) => ({ label: r.label, value: r.count }))} tone="rejected" /> : <p className="muted">Sin rechazos en este periodo.</p>}
            </div>

            <div className="card card-wide">
              <h2>Por dispositivo</h2>
              <Bars rows={a.byDevice.map((r) => ({ label: r.label, value: r.total, note: `${r.confirmed} confirmadas` }))} />
            </div>

            {!hotelId && a.byHotel.length > 1 && (
              <div className="card">
                <h2>Por hotel</h2>
                <Bars rows={a.byHotel.map((r) => ({ label: r.label, value: r.total, note: `${pct(r.confirmed + r.rejected ? r.confirmed / (r.confirmed + r.rejected) : null)} confirmación` }))} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={`kpi ${accent ? 'kpi-accent' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function Bars({ rows, tone = 'total' }) {
  if (!rows.length) return <p className="muted">Sin datos.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="row-between small">
            <span>{r.label}</span>
            <span>
              <strong>{r.value}</strong>
              {r.note && <span className="muted"> · {r.note}</span>}
            </span>
          </div>
          <div className={`bar bar-${tone}`}>
            <span style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Funnel({ funnel }) {
  const steps = [
    { label: 'Conversaciones en el widget', value: funnel.conversations },
    { label: 'Solicitudes enviadas', value: funnel.chatRequests },
    { label: 'Reservas confirmadas', value: funnel.confirmed },
  ];
  const max = Math.max(steps[0].value, 1);
  return (
    <ol className="funnel">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div className="row-between small">
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
          <div className="bar bar-funnel">
            <span style={{ width: `${(s.value / max) * 100}%` }} />
          </div>
          {i > 0 && (
            <span className="muted small">{steps[i - 1].value ? `${Math.round((s.value / steps[i - 1].value) * 100)} % del paso anterior` : '—'}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Barras apiladas por día: confirmadas, rechazadas y pendientes */
function DailyChart({ days: sparse }) {
  if (!sparse.length) return <p className="muted">Sin solicitudes en este periodo.</p>;
  // Rellena los días sin solicitudes para que el eje del tiempo sea continuo
  const byDate = new Map(sparse.map((d) => [d.date, d]));
  const days = [];
  for (let t = Date.parse(`${sparse[0].date}T12:00:00Z`), end = Date.parse(`${sparse.at(-1).date}T12:00:00Z`); t <= end && days.length < 400; t += 864e5) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push(byDate.get(date) ?? { date, total: 0, pending: 0, confirmed: 0, rejected: 0, cancelled: 0 });
  }
  const W = 720;
  const H = 220;
  const pad = { l: 28, r: 8, t: 10, b: 28 };
  const max = Math.max(...days.map((d) => d.total), 1);
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const top = ticks.at(-1) < max ? max : ticks.at(-1);
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const labelEvery = Math.ceil(days.length / 8);
  const series = [
    ['confirmed', 'Confirmadas'],
    ['rejected', 'Rechazadas'],
    ['pending', 'Pendientes'],
    ['cancelled', 'Canceladas'],
  ];

  return (
    <figure className="daily">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Solicitudes por día, por estado">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          let acc = 0;
          const x = pad.l + i * bw + bw * 0.15;
          return (
            <g key={d.date}>
              <title>{`${shortDate(d.date)}: ${d.total} (${d.confirmed} confirmadas, ${d.rejected} rechazadas, ${d.pending} pendientes)`}</title>
              {series.map(([k]) => {
                if (!d[k]) return null;
                const y0 = y(acc + d[k]);
                const h = y(acc) - y0;
                acc += d[k];
                return <rect key={k} x={x} y={y0} width={bw * 0.7} height={Math.max(h - 1, 1)} className={`seg seg-${k}`} rx="1.5" />;
              })}
              {i % labelEvery === 0 && (
                <text x={x + bw * 0.35} y={H - 8} textAnchor="middle" className="axis">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        {series.slice(0, 3).map(([k, l]) => (
          <span key={k}>
            <i className={`dot seg-${k}`} /> {l}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
