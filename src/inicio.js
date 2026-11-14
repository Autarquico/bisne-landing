(function () {
  var d = document.documentElement;
  d.classList.add('js');
  var idiomas = ['es', 'en', 'ca', 'eu', 'gl'];
  var guardado = function (clave) { try { return localStorage.getItem(clave); } catch (e) { return null; } };
  var t = guardado('bisne-tema');
  if (t === 'dark' || t === 'light') d.dataset.theme = t;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[hreflang]');
    if (a) try { localStorage.setItem('bisne-idioma', a.hreflang); } catch (err) {}
  });
  var ya_en_otro = /^\/(en|ca|eu|gl)\//.test(location.pathname); // p. ej. el 404 español en /en/x: sin bucle
  if (d.lang !== 'es' || ya_en_otro || /bot|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent)) return;
  var elegido = guardado('bisne-idioma');
  if (idiomas.indexOf(elegido) < 0) {
    elegido = 'es';
    var del_navegador = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < del_navegador.length; i++) {
      var codigo = String(del_navegador[i]).toLowerCase().split('-')[0];
      if (idiomas.indexOf(codigo) >= 0) { elegido = codigo; break; }
    }
  }
  if (elegido !== 'es') location.replace('/' + elegido + location.pathname + location.search + location.hash);
})();
