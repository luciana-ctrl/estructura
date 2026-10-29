/*!
 * Widget de reservas por chat — un solo archivo, sin dependencias.
 *
 * Uso en la web del hotel (pegar antes de </body>):
 *   <script src="https://TU-SERVIDOR/widget.js" data-hotel="hotel-mirador" async></script>
 *
 * Atributos opcionales:
 *   data-api="https://otro-servidor"   si la API no está en el mismo origen que este archivo
 *   data-position="left"               lanzador a la izquierda (por defecto, derecha)
 *   data-label="Reservar"              texto del botón
 *   data-open="true"                   abrir el chat al cargar
 *
 * API JS: window.ReservasChat.open() · .minimize() · .toggle() · .reset()
 */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-hotel][src*="widget.js"]');
  if (!script) return;
  var HOTEL = script.getAttribute('data-hotel');
  if (!HOTEL) return console.warn('[reservas] Falta data-hotel en el <script> del widget');
  if (window.ReservasChat && window.ReservasChat.hotel === HOTEL) return; // ya cargado

  var API = (script.getAttribute('data-api') || new URL(script.src, location.href).origin).replace(/\/$/, '');
  var POSITION = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var LABEL = script.getAttribute('data-label') || 'Reservar';
  var STORE_KEY = 'reservas-chat:' + HOTEL;
  var MOBILE_MQ = window.matchMedia('(max-width: 640px)');

  // ------------------------------------------------------------ estado

  var store = load();
  var state = {
    conversationId: store.conversationId || null,
    messages: store.messages || [],
    open: false,
    busy: false,
    hotel: null,
    lastError: null,
  };

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ conversationId: state.conversationId, messages: state.messages.slice(-100), open: state.open })
      );
    } catch (e) {
      /* modo privado o almacenamiento lleno: el chat sigue funcionando sin recordar */
    }
  }

  function device() {
    return MOBILE_MQ.matches || window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  }

  // ------------------------------------------------------------ DOM (shadow DOM para no chocar con el CSS del hotel)

  var host = document.createElement('div');
  host.id = 'reservas-chat-root';
  host.style.cssText = 'position:fixed;z-index:2147483000;inset:auto;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.launcher{position:fixed;bottom:20px;' + POSITION + ':20px;display:flex;align-items:center;gap:8px;height:52px;padding:0 20px 0 16px;border:0;border-radius:26px;background:var(--rc-primary);color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);transition:transform .15s}',
    '.launcher:hover{transform:translateY(-1px)}',
    '.launcher:focus-visible,.icon-btn:focus-visible,.chip:focus-visible,.send:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}',
    '.launcher svg{width:22px;height:22px}',
    '.launcher .dot{width:9px;height:9px;border-radius:50%;background:#ffbf47;margin-left:2px}',
    '.panel{position:fixed;bottom:20px;' + POSITION + ':20px;width:380px;height:min(620px,calc(100vh - 40px));display:flex;flex-direction:column;background:#fff;color:#1d1d1f;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.22)}',
    '.panel[hidden],.launcher[hidden]{display:none}',
    '.head{display:flex;align-items:center;gap:10px;padding:14px 12px 14px 16px;background:var(--rc-primary);color:#fff}',
    '.head .t{flex:1;min-width:0}',
    '.head .n{font-size:15px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.head .s{font-size:12px;opacity:.85}',
    '.icon-btn{display:grid;place-items:center;width:40px;height:40px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}',
    '.icon-btn:hover{background:rgba(255,255,255,.24)}',
    '.icon-btn svg{width:20px;height:20px}',
    '.log{flex:1;overflow-y:auto;padding:16px 14px 8px;background:#f6f7f8;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}',
    '.msg{max-width:85%;margin:0 0 8px;padding:9px 12px;border-radius:14px;font-size:14.5px;line-height:1.4;white-space:pre-line;word-wrap:break-word}',
    '.bot{background:#fff;border:1px solid #e3e5e8;border-bottom-left-radius:4px}',
    '.guest{margin-left:auto;background:var(--rc-primary);color:#fff;border-bottom-right-radius:4px}',
    '.err{background:#fff4f2;border:1px solid #f3c2b8;color:#8a2a17}',
    '.typing{display:inline-flex;gap:4px;padding:12px 14px}',
    '.typing i{width:6px;height:6px;border-radius:50%;background:#9aa0a6;animation:b 1s infinite ease-in-out}',
    '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes b{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '.chips{display:flex;flex-wrap:wrap;gap:8px;padding:4px 14px 10px;background:#f6f7f8}',
    '.chips:empty{display:none}',
    '.chip{min-height:38px;padding:8px 14px;border:1.5px solid var(--rc-primary);border-radius:19px;background:#fff;color:var(--rc-primary);font-size:14px;font-weight:600;cursor:pointer}',
    '.chip:hover{background:var(--rc-primary);color:#fff}',
    '.bar{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #e3e5e8;background:#fff}',
    '.bar input{flex:1;min-width:0;height:44px;padding:0 14px;border:1px solid #cfd3d8;border-radius:22px;font-size:16px;color:#1d1d1f;background:#fff}',
    '.bar input:focus{outline:none;border-color:var(--rc-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--rc-primary) 20%,transparent)}',
    '.send{display:grid;place-items:center;width:44px;height:44px;flex:none;border:0;border-radius:50%;background:var(--rc-primary);color:#fff;cursor:pointer}',
    '.send:disabled{opacity:.45;cursor:default}',
    '.send svg{width:20px;height:20px}',
    '.foot{padding:0 12px 8px;background:#fff;font-size:11px;color:#80868b;text-align:center}',
    '.foot button{border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font-size:11px;padding:4px}',
    '@media (max-width:640px){',
    '  .panel{inset:0;width:100%;height:var(--rc-vh,100dvh);border-radius:0;bottom:auto;top:0}',
    '  .launcher{bottom:16px;' + POSITION + ':16px}',
    '  .head{padding-top:calc(12px + env(safe-area-inset-top))}',
    '}',
    '@media (prefers-reduced-motion:reduce){.typing i{animation:none}.launcher{transition:none}}',
  ].join('\n');

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var ICON_MIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  root.innerHTML =
    '<style>' + CSS + '</style>' +
    '<button class="launcher" type="button" aria-label="Abrir el chat de reservas">' + ICON_CHAT + '<span class="lbl"></span><span class="dot" hidden></span></button>' +
    '<section class="panel" role="dialog" aria-label="Chat de reservas" hidden>' +
    '  <header class="head"><div class="t"><div class="n">Reservas</div><div class="s">Solicitud de reserva · respuesta del hotel por email</div></div>' +
    '    <button class="icon-btn min" type="button" aria-label="Minimizar el chat" title="Minimizar">' + ICON_MIN + '</button></header>' +
    '  <div class="log" aria-live="polite"></div>' +
    '  <div class="chips"></div>' +
    '  <form class="bar"><input type="text" autocomplete="off" aria-label="Escribe tu respuesta" placeholder="Escribe tu respuesta…"><button class="send" type="submit" aria-label="Enviar">' + ICON_SEND + '</button></form>' +
    '  <div class="foot"><button type="button" class="restart">Empezar una solicitud nueva</button></div>' +
    '</section>';

  var $ = function (sel) { return root.querySelector(sel); };
  var launcher = $('.launcher');
  var panel = $('.panel');
  var log = $('.log');
  var chips = $('.chips');
  var form = $('.bar');
  var input = $('.bar input');
  var sendBtn = $('.send');
  var dot = $('.dot');
  $('.lbl').textContent = LABEL;
  host.style.setProperty('--rc-primary', '#1f6f5c');

  // ------------------------------------------------------------ render

  function formatIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
  }

  function bubble(m) {
    var el = document.createElement('div');
    el.className = 'msg ' + (m.from === 'guest' ? 'guest' : m.error ? 'bot err' : 'bot');
    el.textContent = m.from === 'guest' ? formatIso(m.text) : m.text;
    return el;
  }

  function renderAll() {
    log.textContent = '';
    state.messages.forEach(function (m) { log.appendChild(bubble(m)); });
    renderInput();
    scrollDown();
  }

  function lastBot() {
    for (var i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].from === 'bot' && !state.messages[i].error) return state.messages[i];
    return null;
  }

  function renderInput() {
    var last = state.messages[state.messages.length - 1];
    var ask = last && last.from === 'bot' ? lastBot() : null;
    chips.textContent = '';
    if (state.lastError) {
      addChip('Reintentar', function () { send(state.lastError); });
    } else if (ask && ask.options && !state.busy) {
      ask.options.forEach(function (o) { addChip(o, function () { send(o); }); });
    }
    var kind = (ask && ask.input) || 'text';
    var types = { date: 'date', email: 'email', tel: 'tel', text: 'text' };
    if (input.type !== types[kind]) {
      input.value = '';
      input.type = types[kind] || 'text';
    }
    input.min = kind === 'date' && ask.min ? ask.min : '';
    input.placeholder = kind === 'email' ? 'tu@email.com' : kind === 'tel' ? '+54 9 …' : 'Escribe tu respuesta…';
    input.inputMode = kind === 'tel' ? 'tel' : kind === 'email' ? 'email' : 'text';
    input.disabled = state.busy;
    sendBtn.disabled = state.busy;
  }

  function addChip(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = text;
    b.addEventListener('click', onClick);
    chips.appendChild(b);
  }

  var typingEl = null;
  function setBusy(busy) {
    state.busy = busy;
    if (busy && !typingEl) {
      typingEl = document.createElement('div');
      typingEl.className = 'msg bot typing';
      typingEl.setAttribute('aria-label', 'Escribiendo');
      typingEl.innerHTML = '<i></i><i></i><i></i>';
      log.appendChild(typingEl);
      scrollDown();
    } else if (!busy && typingEl) {
      typingEl.remove();
      typingEl = null;
    }
    renderInput();
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  // ------------------------------------------------------------ red

  function api(path, opts) {
    return fetch(API + path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          var e = new Error(body.error || 'Error ' + res.status);
          e.status = res.status;
          throw e;
        }
        return body;
      });
    });
  }

  function push(replies) {
    replies.forEach(function (r) {
      state.messages.push(r);
      log.appendChild(bubble(r));
    });
    if (!state.open && replies.length) dot.hidden = false;
    persist();
  }

  function startConversation() {
    state.conversationId = null;
    state.messages = [];
    state.lastError = null;
    log.textContent = '';
    setBusy(true);
    return api('/api/chat', { method: 'POST', body: JSON.stringify({ hotelId: HOTEL, device: device() }) })
      .then(function (res) {
        state.conversationId = res.conversationId;
        setBusy(false);
        push(res.replies);
        renderInput();
        scrollDown();
      })
      .catch(function () {
        setBusy(false);
        state.messages.push({ from: 'bot', error: true, text: 'No pude conectar con el hotel. Revisa tu conexión e inténtalo de nuevo.' });
        renderAll();
        chips.textContent = '';
        addChip('Reintentar', startConversation);
      });
  }

  function send(text) {
    text = String(text || '').trim();
    if (!text || state.busy) return;
    if (!state.conversationId) return startConversation();
    if (!state.lastError) {
      var mine = { from: 'guest', text: text };
      state.messages.push(mine);
      log.appendChild(bubble(mine));
    } else {
      // quitar el aviso de error anterior
      state.messages = state.messages.filter(function (m) { return !m.error; });
      renderAll();
    }
    state.lastError = null;
    input.value = '';
    setBusy(true);
    api('/api/chat', { method: 'POST', body: JSON.stringify({ hotelId: HOTEL, conversationId: state.conversationId, message: text, device: device() }) })
      .then(function (res) {
        setBusy(false);
        if (res.conversationId !== state.conversationId) {
          // la conversación ya no existía en el servidor: se empezó una nueva
          state.conversationId = res.conversationId;
          state.messages = state.messages.filter(function (m) { return m.from === 'guest'; }).slice(-1);
        }
        push(res.replies);
        renderInput();
        scrollDown();
        if (device() === 'desktop') input.focus();
      })
      .catch(function () {
        setBusy(false);
        state.lastError = text;
        state.messages.push({ from: 'bot', error: true, text: 'No se pudo enviar. Revisa tu conexión.' });
        renderAll();
      });
  }

  // ------------------------------------------------------------ abrir / minimizar

  var savedOverflow = '';
  function lockScroll(lock) {
    var el = document.documentElement;
    if (lock) {
      savedOverflow = el.style.overflow;
      el.style.overflow = 'hidden';
    } else {
      el.style.overflow = savedOverflow;
    }
  }

  function fitViewport() {
    // En móvil, el teclado reduce el área visible: el panel ocupa solo lo que se ve
    if (!window.visualViewport) return;
    host.style.setProperty('--rc-vh', window.visualViewport.height + 'px');
    if (state.open) scrollDown();
  }

  function open() {
    if (state.open) return;
    state.open = true;
    launcher.hidden = true;
    panel.hidden = false;
    dot.hidden = true;
    if (MOBILE_MQ.matches) lockScroll(true);
    fitViewport();
    persist();
    if (!state.conversationId) startConversation();
    else renderAll();
    if (!MOBILE_MQ.matches) setTimeout(function () { input.focus(); }, 50);
  }

  function minimize() {
    if (!state.open) return;
    state.open = false;
    panel.hidden = true;
    launcher.hidden = false;
    lockScroll(false);
    persist();
    launcher.focus();
  }

  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    startConversation();
  }

  launcher.addEventListener('click', open);
  $('.min').addEventListener('click', minimize);
  $('.restart').addEventListener('click', function () { send('Nueva solicitud'); });
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') minimize(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('change', function () {
    if (input.type === 'date' && input.value) send(input.value); // el calendario envía al elegir
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  MOBILE_MQ.addEventListener && MOBILE_MQ.addEventListener('change', function () { lockScroll(state.open && MOBILE_MQ.matches); });

  // ------------------------------------------------------------ arranque

  function mount() {
    document.body.appendChild(host);
    api('/api/public/hotels/' + encodeURIComponent(HOTEL))
      .then(function (h) {
        state.hotel = h;
        host.style.setProperty('--rc-primary', h.primary_color || '#1f6f5c');
        $('.n').textContent = h.name;
        panel.setAttribute('aria-label', 'Chat de reservas de ' + h.name);
      })
      .catch(function (e) {
        if (e.status === 404) console.warn('[reservas] El hotel "' + HOTEL + '" no existe en ' + API);
      });

    // Si la conversación guardada ya no existe en el servidor, se descarta
    if (state.conversationId) {
      api('/api/public/hotels/' + encodeURIComponent(HOTEL) + '/conversations/' + encodeURIComponent(state.conversationId))
        .then(function (c) {
          state.messages = c.messages;
          persist();
          if (state.open) renderAll();
        })
        .catch(function (e) {
          if (e.status === 404) {
            state.conversationId = null;
            state.messages = [];
            persist();
          }
        });
    }

    var startOpen = script.getAttribute('data-open') === 'true' || (store.open && !MOBILE_MQ.matches);
    if (startOpen) open();
  }

  window.ReservasChat = { hotel: HOTEL, open: open, minimize: minimize, toggle: function () { state.open ? minimize() : open(); }, reset: reset };

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
