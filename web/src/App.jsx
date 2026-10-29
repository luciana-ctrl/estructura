import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { Modal, Spinner, ToastProvider, useData } from './ui.jsx';
import Requests from './pages/Requests.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Analytics from './pages/Analytics.jsx';

const PAGES = [
  { key: 'solicitudes', label: 'Solicitudes' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'analitica', label: 'Analítica' },
];

const HOTEL_KEY = 'reservas-panel-hotel';

function usePage() {
  const read = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'solicitudes';
  const [page, setPage] = useState(read);
  useEffect(() => {
    const h = () => setPage(read());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return page;
}

function Login({ onDone }) {
  const [value, setValue] = useState('');
  return (
    <Modal title="Acceso al panel" onClose={() => {}}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setToken(value.trim());
          onDone();
        }}
      >
        <p className="muted">Este panel está protegido. Escribe la clave del panel (variable PANEL_TOKEN del servidor).</p>
        <input className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
          Entrar
        </button>
      </form>
    </Modal>
  );
}

export default function App() {
  const page = usePage();
  const [needsLogin, setNeedsLogin] = useState(false);
  const [authTick, setAuthTick] = useState(0);
  const [hotelId, setHotelId] = useState(() => {
    try {
      return localStorage.getItem(HOTEL_KEY) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const h = () => setNeedsLogin(true);
    window.addEventListener('reservas:unauthorized', h);
    return () => window.removeEventListener('reservas:unauthorized', h);
  }, []);

  const hotels = useData(() => api('/hotels'), [authTick]);
  const meta = useData(() => api('/meta'), [authTick], { interval: 20000 });

  useEffect(() => {
    // Si el hotel guardado ya no existe, se elige el primero
    if (hotels.data && hotelId && !hotels.data.some((h) => h.id === hotelId)) setHotelId(hotels.data[0]?.id ?? '');
    if (hotels.data && !hotelId && hotels.data.length === 1) setHotelId(hotels.data[0].id);
  }, [hotels.data, hotelId]);

  useEffect(() => {
    try {
      localStorage.setItem(HOTEL_KEY, hotelId);
    } catch {
      /* sin almacenamiento */
    }
  }, [hotelId]);

  const pendingTotal = meta.data ? Object.entries(meta.data.pending).filter(([h]) => !hotelId || h === hotelId).reduce((a, [, n]) => a + n, 0) : 0;
  const hotel = hotels.data?.find((h) => h.id === hotelId) ?? null;

  return (
    <ToastProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>Reservas</span>
          </div>
          <nav className="tabs" aria-label="Secciones">
            {PAGES.map((p) => (
              <a key={p.key} href={`#/${p.key}`} className={`tab ${page === p.key ? 'is-active' : ''}`} aria-current={page === p.key ? 'page' : undefined}>
                {p.label}
                {p.key === 'solicitudes' && pendingTotal > 0 && <span className="count">{pendingTotal}</span>}
              </a>
            ))}
          </nav>
          <label className="hotel-select">
            <span className="sr-only">Hotel</span>
            <select value={hotelId} onChange={(e) => setHotelId(e.target.value)}>
              <option value="">Todos los hoteles</option>
              {hotels.data?.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          {getToken() && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setToken('');
                setNeedsLogin(true);
              }}
            >
              Salir
            </button>
          )}
        </header>

        <main className="content">
          {hotels.loading && !hotels.data ? (
            <Spinner />
          ) : page === 'knowledge' ? (
            <Knowledge hotel={hotel} hotels={hotels.data ?? []} onHotelsChange={hotels.reload} onSelectHotel={setHotelId} />
          ) : page === 'analitica' ? (
            <Analytics hotelId={hotelId} hotels={hotels.data ?? []} reasons={meta.data?.rejectionReasons ?? []} />
          ) : (
            <Requests hotelId={hotelId} hotels={hotels.data ?? []} reasons={meta.data?.rejectionReasons ?? []} onChange={() => meta.reload(true)} />
          )}
        </main>
      </div>
      {needsLogin && (
        <Login
          onDone={() => {
            setNeedsLogin(false);
            setAuthTick((t) => t + 1);
          }}
        />
      )}
    </ToastProvider>
  );
}
