import { useMemo, useState } from 'react';
import { api, errorText } from '../api.js';
import { Badge, Drawer, Empty, Field, Modal, Spinner, useData, useToast } from '../ui.jsx';
import { DEVICE_LABEL, SOURCE_LABEL, dateTime, nights, plural, shortDate, timeAgo } from '../format.js';

const TABS = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'confirmed', label: 'Confirmadas' },
  { key: 'rejected', label: 'Rechazadas' },
  { key: 'cancelled', label: 'Canceladas' },
];

export default function Requests({ hotelId, hotels, reasons, onChange }) {
  const [tab, setTab] = useState('pending');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const list = useData(() => api('/requests', { query: { hotelId, status: tab, search } }), [hotelId, tab, search], { interval: 20000 });
  const hotelName = useMemo(() => Object.fromEntries(hotels.map((h) => [h.id, h.name])), [hotels]);
  const reasonLabel = useMemo(() => Object.fromEntries(reasons.map((r) => [r.key, r.label])), [reasons]);

  const rows = (list.data ?? []).filter((r) => tab !== 'rejected' || !reason || r.reject_reason === reason);
  const reasonCounts = useMemo(() => {
    const c = {};
    for (const r of list.data ?? []) if (r.reject_reason) c[r.reject_reason] = (c[r.reject_reason] ?? 0) + 1;
    return c;
  }, [list.data]);

  const changed = () => {
    list.reload(true);
    onChange();
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Solicitudes de reserva</h1>
          <p className="muted">{hotelId ? hotelName[hotelId] : 'Todos los hoteles'} · el chatbot crea la solicitud y el hotel la confirma o la rechaza.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!hotels.length}>
          + Nueva solicitud manual
        </button>
      </div>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? 'is-active' : ''}
              onClick={() => {
                setTab(t.key);
                setReason('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input className="input search" type="search" placeholder="Buscar huésped, email o teléfono" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {tab === 'rejected' && (
        <div className="reason-filter" aria-label="Clasificación por motivo">
          <button className={`pill ${!reason ? 'is-active' : ''}`} onClick={() => setReason('')}>
            Todos los motivos <span>{list.data?.length ?? 0}</span>
          </button>
          {reasons.map((r) => (
            <button key={r.key} className={`pill ${reason === r.key ? 'is-active' : ''}`} onClick={() => setReason(r.key)} disabled={!reasonCounts[r.key]}>
              {r.label} <span>{reasonCounts[r.key] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {list.loading && !list.data ? (
        <Spinner />
      ) : list.error ? (
        <Empty title="No se pudieron cargar las solicitudes">{errorText(list.error)}</Empty>
      ) : rows.length === 0 ? (
        <Empty title={tab === 'pending' ? 'No hay solicitudes pendientes' : 'Nada por aquí'}>
          {tab === 'pending' ? 'Cuando un huésped envíe una solicitud por el chat, aparecerá aquí.' : 'Prueba con otro filtro.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Estancia</th>
                <th>Huésped</th>
                {!hotelId && <th>Hotel</th>}
                <th>Habitación</th>
                <th>Extras</th>
                <th>Origen</th>
                <th>{tab === 'rejected' ? 'Motivo' : tab === 'pending' ? 'Recibida' : 'Decidida'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}>
                  <td className="mono">{r.id}</td>
                  <td>
                    <strong>
                      {shortDate(r.check_in)} → {shortDate(r.check_out)}
                    </strong>
                    <div className="muted small">
                      {plural(nights(r.check_in, r.check_out), 'noche', 'noches')} · {r.guests} {r.guests === 1 ? 'persona' : 'personas'}
                    </div>
                  </td>
                  <td>
                    {r.guest_name}
                    <div className="muted small">{r.guest_email ?? r.guest_phone}</div>
                  </td>
                  {!hotelId && <td>{hotelName[r.hotel_id] ?? r.hotel_id}</td>}
                  <td>{r.room_type ?? <span className="muted">Indiferente</span>}</td>
                  <td>{r.extras.length ? r.extras.map((e) => <span key={e.key} className="tag">{e.name}</span>) : <span className="muted">—</span>}</td>
                  <td>
                    {SOURCE_LABEL[r.source]}
                    {r.device && <div className="muted small">{DEVICE_LABEL[r.device]}</div>}
                  </td>
                  <td>
                    {tab === 'rejected' ? (
                      reasonLabel[r.reject_reason] ?? r.reject_reason
                    ) : tab === 'pending' ? (
                      <span title={dateTime(r.created_at)}>{timeAgo(r.created_at)}</span>
                    ) : (
                      dateTime(r.decided_at)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <RequestDrawer id={openId} reasons={reasons} hotelName={hotelName} onClose={() => setOpenId(null)} onChanged={changed} />}
      {creating && (
        <NewRequestModal
          hotels={hotels}
          defaultHotel={hotelId || hotels[0]?.id}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setTab('pending');
            changed();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- detalle

function RequestDrawer({ id, reasons, hotelName, onClose, onChanged }) {
  const toast = useToast();
  const detail = useData(() => api(`/requests/${id}`), [id]);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = detail.data;
  const reasonLabel = Object.fromEntries(reasons.map((x) => [x.key, x.label]));

  async function act(path, body, okText) {
    setBusy(true);
    try {
      await api(`/requests/${id}/${path}`, { method: 'POST', body });
      toast(okText);
      onChanged();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const footer =
    r &&
    (r.status === 'pending' ? (
      <>
        <button className="btn btn-danger-ghost" onClick={() => setRejecting(true)} disabled={busy}>
          Rechazar
        </button>
        <button className="btn btn-primary" onClick={() => act('confirm', {}, `Solicitud #${id} confirmada`)} disabled={busy}>
          Confirmar reserva
        </button>
      </>
    ) : r.status === 'confirmed' ? (
      <button className="btn btn-ghost" onClick={() => confirm('¿Cancelar esta reserva confirmada?') && act('cancel', {}, `Reserva #${id} cancelada`)} disabled={busy}>
        Cancelar reserva
      </button>
    ) : (
      <button className="btn btn-ghost" onClick={() => act('reopen', {}, `Solicitud #${id} vuelve a pendientes`)} disabled={busy}>
        Volver a pendientes
      </button>
    ));

  return (
    <Drawer title={`Solicitud #${id}`} onClose={onClose} footer={footer}>
      {!r ? (
        detail.error ? <Empty title="No se pudo cargar">{errorText(detail.error)}</Empty> : <Spinner />
      ) : (
        <div className="stack">
          <div className="row-between">
            <Badge status={r.status} />
            <span className="muted small">Recibida {dateTime(r.created_at)}</span>
          </div>
          {r.status === 'rejected' && (
            <div className="callout callout-danger">
              <strong>{reasonLabel[r.reject_reason] ?? r.reject_reason}</strong>
              {r.reject_note && <p>{r.reject_note}</p>}
              <p className="small muted">
                {r.decided_by ? `${r.decided_by} · ` : ''}
                {dateTime(r.decided_at)}
              </p>
            </div>
          )}
          <dl className="facts">
            <dt>Hotel</dt>
            <dd>{hotelName[r.hotel_id] ?? r.hotel_id}</dd>
            <dt>Llegada</dt>
            <dd>{shortDate(r.check_in)}</dd>
            <dt>Salida</dt>
            <dd>
              {shortDate(r.check_out)} · {plural(nights(r.check_in, r.check_out), 'noche', 'noches')}
            </dd>
            <dt>Personas</dt>
            <dd>{r.guests}</dd>
            <dt>Habitación</dt>
            <dd>{r.room_type ?? 'Indiferente'}</dd>
            <dt>Huésped</dt>
            <dd>{r.guest_name}</dd>
            <dt>Email</dt>
            <dd>{r.guest_email ? <a href={`mailto:${r.guest_email}`}>{r.guest_email}</a> : '—'}</dd>
            <dt>Teléfono</dt>
            <dd>{r.guest_phone ? <a href={`tel:${r.guest_phone.replace(/\s/g, '')}`}>{r.guest_phone}</a> : '—'}</dd>
            <dt>Extras</dt>
            <dd>{r.extras.length ? r.extras.map((e) => `${e.name}${e.price ? ` (${e.price})` : ''}`).join(', ') : 'Ninguno'}</dd>
            <dt>Notas</dt>
            <dd>{r.notes ?? '—'}</dd>
            <dt>Origen</dt>
            <dd>
              {SOURCE_LABEL[r.source]}
              {r.device ? ` · ${DEVICE_LABEL[r.device]}` : ''}
            </dd>
            <dt>Avisado a</dt>
            <dd>{r.assigned_staff_detail.length ? r.assigned_staff_detail.map((s) => s.name).join(', ') : 'Sin encargados configurados'}</dd>
          </dl>

          {r.conversation.length > 0 && (
            <details className="transcript">
              <summary>Conversación del chat ({r.conversation.length} mensajes)</summary>
              <div className="chat-log">
                {r.conversation.map((m, i) => (
                  <div key={i} className={`chat-msg chat-${m.from}`}>
                    {m.text}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {rejecting && (
        <RejectModal
          reasons={reasons}
          busy={busy}
          onClose={() => setRejecting(false)}
          onSubmit={(body) => act('reject', body, `Solicitud #${id} rechazada`)}
        />
      )}
    </Drawer>
  );
}

function RejectModal({ reasons, onClose, onSubmit, busy }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const valid = reason && (reason !== 'otro' || note.trim());
  return (
    <Modal
      title="Rechazar solicitud"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Volver
          </button>
          <button className="btn btn-danger" disabled={!valid || busy} onClick={() => onSubmit({ reason, note: note.trim() || undefined })}>
            Rechazar
          </button>
        </>
      }
    >
      <fieldset className="radio-list">
        <legend className="field-label">Motivo (se usa para clasificar las rechazadas)</legend>
        {reasons.map((r) => (
          <label key={r.key} className="radio">
            <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <Field label={reason === 'otro' ? 'Nota (obligatoria)' : 'Nota interna (opcional)'}>
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- alta manual

function NewRequestModal({ hotels, defaultHotel, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ hotel_id: defaultHotel, check_in: '', check_out: '', guests: 2, room_type: '', guest_name: '', guest_email: '', guest_phone: '', notes: '', extras: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hotel = hotels.find((h) => h.id === form.hotel_id);
  const extras = useData(() => (form.hotel_id ? api(`/hotels/${form.hotel_id}/extras`) : Promise.resolve([])), [form.hotel_id]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/requests', { method: 'POST', body: { ...form, guests: Number(form.guests), source: 'manual' } });
      toast(`Solicitud #${r.id} creada y enviada al panel del hotel`);
      onCreated(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nueva solicitud manual"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="new-request" type="submit" disabled={busy}>
            Crear solicitud
          </button>
        </>
      }
    >
      <form id="new-request" className="grid-form" onSubmit={submit}>
        <Field label="Hotel" className="span-2">
          <select className="input" value={form.hotel_id} onChange={(e) => setForm((f) => ({ ...f, hotel_id: e.target.value, room_type: '', extras: [] }))}>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Llegada">
          <input className="input" type="date" required value={form.check_in} onChange={set('check_in')} />
        </Field>
        <Field label="Salida">
          <input className="input" type="date" required min={form.check_in || undefined} value={form.check_out} onChange={set('check_out')} />
        </Field>
        <Field label="Personas">
          <input className="input" type="number" min={1} max={50} required value={form.guests} onChange={set('guests')} />
        </Field>
        <Field label="Habitación">
          <select className="input" value={form.room_type} onChange={set('room_type')}>
            <option value="">Indiferente</option>
            {hotel?.room_types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Nombre del huésped" className="span-2">
          <input className="input" required value={form.guest_name} onChange={set('guest_name')} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.guest_email} onChange={set('guest_email')} />
        </Field>
        <Field label="Teléfono">
          <input className="input" type="tel" value={form.guest_phone} onChange={set('guest_phone')} />
        </Field>
        {extras.data?.length > 0 && (
          <fieldset className="span-2 checks">
            <legend className="field-label">Extras</legend>
            {extras.data.map((x) => (
              <label key={x.key} className="radio">
                <input
                  type="checkbox"
                  checked={form.extras.includes(x.key)}
                  onChange={(e) => setForm((f) => ({ ...f, extras: e.target.checked ? [...f.extras, x.key] : f.extras.filter((k) => k !== x.key) }))}
                />
                {x.name}
                {x.price && <span className="muted"> · {x.price}</span>}
                {!x.active && <span className="muted"> (no se ofrece en el chat)</span>}
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Notas" className="span-2">
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        {error && <p className="form-error span-2">{error}</p>}
      </form>
    </Modal>
  );
}
