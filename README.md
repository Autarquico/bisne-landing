# bisne-landing

La web pública de bisne. en [bisne.es](https://bisne.es): HTML, CSS y JS estáticos en cinco idiomas,
publicados en GitHub Pages. «Háblanos» abre la conversación con el agente, que vive en la API de la app
(`app.bisne.es/api/publico`, repo `Autarquico/bisne`, `backend/bisne/landing_agente/`).

## Estructura

- `src/`: plantillas (`index.html`, `privacidad.html`, `aviso-legal.html`, `404.html` y parciales `_*.html`)
  y `src/textos/<idioma>.json` con los textos de cada idioma.
- `assets/`: estilos, scripts, fuentes, logos y vídeos.
- `build.py`: genera `_dist/` sin dependencias. Falla si faltan o sobran claves de textos o si la portada
  transfiere más de 60 KB (con gzip, como sirve GitHub Pages).
- `tools/`: `simulador.py` (API simulada para probar la página en local) y `fuentes.py` (recorte de fuentes).

## En local

    BISNE_API=http://127.0.0.1:8787/api/publico BISNE_TURNSTILE_SITEKEY=1x00000000000000000000AA python3 build.py
    python3 tools/simulador.py            # página en :8080, API simulada en :8787

## Publicar

Un push a `main` construye y publica en Pages (`.github/workflows/pages.yml`); un PR solo construye.

Los E2E de la landing (página contra el backend real) viven en la app, `frontend/e2e/landing/`, y
clonan el `main` de este repo. Un push aquí se publica sin pasar por ellos: el CI de la app los corre
cada día y a mano (`gh workflow run ci.yml -R Autarquico/bisne`), y en cada PR que toca el backend.
