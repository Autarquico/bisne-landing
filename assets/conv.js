/* Conversación con el asistente. Se carga al pulsar «Háblanos» (landing.js).
 * Todo lo que escribe el interesado o el agente se pinta con textContent: nunca HTML.
 * Contratos: docs/specs/landing.md del repo de la app (Autarquico/bisne). */

const raiz = document.documentElement;
const main = document.getElementById('contenido');
const mensaje = document.getElementById('mensaje');

let boton, cfg, T;
let preparado = null;
const conv = { token: null, propuesta: null, turno: null, ocupado: false, contactoEnviado: false };
const vistas = {};
let actual = 'mensaje';
let estadoSR;
let widget = null;
let ctaInicial = '';

const t = (k) => T[k];
const q = (el, sel) => el.querySelector(sel);

function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') nodo.className = v;
    else if (k === 'text') nodo.textContent = v;
    else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
    else if (v === true) nodo.setAttribute(k, '');
    else if (v !== false && v != null) nodo.setAttribute(k, v);
  }
  for (const h of hijos.flat()) if (h != null) nodo.append(h);
  return nodo;
}

/* texto con un enlace marcado como [[así]] */
function conEnlace(clave, href) {
  const [antes, resto] = t(clave).split('[[');
  const [texto, despues] = resto.split(']]');
  return [antes, el('a', { href, target: '_blank', rel: 'noopener', text: texto }), despues];
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const temaActual = () => (raiz.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

function anunciar(texto) {
  estadoSR.textContent = '';
  requestAnimationFrame(() => { estadoSR.textContent = texto; });
}

/* ---------- carga y arranque ---------- */

function cargarEstilos() {
  return new Promise((ok, mal) => {
    const link = el('link', { rel: 'stylesheet', href: '/assets/conv.css' });
    link.onload = ok;
    link.onerror = mal;
    document.head.append(link);
  });
}

async function preparar() {
  cfg = boton.dataset;
  const [textos] = await Promise.all([fetch(cfg.textos).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }), cargarEstilos()]);
  T = textos;
  estadoSR = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  main.append(estadoSR);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && actual !== 'mensaje' && !document.querySelector('.lang details[open]')) volver();
  });
}

export async function abrir(b) {
  boton = b;
  ctaInicial = ctaInicial || b.textContent;
  preparado = preparado || preparar();
  await preparado;
  if (conv.token) mostrar('conv');
  else mostrarAviso();
}

/* ---------- estados ---------- */

function mostrar(nombre, foco) {
  const veniaDelMensaje = actual === 'mensaje';
  actual = nombre;
  mensaje.hidden = nombre !== 'mensaje';
  for (const [n, v] of Object.entries(vistas)) v.hidden = n !== nombre;
  const vista = vistas[nombre];
  if (vista && veniaDelMensaje) { vista.classList.add('entra'); vista.addEventListener('animationend', () => vista.classList.remove('entra'), { once: true }); }
  const destino = foco || (nombre === 'mensaje' ? boton : focoVisible(vista));
  window.scrollTo(0, 0);
  if (destino) destino.focus();
}

/* primer destino de foco realmente visible (la conversación oculta su compositor al agotar turnos) */
function focoVisible(vista) {
  if (!vista) return null;
  const visibles = [...vista.querySelectorAll('[data-foco]')].filter((x) => !x.closest('[hidden]'));
  return visibles[0] || q(vista, 'h1');
}

function registrar(nombre, vista) {
  vistas[nombre]?.remove();
  vistas[nombre] = vista;
  vista.hidden = true;
  main.insertBefore(vista, estadoSR);
}

function botonVolver() {
  return el('button', { class: 'btn btn--sec volver', type: 'button', onclick: volver, 'aria-label': conv.token ? t('c_cerrar_aria') : null, text: t('c_volver') });
}

function volver() {
  if (conv.token) boton.textContent = t('c_seguir');
  mostrar('mensaje');
}

function titulo(clave, extra = {}) {
  return el('h1', { tabindex: '-1', 'data-foco': '', text: t(clave), ...extra });
}

/* aviso de datos */
function mostrarAviso() {
  const vista = el('section', { class: 'estado', 'aria-labelledby': 'h-aviso' },
    botonVolver(),
    titulo('c_aviso_h', { id: 'h-aviso' }),
    el('p', { text: t('c_aviso_p') }),
    el('ul', {}, t('c_aviso_li').map((x) => el('li', { text: x }))),
    el('p', {}, el('a', { href: cfg.privacidad, target: '_blank', rel: 'noopener', text: t('c_aviso_priv') })),
    el('div', { class: 'acciones' },
      el('button', { class: 'btn', type: 'button', onclick: empezar, text: t('c_aviso_si') }),
      el('button', { class: 'btn btn--sec', type: 'button', onclick: () => planB('no_acepta'), text: t('c_aviso_no') })));
  registrar('aviso', vista);
  mostrar('aviso');
}

/* Turnstile: se carga al aceptar el aviso o al abrir el formulario corto */
let turnstileCargado = null;
function cargarTurnstile() {
  turnstileCargado = turnstileCargado || new Promise((ok, mal) => {
    const s = el('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    s.onload = () => (window.turnstile ? ok(window.turnstile) : mal(new Error('turnstile')));
    s.onerror = () => { turnstileCargado = null; mal(new Error('turnstile')); };
    document.head.append(s);
  });
  return turnstileCargado;
}

async function verificar(contenedor, alToken, alFallo) {
  try {
    const ts = await cargarTurnstile();
    if (widget !== null) { try { ts.remove(widget); } catch (e) { /* ya no existe */ } }
    contenedor.replaceChildren();
    widget = ts.render(contenedor, {
      sitekey: cfg.sitekey, theme: temaActual(), language: cfg.lang, appearance: 'interaction-only',
      callback: alToken, 'expired-callback': () => alToken(''), 'error-callback': alFallo,
    });
  } catch (e) { alFallo(); }
}

/* verificando → abrir */
function empezar() {
  const contenedor = el('div', { class: 'turnstile' });
  const vista = el('section', { class: 'estado', 'aria-labelledby': 'h-verif' },
    botonVolver(), titulo('c_verif', { id: 'h-verif' }), contenedor);
  registrar('verif', vista);
  mostrar('verif');
  verificar(contenedor, (token) => { if (token) abrirConversacion(token); }, () => errorVerificacion(vista));
}

function errorVerificacion(vista) {
  vista.replaceChildren(botonVolver(),
    titulo('c_verif_error', { id: 'h-verif' }),
    el('div', { class: 'acciones' },
      el('button', { class: 'btn', type: 'button', onclick: empezar, text: t('c_reintentar') }),
      el('button', { class: 'btn btn--sec', type: 'button', onclick: () => planB(null), text: t('c_plan_b_link') })));
  if (actual === 'verif') mostrar('verif');
}

async function post(ruta, cuerpo, signal) {
  return fetch(`${cfg.api}/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(cuerpo), signal });
}
const codigoError = async (r) => { try { return (await r.json()).error; } catch (e) { return null; } };

async function abrirConversacion(turnstile) {
  let r;
  try { r = await post('agente/abrir', { turnstile, idioma: cfg.lang, acepta_aviso: true, version_aviso: T.version_aviso, hora: new Date().getHours() }); }
  catch (e) { return errorVerificacion(vistas.verif); }
  if (r.status === 201) {
    const datos = await r.json();
    conv.token = datos.token;
    return iniciarConversacion(datos.primer_mensaje);
  }
  const codigo = await codigoError(r);
  if (r.status === 429) return planB('limite_ip');
  if (r.status === 503 || codigo === 'no_disponible') return planB('no_disponible');
  if (r.status === 403) return planB('no_acepta');
  errorVerificacion(vistas.verif);
}

/* conversación */
function iniciarConversacion(primerMensaje) {
  const mostrarla = actual === 'verif';
  const log = el('div', { class: 'log', role: 'log', 'aria-live': 'off', 'aria-label': t('c_log_aria') });
  const zona = el('div', { class: 'zona' });
  const hilo = el('div', { class: 'hilo', tabindex: '0' }, log, zona); // zona con scroll: se alcanza con el teclado
  const campo = el('textarea', { id: 'mensaje-campo', rows: '3', maxlength: '1000', 'aria-describedby': 'ayuda-campo', autocomplete: 'off', 'data-foco': '' });
  const enviar = el('button', { class: 'btn', type: 'submit', text: t('c_enviar') });
  const compositor = el('form', { class: 'compositor', novalidate: true },
    el('div', { class: 'campo' },
      el('label', { for: 'mensaje-campo', text: t('c_campo') }),
      el('div', { class: 'compositor__fila' }, campo, enviar),
      el('p', { class: 'ayuda', id: 'ayuda-campo', text: t('c_ayuda') })));
  const enlaceEmail = el('button', { class: 'btn btn--sec', type: 'button', onclick: () => planB(null), text: t('c_plan_b_link') });
  const vista = el('section', { class: 'estado estado--conv', 'aria-labelledby': 'h-conv' },
    el('div', { class: 'acciones' }, botonVolver(), enlaceEmail),
    el('h1', { class: 'sr-only', id: 'h-conv', text: t('c_conv_titulo') }),
    hilo, compositor);
  Object.assign(conv, { log, zona, hilo, campo, enviar, compositor, vista, enlaceEmail, contactoEnviado: false });
  registrar('conv', vista);
    agregarTurno('bot', primerMensaje);
  anunciar(`${t('c_bot')}: ${primerMensaje}`);
  boton.textContent = t('c_seguir');
  if (mostrarla) mostrar('conv');

  compositor.addEventListener('submit', (e) => { e.preventDefault(); enviarMensaje(); });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviarMensaje(); }
  });
}

function agregarTurno(quien, texto = '') {
  const cuerpo = el('div', { class: 'turno__texto', text: texto });
  const li = el('div', { class: `turno turno--${quien}` },
    el('span', { class: 'turno__quien', text: quien === 'bot' ? t('c_bot') : t('c_tu') }), cuerpo);
  conv.log.append(li);
  alFinal();
  return { li, cuerpo };
}

/* la conversación corre dentro de su zona, como un chat: lo último, siempre a la vista */
function alFinal() { conv.hilo.scrollTop = conv.hilo.scrollHeight; }

/* mientras llega la respuesta, solo sigue el final si la persona no ha subido a releer */
function seguirSiAbajo() {
  const { scrollTop, scrollHeight, clientHeight } = conv.hilo;
  if (scrollHeight - scrollTop - clientHeight < 80) alFinal();
}

/* con la tarjeta a la vista, la caja de mensaje se aparta: en pantallas bajas no cabrían el email y «Enviar» */
function enZona(nodo) {
  conv.vista.classList.toggle('con-tarjeta', nodo.classList.contains('tarjeta'));
  conv.zona.replaceChildren(nodo);
  alFinal();
}

/* un solo camino al email a la vez: ni con la tarjeta abierta ni después de haberlo dejado */
function limpiarZona() { conv.zona.replaceChildren(); conv.vista.classList.remove('con-tarjeta'); conv.enlaceEmail.hidden = conv.contactoEnviado; }

function enviarMensaje() {
  if (conv.ocupado) return;
  const texto = conv.campo.value.trim();
  if (!texto) { conv.campo.focus(); return; }
  conv.campo.value = '';
  limpiarZona();
  conv.turno = { texto, clave: uuid(), usuario: agregarTurno('tu', texto) };
  turno();
}

async function turno() {
  const { texto, clave } = conv.turno;
  conv.ocupado = true;
  conv.enviar.disabled = true;
  conv.campo.focus();
  conv.turno.bot?.li.remove();
  const bot = agregarTurno('bot');
  bot.cuerpo.dataset.espera = t('c_escribiendo');
  bot.li.setAttribute('aria-busy', 'true');
  conv.turno.bot = bot;
  const sesion = conv.token;

  let fin = false, error = null, propuestaNueva = false, restantes = null, acumulado = '';
  try {
    const r = await post('agente/turno', { token: sesion, clave, texto });
    if (!r.ok) { error = (await codigoError(r)) || `http_${r.status}`; if (r.status === 429) error = 'limite_ip'; }
    else {
      const lector = r.body.getReader();
      const decodificador = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });
        const bloques = buffer.split(/\r?\n\r?\n/);
        buffer = bloques.pop();
        for (const bloque of bloques) {
          const ev = leerEvento(bloque);
          if (!ev) continue;
          if (ev.tipo === 'texto') { acumulado += ev.datos.delta ?? ''; bot.cuerpo.textContent = acumulado; seguirSiAbajo(); }
          else if (ev.tipo === 'propuesta_contacto') { conv.propuesta = ev.datos.resumen; propuestaNueva = true; }
          else if (ev.tipo === 'fin') { fin = true; restantes = ev.datos.turnos_restantes; }
          else if (ev.tipo === 'error') { error = ev.datos.codigo || 'proveedor'; }
        }
      }
    }
  } catch (e) { error = error || 'red'; }

  conv.ocupado = false;
  conv.enviar.disabled = false;
  bot.li.removeAttribute('aria-busy');
  if (error || !fin) return falloTurno(error || 'red');
  conv.turno = null;
  anunciar(`${t('c_bot')}: ${acumulado}`);
  if (restantes === 0) return limite();
  if (propuestaNueva && !conv.contactoEnviado) tarjeta();
}

function leerEvento(bloque) {
  let nombre = null; const datos = [];
  for (const linea of bloque.split(/\r?\n/)) {
    if (linea.startsWith('event:')) nombre = linea.slice(6).trim();
    else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''));
  }
  if (!datos.length) return null;
  try {
    const obj = JSON.parse(datos.join('\n'));
    return { tipo: nombre || obj.evento || obj.tipo, datos: obj.datos || obj };
  } catch (e) { return null; }
}

/* El turno puede acabar con la conversación oculta (portada, aviso del plan B…): el estado se guarda
 * siempre, pero el foco y el cambio de vista solo se aplican si la persona sigue en la conversación. */
const enConversacion = () => actual === 'conv';
/* sin mover el hilo: `enZona` ya lo bajó para que se vea entero lo que hay que hacer (el email y «Enviar») */
const enfocar = (nodo) => { if (enConversacion()) nodo.focus({ preventScroll: true }); };

function falloTurno(codigo) {
  conv.turno?.bot?.li.remove();
  if (codigo === 'token_invalido' || codigo === 'http_401') return caducada();
  if (codigo === 'limite_conversacion') return limite();
  /* a la vista el formulario corto con el motivo; oculta, no se pisa lo que la persona esté haciendo */
  if (enConversacion() && codigo === 'limite_ip') return planB('limite_ip');
  if (enConversacion() && (codigo === 'no_disponible' || codigo === 'http_503')) return planB('no_disponible');
  const texto = codigo === 'turno_en_curso' ? t('c_turno_en_curso') : t('c_error_turno');
  const bloque = el('div', { class: 'aviso-turno aviso-turno--error', role: 'alert', tabindex: '-1', 'data-foco': '' },
    el('p', { text: texto }),
    el('div', { class: 'acciones' },
      el('button', { class: 'btn', type: 'button', onclick: () => { limpiarZona(); turno(); }, text: t('c_reintentar') }),
      el('button', { class: 'btn btn--sec', type: 'button', onclick: () => planB(null), text: t('c_plan_b_link') })));
  enZona(bloque);
  enfocar(bloque);
}

function caducada(emailEscrito = '') {
  const previo = { email: emailEscrito, tiempo: conv.propuesta?.que_le_quita_tiempo || '' };
  conv.token = null; conv.propuesta = null; conv.turno = null;
  const vista = el('section', { class: 'estado', 'aria-labelledby': 'h-cad' },
    botonVolver(), titulo('c_caducada', { id: 'h-cad' }),
    el('div', { class: 'acciones' },
      el('button', { class: 'btn', type: 'button', onclick: mostrarAviso, text: t('c_reiniciar') }),
      conv.contactoEnviado ? null : el('button', { class: 'btn btn--sec', type: 'button', onclick: () => planB(null, previo), text: t('c_plan_b_link') })));
  registrar('caducada', vista);
  boton.textContent = ctaInicial;
  if (enConversacion() || actual === 'caducada') mostrar('caducada');
}

function limite() {
  conv.compositor.hidden = true;
  const aviso = t(conv.contactoEnviado ? 'c_limite_enviado' : 'c_limite');
  const bloque = el('div', { class: 'aviso-turno', tabindex: '-1', 'data-foco': '' },
    el('p', { text: aviso }),
    conv.contactoEnviado ? null : el('div', { class: 'acciones' },
      el('button', { class: 'btn', type: 'button', onclick: () => (conv.propuesta ? tarjeta() : planB(null)), text: t('c_dejar_email') })));
  enZona(bloque);
  if (enConversacion()) anunciar(aviso);
  enfocar(bloque);
}

/* tarjeta de contacto: la decide la persona, no el agente (P12 adaptada) */
function tarjeta() {
  const r = conv.propuesta || {};
  const valor = (v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? t('c_r_vacio') : typeof v === 'boolean' ? t(v ? 'c_si' : 'c_no') : Array.isArray(v) ? v.join(', ') : String(v));
  const filas = [['c_r_negocio', r.negocio], ['c_r_tamano', r.tamano], ['c_r_tiempo', r.que_le_quita_tiempo], ['c_r_usa', r.que_usa_hoy], ['c_r_asesoria', r.asesoria], ['c_r_modulos', r.modulos_interes]];
  const email = el('input', { type: 'email', id: 'tarjeta-email', name: 'email', autocomplete: 'email', inputmode: 'email', 'aria-describedby': 'tarjeta-email-error' });
  const emailError = el('p', { class: 'error', id: 'tarjeta-email-error', hidden: true });
  const acepta = el('input', { type: 'checkbox', id: 'tarjeta-priv', 'aria-describedby': 'tarjeta-priv-error' });
  const privError = el('p', { class: 'error', id: 'tarjeta-priv-error', hidden: true });
  const fallo = el('p', { class: 'error', role: 'alert', hidden: true });
  const enviar = el('button', { class: 'btn', type: 'submit', text: t('c_t_enviar') });
  const titulo2 = el('h2', { id: 'h-tarjeta', tabindex: '-1', 'data-foco': '', text: t('c_t_h') });
  const form = el('form', { class: 'tarjeta', novalidate: true, 'aria-labelledby': 'h-tarjeta' },
    titulo2,
    el('p', { text: t('c_t_p') }),
    el('details', { open: true }, el('summary', { text: t('c_t_resumen') }),
      el('dl', {}, filas.flatMap(([k, v]) => [el('dt', { text: t(k) }), el('dd', { text: valor(v) })]))),
    el('div', { class: 'campo' }, el('label', { for: 'tarjeta-email', text: t('c_pb_email') }), email, emailError),
    el('div', { class: 'campo' }, el('div', { class: 'check' }, acepta, el('label', { for: 'tarjeta-priv' }, conEnlace('c_pb_priv', cfg.privacidad))), privError),
    fallo,
    el('div', { class: 'acciones' }, enviar,
      el('button', { class: 'btn btn--sec', type: 'button', 'aria-label': t('c_t_no_aria'), text: t('c_t_no'), onclick: () => {
        limpiarZona(); anunciar(t('c_t_no_anuncio')); conv.campo.focus();
        if (conv.compositor.hidden) planB(null);
      } })));
  enZona(form);
  conv.enlaceEmail.hidden = true;
  enfocar(titulo2);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validar(email, emailError, acepta, privError);
    if (v) return v.focus();
    enviar.disabled = true; enviar.setAttribute('aria-busy', 'true'); fallo.hidden = true;
    let respuesta;
    try { respuesta = await post('agente/contacto', { token: conv.token, email: email.value.trim(), acepta_privacidad: true }); }
    catch (err) { respuesta = null; }
    enviar.disabled = false; enviar.removeAttribute('aria-busy');
    if (respuesta?.status === 202) {
      conv.propuesta = null; conv.contactoEnviado = true; conv.enlaceEmail.hidden = true;
      const ok = el('div', { class: 'aviso-turno', tabindex: '-1', role: 'status', 'data-foco': '' }, el('p', { text: t('c_t_ok') }));
      enZona(ok);
      ok.focus();
      return;
    }
    const codigo = respuesta ? await codigoError(respuesta) : null;
    if (respuesta?.status === 401) return caducada(email.value.trim());
    if (codigo === 'sin_propuesta') { conv.propuesta = null; fallo.textContent = t('c_t_sin_propuesta'); }
    else if (respuesta?.status === 422) { marcar(email, emailError, t('c_error_email')); email.focus(); return; }
    else if (respuesta?.status === 429) fallo.textContent = t('c_error_429');
    else fallo.textContent = t('c_error_envio');
    fallo.hidden = false;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function marcar(input, p, texto) {
  input.setAttribute('aria-invalid', String(Boolean(texto)));
  p.hidden = !texto;
  p.textContent = texto || '';
}
function validar(email, emailError, acepta, privError) {
  const malEmail = !EMAIL_RE.test(email.value.trim());
  marcar(email, emailError, malEmail ? t('c_error_email') : '');
  marcar(acepta, privError, acepta.checked ? '' : t('c_error_priv'));
  return malEmail ? email : acepta.checked ? null : acepta;
}

/* formulario corto (plan B) */
function planB(motivo, previo = {}) {
  const email = el('input', { type: 'email', id: 'pb-email', name: 'email', autocomplete: 'email', inputmode: 'email', 'aria-describedby': 'pb-email-error' });
  const emailError = el('p', { class: 'error', id: 'pb-email-error', hidden: true });
  const tiempo = el('textarea', { id: 'pb-tiempo', name: 'que_te_quita_tiempo', maxlength: '500', rows: '3' });
  const trampa = el('input', { type: 'text', name: 'sitio', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
  const acepta = el('input', { type: 'checkbox', id: 'pb-priv', 'aria-describedby': 'pb-priv-error' });
  const privError = el('p', { class: 'error', id: 'pb-priv-error', hidden: true });
  const fallo = el('p', { class: 'error', role: 'alert', hidden: true });
  const reintentar = el('button', { class: 'btn btn--sec', type: 'button', hidden: true, text: t('c_reintentar') });
  const contenedor = el('div', { class: 'turnstile' });
  const enviar = el('button', { class: 'btn', type: 'submit', text: t('c_pb_enviar') });
  const motivoTexto = { no_acepta: 'c_motivo_no_acepta', no_disponible: 'c_motivo_no_disponible', limite_ip: 'c_motivo_limite_ip' }[motivo];
  const h = titulo('c_pb_h', { id: 'h-pb' });
  const vista = el('section', { class: 'estado', 'aria-labelledby': 'h-pb' },
    botonVolver(), h,
    motivoTexto ? el('p', { text: t(motivoTexto) }) : null,
    el('p', { text: t('c_pb_intro') }),
    el('form', { novalidate: true },
      el('div', { class: 'campos' },
        el('div', { class: 'campo' }, el('label', { for: 'pb-email', text: t('c_pb_email') }), email, emailError),
        el('div', { class: 'campo' }, el('label', { for: 'pb-tiempo', text: t('c_pb_tiempo') }), tiempo),
        el('div', { class: 'trampa', 'aria-hidden': 'true' }, trampa),
        el('div', { class: 'campo' }, el('div', { class: 'check' }, acepta, el('label', { for: 'pb-priv' }, conEnlace('c_pb_priv', cfg.privacidad))), privError),
        contenedor, fallo,
        el('div', { class: 'acciones' }, reintentar, enviar))));
  registrar('planb', vista);
  mostrar('planb');

  let token = '';
  const fallaVerificacion = () => {
    token = '';
    fallo.textContent = t('c_verif_error'); fallo.hidden = false; reintentar.hidden = false;
    reintentar.focus();
  };
  const nuevoToken = () => { token = ''; verificar(contenedor, (x) => { token = x; }, fallaVerificacion); };
  reintentar.addEventListener('click', () => { fallo.hidden = true; reintentar.hidden = true; nuevoToken(); email.focus(); });
  if (previo.email) email.value = previo.email;
  if (previo.tiempo) tiempo.value = previo.tiempo;
  nuevoToken();

  q(vista, 'form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validar(email, emailError, acepta, privError);
    if (v) return v.focus();
    if (!token) { fallo.textContent = t('c_error_verif_envio'); fallo.hidden = false; return; }
    enviar.disabled = true; enviar.setAttribute('aria-busy', 'true'); fallo.hidden = true;
    let r;
    try { r = await post('lista-espera', { email: email.value.trim(), acepta_privacidad: true, que_te_quita_tiempo: tiempo.value.trim(), sitio: trampa.value, turnstile: token }); }
    catch (err) { r = null; }
    enviar.disabled = false; enviar.removeAttribute('aria-busy');
    if (r?.status === 202) return planBEnviado();
    if (r?.status === 422) { marcar(email, emailError, t('c_error_email')); email.focus(); }
    else { fallo.textContent = r?.status === 429 ? t('c_error_429') : t('c_error_envio'); fallo.hidden = false; }
    nuevoToken();
  });
}

function planBEnviado() {
  const vista = el('section', { class: 'estado', 'aria-labelledby': 'h-pbok' },
    botonVolver(), titulo('c_pb_ok_h', { id: 'h-pbok' }), el('p', { role: 'status', text: t('c_pb_ok') }));
  registrar('planbok', vista);
  mostrar('planbok');
}
