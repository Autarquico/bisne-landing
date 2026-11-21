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

  /* módulos: la fila se desliza con el dedo, la rueda o arrastrando con el ratón. Con movimiento permitido además
     avanza sola y en bucle: las tarjetas se duplican (copias ocultas a lectores y fuera del tabulador) y, cerca de un borde,
     la posición salta una vuelta atrás o adelante sin que se note. */
  const carrusel = document.querySelector('.carrusel');
  let recienArrastrado = false;
  if (carrusel) {
    let arrastre = null;
    // el arrastre empieza al moverse unos píxeles: así un clic o un doble clic siguen llegando a la tarjeta
    carrusel.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      arrastre = { x: e.clientX, desde: carrusel.scrollLeft, id: e.pointerId, moviendo: false };
    });
    carrusel.addEventListener('pointermove', (e) => {
      if (!arrastre) return;
      const dx = e.clientX - arrastre.x;
      if (!arrastre.moviendo && Math.abs(dx) > 4) {
        arrastre.moviendo = true;
        carrusel.setPointerCapture(arrastre.id);
        carrusel.classList.add('arrastrando');
      }
      if (arrastre.moviendo) carrusel.scrollLeft = arrastre.desde - dx;
    });
    const soltar = () => {
      recienArrastrado = Boolean(arrastre?.moviendo);
      setTimeout(() => { recienArrastrado = false; });
      arrastre = null;
      carrusel.classList.remove('arrastrando');
    };
    carrusel.addEventListener('pointerup', soltar);
    carrusel.addEventListener('pointercancel', soltar);

    if (!quieto) {
      const pista = carrusel.querySelector('.carrusel__pista');
      const originales = [...pista.children];
      originales.forEach((li) => {
        const copia = li.cloneNode(true);
        copia.setAttribute('aria-hidden', 'true');
        copia.querySelectorAll('button').forEach((b) => { b.tabIndex = -1; });
        pista.append(copia);
      });
      carrusel.classList.add('desfila');
      const vuelta = () => pista.children[originales.length].offsetLeft - originales[0].offsetLeft;
      const VELOCIDAD = 70; // px por segundo
      let posicion = 0, encima = false, tocando = false, antes = null;
      const situar = (x) => { posicion = x; carrusel.scrollLeft = x; };
      // se empieza en la segunda copia para poder ir hacia los dos lados; cerca de un borde, se salta una vuelta
      const enBucle = () => {
        if (posicion <= 1) situar(posicion + vuelta());
        else if (posicion >= vuelta() * 2 - carrusel.clientWidth - 1) situar(posicion - vuelta());
      };
      situar(vuelta());
      carrusel.addEventListener('scroll', () => {
        if (Math.abs(carrusel.scrollLeft - posicion) > 2) posicion = carrusel.scrollLeft; // la ha movido la persona
        enBucle();
      }, { passive: true });
      carrusel.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') encima = true; });
      carrusel.addEventListener('pointerleave', () => { encima = false; });
      carrusel.addEventListener('touchstart', () => { tocando = true; }, { passive: true });
      carrusel.addEventListener('touchend', () => { setTimeout(() => { tocando = false; }, 1500); }, { passive: true });
      const avanzar = (ahora) => {
        const parado = encima || tocando || arrastre || carrusel.matches(':focus-visible, :has(:focus-visible)') || document.querySelector('dialog[open]');
        if (antes !== null && !parado) {
          situar(posicion + VELOCIDAD * Math.min(ahora - antes, 100) / 1000);
          enBucle();
        }
        antes = ahora;
        requestAnimationFrame(avanzar);
      };
      requestAnimationFrame(avanzar);
    }
  }

  /* fichas de módulo: un clic o un toque en la tarjeta (también en las copias del bucle) la abre, igual que Intro
     sobre su nombre; arrastrar no cuenta como clic. Al abrirse, su checklist se marca de nuevo y el carrusel se para. */
  const abrirFicha = (id) => {
    const ficha = document.getElementById(id);
    if (!ficha || ficha.open) return;
    const lista = ficha.querySelector('.checklist');
    lista.classList.remove('marcada');
    ficha.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => lista.classList.add('marcada')));
  };
  if (carrusel) {
    carrusel.addEventListener('click', (e) => {
      if (recienArrastrado) return;
      const id = e.target.closest('li')?.querySelector('[data-ficha]')?.dataset.ficha;
      if (id) abrirFicha(id);
    });
  }
  document.querySelectorAll('dialog.modal').forEach((ficha) => {
    ficha.querySelector('[data-cerrar]').addEventListener('click', () => ficha.close());
    ficha.addEventListener('click', (e) => { if (e.target === ficha) ficha.close(); }); // clic en el fondo
  });

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
