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
 *   data-channel="panel"               uso interno: chat del personal dentro del panel (cuenta como solicitud manual)
 *
 * API JS: window.ReservasChat.open() · .minimize() · .toggle() · .reset() · .destroy()
 * Evento: window 'reservas:request-created' con detail { requestId, hotel } al enviarse una solicitud
 */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-hotel][src*="widget.js"]');
  if (!script) return;
  var HOTEL = script.getAttribute('data-hotel');
  if (!HOTEL) return console.warn('[reservas] Falta data-hotel en el <script> del widget');
  var CHANNEL = script.getAttribute('data-channel') === 'panel' ? 'panel' : 'web';
  if (window.ReservasChat) {
    if (window.ReservasChat.hotel === HOTEL && window.ReservasChat.channel === CHANNEL) return; // ya cargado
    if (window.ReservasChat.destroy) window.ReservasChat.destroy(); // otro hotel: se reemplaza
  }

  var API = (script.getAttribute('data-api') || new URL(script.src, location.href).origin).replace(/\/$/, '');
  var POSITION = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var LABEL = script.getAttribute('data-label') || 'Reservar';
  var STORE_KEY = 'reservas-chat:' + (CHANNEL === 'panel' ? 'panel:' : '') + HOTEL;
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
    '*{box-sizing:border-box;font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    // botón redondo
    '.launcher{position:fixed;bottom:20px;' + POSITION + ':20px;display:grid;place-items:center;width:58px;height:58px;border:0;border-radius:50%;background:var(--rc-header);color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(10,18,35,.32);transition:transform .15s}',
    '.launcher:hover{transform:scale(1.05)}',
    '.launcher svg{width:24px;height:24px}',
    '.launcher .i-close{display:none}',
    '.launcher.is-open .i-chat{display:none}.launcher.is-open .i-close{display:block}',
    '.launcher .dot{position:absolute;top:4px;right:4px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid var(--rc-header)}',
    '.launcher:focus-visible,.icon-btn:focus-visible,.chip:focus-visible,.send:focus-visible{outline:3px solid #93b4ff;outline-offset:2px}',
    // ventana
    '.panel{position:fixed;bottom:92px;' + POSITION + ':20px;width:380px;height:min(600px,calc(100vh - 112px));display:flex;flex-direction:column;background:#fff;color:#18202f;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(10,18,35,.28);border:1px solid rgba(10,18,35,.08)}',
    '.panel[hidden],.launcher[hidden]{display:none}',
    '.head{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 16px;background:#fff;color:#0f1729;border-bottom:1px solid #eceef3}',
    '.logo{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--rc-header);color:#fff;font-weight:800;font-size:17px;overflow:hidden}',
    '.logo img{width:100%;height:100%;object-fit:contain}',
    '.logo:has(img),.av:has(img){background:#fff;border:1px solid #e6e8ee}',
    '.head .t{flex:1;min-width:0}',
    '.head .n{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.head .s{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:12px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.head .s::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:#22c55e}',
    '.icon-btn{display:grid;place-items:center;width:34px;height:34px;flex:none;border:1px solid #e3e6ec;border-radius:9px;background:#fff;color:#4b5563;cursor:pointer}',
    '.icon-btn:hover{background:#f3f4f7;color:#0f1729}',
    '.icon-btn svg{width:17px;height:17px}',
    // mensajes
    '.log{flex:1;overflow-y:auto;padding:18px 16px 8px;background:#fff;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}',
    '.row{display:flex;align-items:flex-start;gap:10px;margin:0 0 10px}',
    '.av{flex:none;display:grid;place-items:center;width:26px;height:26px;margin-top:4px;border-radius:8px;background:var(--rc-header);color:#fff;font-size:12px;font-weight:800;overflow:hidden}',
    '.av img{width:100%;height:100%;object-fit:contain}',
    '.msg{max-width:82%;padding:11px 14px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-line;word-wrap:break-word}',
    '.bot{background:#fff;border:1px solid #e6e8ee;box-shadow:0 1px 3px rgba(10,18,35,.06);border-top-left-radius:4px}',
    '.guest{width:fit-content;margin:0 0 10px auto;background:var(--rc-accent);color:#fff;border-bottom-right-radius:4px}',
    '.err{background:#fff4f2;border-color:#f3c2b8;color:#8a2a17}',
    '.typing{display:inline-flex;gap:4px;padding:14px}',
    '.typing i{width:6px;height:6px;border-radius:50%;background:#a3aab8;animation:b 1s infinite ease-in-out}',
    '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes b{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    // respuestas rápidas
    '.chips{display:flex;flex-wrap:wrap;gap:8px;padding:2px 16px 12px 52px;background:#fff}',
    '.chips:empty{display:none}',
    '.chip{min-height:36px;padding:7px 14px;border:1px solid color-mix(in srgb,var(--rc-accent) 45%,#fff);border-radius:18px;background:color-mix(in srgb,var(--rc-accent) 7%,#fff);color:var(--rc-accent);font-size:13.5px;font-weight:600;cursor:pointer}',
    '.chip:hover{background:var(--rc-accent);border-color:var(--rc-accent);color:#fff}',
    // escribir
    '.bar{display:flex;align-items:center;gap:10px;padding:12px 14px calc(8px + env(safe-area-inset-bottom));border-top:1px solid #eceef3;background:#fff}',
    '.bar input{flex:1;min-width:0;height:44px;padding:0 14px;border:1px solid #d9dde5;border-radius:12px;font-size:16px;color:#18202f;background:#fff}',
    '.bar input::placeholder{color:#9aa1ae}',
    '.bar input:focus{outline:none;border-color:var(--rc-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--rc-accent) 18%,transparent)}',
    '.send{display:grid;place-items:center;width:42px;height:42px;flex:none;border:0;border-radius:11px;background:var(--rc-accent);color:#fff;cursor:pointer;box-shadow:0 4px 12px color-mix(in srgb,var(--rc-accent) 35%,transparent)}',
    '.send:disabled{opacity:.45;cursor:default;box-shadow:none}',
    '.send svg{width:18px;height:18px}',
    '.foot{padding:4px 12px 10px;background:#fff;font-size:11px;color:#8a91a0;text-align:center}',
    '.foot a{color:var(--rc-accent);font-weight:700;text-decoration:none}',
    // móvil: pantalla completa
    '@media (max-width:640px){',
    '  .panel{inset:0;width:100%;height:var(--rc-vh,100dvh);border-radius:0;border:0;bottom:auto;top:0}',
    '  .launcher{bottom:16px;' + POSITION + ':16px}',
    '  .launcher.is-open{display:none}',
    '  .head{padding-top:calc(14px + env(safe-area-inset-top))}',
    '}',
    '@media (prefers-reduced-motion:reduce){.typing i{animation:none}.launcher{transition:none}}',
  ].join('\n');

  var ICON_CHAT = '<svg class="i-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_NEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  var LOGO = script.getAttribute('data-logo');
  var POWERED = script.getAttribute('data-powered-by') || 'HostlyAI';
  var POWERED_URL = script.getAttribute('data-powered-url') || 'https://thehostlyai.com';

  root.innerHTML =
    '<style>' + CSS + '</style>' +
    '<button class="launcher" type="button" aria-label="Abrir el chat">' + ICON_CHAT + ICON_X.replace('<svg', '<svg class="i-close"') + '<span class="dot" hidden></span></button>' +
    '<section class="panel" role="dialog" aria-label="Chat" hidden>' +
    '  <header class="head"><div class="logo" aria-hidden="true"></div><div class="t"><div class="n">Reservas</div><div class="s">Disponible las 24 horas</div></div>' +
    '    <button class="icon-btn restart" type="button" aria-label="Empezar una solicitud nueva" title="Nueva solicitud">' + ICON_NEW + '</button>' +
    '    <button class="icon-btn min" type="button" aria-label="Minimizar el chat" title="Minimizar">' + ICON_X + '</button></header>' +
    '  <div class="log" aria-live="polite"></div>' +
    '  <div class="chips"></div>' +
    '  <form class="bar"><input type="text" autocomplete="off" aria-label="Escribe tu respuesta" placeholder="Escribe tu respuesta…"><button class="send" type="submit" aria-label="Enviar">' + ICON_SEND + '</button></form>' +
    '  <div class="foot">Con tecnología de <a target="_blank" rel="noopener"></a></div>' +
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
  var poweredLink = $('.foot a');
  poweredLink.textContent = POWERED;
  poweredLink.href = POWERED_URL;
  launcher.title = LABEL;
  if (CHANNEL === 'panel') $('.s').textContent = 'Reserva cargada por el personal';
  host.style.setProperty('--rc-header', '#0f1729');
  host.style.setProperty('--rc-accent', '#2f6bff');

  /** Logo: el de data-logo, si no el configurado en Knowledge, si no la inicial del hotel */
  function logoUrl() {
    if (LOGO) return LOGO;
    var url = state.hotel && state.hotel.logo_url;
    if (!url) return null;
    return url.charAt(0) === '/' ? API + url : url;
  }
  function initial() {
    var name = (state.hotel && state.hotel.name) || 'R';
    return document.createTextNode(name.trim().charAt(0).toUpperCase());
  }
  function logoNode() {
    var url = logoUrl();
    if (!url) return initial();
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('error', function () { img.replaceWith(initial()); });
    return img;
  }
  function paintLogo() {
    var el = $('.logo');
    el.textContent = '';
    el.appendChild(logoNode());
    log.querySelectorAll('.av').forEach(function (av) {
      av.textContent = '';
      av.appendChild(logoNode());
    });
  }

  // ------------------------------------------------------------ render

  function formatIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
  }

  function botRow(child) {
    var row = document.createElement('div');
    row.className = 'row';
    var av = document.createElement('div');
    av.className = 'av';
    av.setAttribute('aria-hidden', 'true');
    av.appendChild(logoNode());
    row.appendChild(av);
    row.appendChild(child);
    return row;
  }

  function bubble(m) {
    var el = document.createElement('div');
    el.className = 'msg ' + (m.from === 'guest' ? 'guest' : m.error ? 'bot err' : 'bot');
    el.textContent = m.from === 'guest' ? formatIso(m.text) : m.text;
    return m.from === 'guest' ? el : botRow(el);
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
      var dots = document.createElement('div');
      dots.className = 'msg bot typing';
      dots.setAttribute('aria-label', 'Escribiendo');
      dots.innerHTML = '<i></i><i></i><i></i>';
      typingEl = botRow(dots);
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
    return api('/api/chat', { method: 'POST', body: JSON.stringify({ hotelId: HOTEL, device: device(), channel: CHANNEL }) })
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
    api('/api/chat', { method: 'POST', body: JSON.stringify({ hotelId: HOTEL, conversationId: state.conversationId, message: text, device: device(), channel: CHANNEL }) })
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
        if (res.requestId) {
          try {
            window.dispatchEvent(new CustomEvent('reservas:request-created', { detail: { requestId: res.requestId, hotel: HOTEL } }));
          } catch (e) {}
        }
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
    launcher.classList.add('is-open');
    launcher.setAttribute('aria-label', 'Cerrar el chat');
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
    launcher.classList.remove('is-open');
    launcher.setAttribute('aria-label', 'Abrir el chat');
    lockScroll(false);
    persist();
    launcher.focus();
  }

  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    startConversation();
  }

  launcher.addEventListener('click', function () { state.open ? minimize() : open(); });
  $('.min').addEventListener('click', minimize);
  $('.restart').addEventListener('click', reset);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') minimize(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('change', function () {
    if (input.type === 'date' && input.value) send(input.value); // el calendario envía al elegir
  });
  function onMqChange() { lockScroll(state.open && MOBILE_MQ.matches); }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  MOBILE_MQ.addEventListener && MOBILE_MQ.addEventListener('change', onMqChange);

  function destroy() {
    if (state.open) lockScroll(false);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', fitViewport);
      window.visualViewport.removeEventListener('scroll', fitViewport);
    }
    MOBILE_MQ.removeEventListener && MOBILE_MQ.removeEventListener('change', onMqChange);
    host.remove();
    if (window.ReservasChat && window.ReservasChat.host === host) delete window.ReservasChat;
  }

  // ------------------------------------------------------------ arranque

  function mount() {
    document.body.appendChild(host);
    api('/api/public/hotels/' + encodeURIComponent(HOTEL))
      .then(function (h) {
        state.hotel = h;
        host.style.setProperty('--rc-accent', h.primary_color || '#2f6bff');
        $('.n').textContent = h.name;
        paintLogo();
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

  window.ReservasChat = {
    hotel: HOTEL,
    channel: CHANNEL,
    host: host,
    open: open,
    minimize: minimize,
    toggle: function () { state.open ? minimize() : open(); },
    reset: reset,
    destroy: destroy,
  };

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
