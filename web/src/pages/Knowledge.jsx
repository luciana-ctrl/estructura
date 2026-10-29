import { useEffect, useState } from 'react';
import { api, errorText } from '../api.js';
import { Empty, Field, Modal, Spinner, useData, useToast } from '../ui.jsx';
import { WEEKDAYS, shortDate } from '../format.js';

export default function Knowledge({ hotel, hotels, onHotelsChange, onSelectHotel }) {
  const [creating, setCreating] = useState(false);

  if (!hotel) {
    return (
      <section>
        <div className="page-head">
          <div>
            <h1>Knowledge</h1>
            <p className="muted">Cada hotel configura aquí qué vende el chatbot, quién recibe las solicitudes y cómo se ve el widget.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nuevo hotel
          </button>
        </div>
        {hotels.length ? (
          <div className="cards">
            {hotels.map((h) => (
              <button key={h.id} className="card card-link" onClick={() => onSelectHotel(h.id)}>
                <span className="swatch" style={{ background: h.primary_color }} />
                <strong>{h.name}</strong>
                <span className="muted small mono">{h.id}</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="Todavía no hay hoteles">Crea el primero para obtener su código de widget.</Empty>
        )}
        {creating && (
          <NewHotelModal
            onClose={() => setCreating(false)}
            onCreated={(h) => {
              setCreating(false);
              onHotelsChange();
              onSelectHotel(h.id);
            }}
          />
        )}
      </section>
    );
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Knowledge · {hotel.name}</h1>
          <p className="muted">Lo que el chatbot ofrece y a quién le llegan las solicitudes de este hotel.</p>
        </div>
      </div>
      <div className="knowledge-grid">
        <ExtrasCard hotel={hotel} />
        <StaffCard hotel={hotel} />
        <SettingsCard hotel={hotel} onSaved={onHotelsChange} />
        <InstallCard hotel={hotel} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- extras

function ExtrasCard({ hotel }) {
  const toast = useToast();
  const extras = useData(() => api(`/hotels/${hotel.id}/extras`), [hotel.id]);
  const [editing, setEditing] = useState(null); // null | {} (nuevo) | extra

  async function toggle(x) {
    try {
      await api(`/hotels/${hotel.id}/extras/${x.id}`, { method: 'PUT', body: { active: !x.active } });
      extras.reload(true);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="card card-wide">
      <div className="card-head">
        <div>
          <h2>Extras que ofrece el chatbot</h2>
          <p className="muted small">Se ofrecen una sola vez, con una pregunta de sí o no, antes del resumen. Solo los activos.</p>
        </div>
        <button className="btn btn-sm" onClick={() => setEditing({})}>
          + Añadir extra
        </button>
      </div>
      {!extras.data ? (
        <Spinner />
      ) : extras.data.length === 0 ? (
        <Empty title="Sin extras">Añade parking, desayuno o lo que quieras vender. El chatbot los ofrecerá de forma suave.</Empty>
      ) : (
        <ul className="list">
          {extras.data.map((x) => (
            <li key={x.id} className={`list-item ${x.active ? '' : 'is-off'}`}>
              <label className="switch" title={x.active ? 'Activo: el chatbot lo ofrece' : 'Inactivo: no se ofrece'}>
                <input type="checkbox" checked={x.active} onChange={() => toggle(x)} aria-label={`Ofrecer ${x.name}`} />
                <span />
              </label>
              <div className="grow">
                <strong>{x.name}</strong> {x.price && <span className="muted">· {x.price}</span>}
                <div className="quote">«{x.offer_text || `¿Quieres añadir ${x.name.toLowerCase()}${x.price ? ` (${x.price})` : ''}?`}»</div>
                {x.condition_text && <div className="muted small">{x.condition_text}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(x)}>
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ExtraModal
          hotel={hotel}
          extra={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            extras.reload(true);
          }}
        />
      )}
    </div>
  );
}

function ExtraModal({ hotel, extra, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !extra.id;
  const [f, setF] = useState({ name: extra.name ?? '', price: extra.price ?? '', offer_text: extra.offer_text ?? '', condition_text: extra.condition_text ?? '', active: extra.active ?? true });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    try {
      if (isNew) await api(`/hotels/${hotel.id}/extras`, { method: 'POST', body: f });
      else await api(`/hotels/${hotel.id}/extras/${extra.id}`, { method: 'PUT', body: f });
      toast(isNew ? 'Extra añadido' : 'Extra guardado');
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    if (!confirm(`¿Eliminar "${extra.name}"? Las solicitudes antiguas lo conservan.`)) return;
    try {
      await api(`/hotels/${hotel.id}/extras/${extra.id}`, { method: 'DELETE' });
      toast('Extra eliminado');
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal
      title={isNew ? 'Nuevo extra' : `Editar ${extra.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger-ghost push-left" onClick={remove}>
              Eliminar
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" type="submit" form="extra-form">
            Guardar
          </button>
        </>
      }
    >
      <form id="extra-form" className="stack" onSubmit={save}>
        <Field label="Nombre">
          <input className="input" required value={f.name} onChange={set('name')} placeholder="Parking" />
        </Field>
        <Field label="Precio" hint="Texto libre: «10 € por noche», «incluido», «a consultar».">
          <input className="input" value={f.price} onChange={set('price')} />
        </Field>
        <Field label="Cómo lo ofrece el chatbot" hint="Una pregunta corta de sí o no. Si la dejas vacía se usa una frase estándar.">
          <textarea className="input" rows={2} value={f.offer_text} onChange={set('offer_text')} placeholder="¿Vienes en coche? Te podemos reservar un puesto de parking." />
        </Field>
        <Field label="Condición" hint="Se añade después de la pregunta.">
          <input className="input" value={f.condition_text} onChange={set('condition_text')} placeholder="Plazas limitadas" />
        </Field>
        <label className="radio">
          <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />
          Ofrecerlo en el chat
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- encargados

function StaffCard({ hotel }) {
  const toast = useToast();
  const staff = useData(() => api(`/hotels/${hotel.id}/staff`), [hotel.id]);
  const [editing, setEditing] = useState(null);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Encargados de registrar reservas</h2>
          <p className="muted small">
            Cada solicitud se avisa a quien cubre ese día ({hotel.assign_by === 'created' ? 'el día en que llega la solicitud' : 'el día de llegada del huésped'}). Si nadie lo cubre, se avisa a todos.
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => setEditing({})}>
          + Añadir
        </button>
      </div>
      {!staff.data ? (
        <Spinner />
      ) : staff.data.length === 0 ? (
        <Empty title="Sin encargados">Las solicitudes llegarán igual al panel, pero nadie recibirá el aviso.</Empty>
      ) : (
        <ul className="list">
          {staff.data.map((s) => (
            <li key={s.id} className={`list-item ${s.active ? '' : 'is-off'}`}>
              <div className="grow">
                <strong>{s.name}</strong>
                {!s.active && <span className="muted"> · inactivo</span>}
                <div className="weekdays" aria-label="Días">
                  {WEEKDAYS.map((d, i) => (
                    <span key={d} className={s.weekdays.includes(i) ? 'on' : ''}>
                      {d[0]}
                    </span>
                  ))}
                </div>
                <div className="muted small">
                  {s.email ?? s.phone ?? 'sin contacto'}
                  {(s.date_from || s.date_to) && ` · ${s.date_from ? shortDate(s.date_from) : '…'} → ${s.date_to ? shortDate(s.date_to) : '…'}`}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <StaffModal
          hotel={hotel}
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            toast(msg);
            staff.reload(true);
          }}
        />
      )}
    </div>
  );
}

function StaffModal({ hotel, person, onClose, onSaved }) {
  const isNew = !person.id;
  const [f, setF] = useState({
    name: person.name ?? '',
    email: person.email ?? '',
    phone: person.phone ?? '',
    weekdays: person.weekdays ?? [1, 2, 3, 4, 5],
    date_from: person.date_from ?? '',
    date_to: person.date_to ?? '',
    active: person.active ?? true,
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleDay = (i) => setF((x) => ({ ...x, weekdays: x.weekdays.includes(i) ? x.weekdays.filter((d) => d !== i) : [...x.weekdays, i].sort() }));

  async function save(e) {
    e.preventDefault();
    try {
      const body = { ...f, date_from: f.date_from || null, date_to: f.date_to || null };
      if (isNew) await api(`/hotels/${hotel.id}/staff`, { method: 'POST', body });
      else await api(`/hotels/${hotel.id}/staff/${person.id}`, { method: 'PUT', body });
      onSaved(isNew ? 'Encargado añadido' : 'Cambios guardados');
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    if (!confirm(`¿Eliminar a ${person.name}?`)) return;
    try {
      await api(`/hotels/${hotel.id}/staff/${person.id}`, { method: 'DELETE' });
      onSaved('Encargado eliminado');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal
      title={isNew ? 'Nuevo encargado' : `Editar ${person.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger-ghost push-left" onClick={remove}>
              Eliminar
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" type="submit" form="staff-form">
            Guardar
          </button>
        </>
      }
    >
      <form id="staff-form" className="stack" onSubmit={save}>
        <Field label="Nombre">
          <input className="input" required value={f.name} onChange={set('name')} />
        </Field>
        <div className="two">
          <Field label="Email">
            <input className="input" type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Teléfono">
            <input className="input" type="tel" value={f.phone} onChange={set('phone')} />
          </Field>
        </div>
        <fieldset>
          <legend className="field-label">Días que cubre</legend>
          <div className="day-picker">
            {WEEKDAYS.map((d, i) => (
              <button type="button" key={d} className={f.weekdays.includes(i) ? 'is-active' : ''} aria-pressed={f.weekdays.includes(i)} onClick={() => toggleDay(i)}>
                {d}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="two">
          <Field label="Desde (opcional)" hint="Para turnos de temporada">
            <input className="input" type="date" value={f.date_from} onChange={set('date_from')} />
          </Field>
          <Field label="Hasta (opcional)">
            <input className="input" type="date" value={f.date_to} min={f.date_from || undefined} onChange={set('date_to')} />
          </Field>
        </div>
        <label className="radio">
          <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />
          Activo
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- ajustes del hotel

function SettingsCard({ hotel, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  useEffect(
    () =>
      setF({
        name: hotel.name,
        room_types: hotel.room_types.join(', '),
        assign_by: hotel.assign_by,
        welcome_message: hotel.welcome_message ?? '',
        primary_color: hotel.primary_color,
        timezone: hotel.timezone,
      }),
    [hotel]
  );
  if (!f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    try {
      await api(`/hotels/${hotel.id}`, {
        method: 'PUT',
        body: { ...f, room_types: f.room_types.split(',').map((s) => s.trim()).filter(Boolean) },
      });
      toast('Ajustes guardados');
      onSaved();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="card-head">
        <h2>Ajustes del chatbot</h2>
      </div>
      <div className="stack">
        <Field label="Nombre del hotel">
          <input className="input" required value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Tipos de habitación" hint="Separados por comas. Si lo dejas vacío, el chatbot no pregunta.">
          <input className="input" value={f.room_types} onChange={set('room_types')} />
        </Field>
        <Field label="Mensaje de bienvenida">
          <textarea className="input" rows={2} value={f.welcome_message} onChange={set('welcome_message')} placeholder={`¡Hola! Soy el asistente de reservas de ${hotel.name}.`} />
        </Field>
        <Field label="¿Qué día decide quién recibe la solicitud?">
          <select className="input" value={f.assign_by} onChange={set('assign_by')}>
            <option value="check_in">El día de llegada del huésped</option>
            <option value="created">El día en que llega la solicitud</option>
          </select>
        </Field>
        <div className="two">
          <Field label="Color del widget">
            <input className="input input-color" type="color" value={f.primary_color} onChange={set('primary_color')} />
          </Field>
          <Field label="Zona horaria">
            <input className="input" value={f.timezone} onChange={set('timezone')} />
          </Field>
        </div>
        <button className="btn btn-primary" type="submit">
          Guardar ajustes
        </button>
      </div>
    </form>
  );
}

function InstallCard({ hotel }) {
  const toast = useToast();
  const snippet = `<script src="${location.origin}/widget.js" data-hotel="${hotel.id}" async></script>`;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Instalar el widget</h2>
      </div>
      <p className="muted small">Pega esta línea antes de &lt;/body&gt; en la web del hotel. Es el mismo widget para todos los hoteles; solo cambia el identificador.</p>
      <pre className="code">{snippet}</pre>
      <div className="row">
        <button
          className="btn btn-sm"
          onClick={() => navigator.clipboard?.writeText(snippet).then(() => toast('Código copiado'), () => toast('No se pudo copiar', 'error'))}
        >
          Copiar código
        </button>
        <a className="btn btn-ghost btn-sm" href={`/demo?hotel=${encodeURIComponent(hotel.id)}`} target="_blank" rel="noreferrer">
          Probar en la web de demo
        </a>
      </div>
    </div>
  );
}

function NewHotelModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    try {
      onCreated(await api('/hotels', { method: 'POST', body: { name } }));
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Modal
      title="Nuevo hotel"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="hotel-form" type="submit">
            Crear
          </button>
        </>
      }
    >
      <form id="hotel-form" className="stack" onSubmit={save}>
        <Field label="Nombre" hint="El identificador del widget se genera a partir del nombre.">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}
