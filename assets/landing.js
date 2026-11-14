(() => {
  const raiz = document.documentElement;
  const sistemaOscuro = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const esOscuro = () => (raiz.dataset.theme ? raiz.dataset.theme === 'dark' : sistemaOscuro());

  /* interruptor de tema */
  const botonTema = document.querySelector('.theme-btn');
  const pintarTema = () => botonTema.setAttribute('aria-pressed', String(esOscuro()));
  pintarTema();
  botonTema.addEventListener('click', () => {
    const nuevo = esOscuro() ? 'light' : 'dark';
    raiz.dataset.theme = nuevo;
    try { localStorage.setItem('bisne-tema', nuevo); } catch (e) { /* sin almacenamiento: vale por esta visita */ }
    pintarTema();
  });

  /* selector de idioma: se cierra con Escape y al pulsar fuera */
  const idiomas = document.querySelector('.lang details');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && idiomas.open) { idiomas.open = false; idiomas.querySelector('summary').focus(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', (e) => { if (!idiomas.contains(e.target)) idiomas.open = false; });

  /* vídeos: se cargan al acercarse y solo se reproducen mientras se ven; con movimiento reducido, quietos y con controles */
  const videos = document.querySelectorAll('video[data-src]');
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cargar = (v) => { v.poster = v.dataset.poster; v.src = v.dataset.src; v.removeAttribute('data-src'); };
  if (videos.length && 'IntersectionObserver' in window) {
    const cerca = new IntersectionObserver((entradas) => entradas.forEach((e) => {
      if (e.isIntersecting) { cargar(e.target); cerca.unobserve(e.target); }
    }), { rootMargin: '0px' });
    const visible = new IntersectionObserver((entradas) => entradas.forEach((e) => {
      if (e.isIntersecting) e.target.play().catch(() => { e.target.controls = true; });
      else e.target.pause();
    }), { threshold: 0.5 });
    videos.forEach((v) => {
      cerca.observe(v);
      if (quieto) v.controls = true;
      else visible.observe(v);
    });
  } else {
    videos.forEach((v) => { cargar(v); v.controls = true; });
  }

  /* «Háblanos»: la conversación (código, estilos, textos y Turnstile) se carga ahora, no antes.
     Todos los botones [data-abrir-chat] abren la misma, con los datos del botón #hablanos. */
  const hablanos = document.getElementById('hablanos');
  if (!hablanos) return;
  const botones = document.querySelectorAll('[data-abrir-chat]');
  let modulo = null;
  const abrir = async () => {
    if (hablanos.getAttribute('aria-busy') === 'true') return;
    botones.forEach((b) => b.setAttribute('aria-busy', 'true'));
    try {
      modulo = modulo || await import('/assets/conv.js');
      await modulo.abrir(hablanos);
    } catch (e) {
      const alternativa = document.querySelector('.sin-js');
      alternativa.classList.add('es-fallo');
      document.querySelectorAll('.solo-js').forEach((n) => { n.hidden = true; });
      alternativa.querySelector('a').focus();
    } finally {
      botones.forEach((b) => b.removeAttribute('aria-busy'));
    }
  };
  botones.forEach((b) => b.addEventListener('click', abrir));
})();
