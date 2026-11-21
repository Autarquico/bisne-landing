#!/usr/bin/env python3
"""Genera _dist/ a partir de src/ (plantillas) y src/textos/<idioma>.json.

Sin dependencias. Falla si a un idioma le falta o le sobra una clave, si una plantilla
usa una clave que no existe, si queda una clave sin usar, o si lo que carga la portada
antes de «Háblanos» transfiere (con gzip) más de PRESUPUESTO_BYTES.

Entorno:
  BISNE_API                  base de la API pública (por defecto https://app.bisne.es/api/publico)
  BISNE_TURNSTILE_SITEKEY    clave pública de Turnstile; vacía solo vale fuera de CI
"""
import base64
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parent
SRC = RAIZ / "src"
DIST = RAIZ / "_dist"
DOMINIO = "https://bisne.es"
API = os.environ.get("BISNE_API", "https://app.bisne.es/api/publico").rstrip("/")
SITEKEY = os.environ.get("BISNE_TURNSTILE_SITEKEY", "")
PRESUPUESTO_BYTES = 60 * 1000

# código: (nombre en su propio idioma, ruta base). El español es el idioma por defecto.
IDIOMAS = {
    "es": ("Español", "/"),
    "en": ("English", "/en/"),
    "ca": ("Català", "/ca/"),
    "eu": ("Euskara", "/eu/"),
    "gl": ("Galego", "/gl/"),
}
# página: (plantilla, fichero de salida, página a la que enlaza el selector de idioma)
PAGINAS = {
    "index": ("index.html", "index.html", ""),
    "privacidad": ("privacidad.html", "privacidad.html", "privacidad.html"),
    "aviso-legal": ("aviso-legal.html", "aviso-legal.html", "aviso-legal.html"),
    "404": ("404.html", "404.html", ""),
}
PATRON = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")
ICONO_OK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>'
EMAIL_LINK = '<a href="mailto:hola@bisne.es">hola@bisne.es</a>'
TEXTO = {".html", ".css", ".js", ".svg", ".json"}


def fallar(mensaje):
    sys.exit(f"build.py: {mensaje}")


def cargar_textos():
    textos = {}
    for codigo in IDIOMAS:
        ruta = SRC / "textos" / f"{codigo}.json"
        if not ruta.exists():
            fallar(f"falta {ruta}")
        textos[codigo] = json.loads(ruta.read_text(encoding="utf-8"))
    base = set(textos["es"])
    for codigo, t in textos.items():
        if set(t) != base:
            fallar(f"{codigo}.json: faltan {sorted(base - set(t))} sobran {sorted(set(t) - base)}")
        for clave, valor in t.items():
            if isinstance(valor, list) != isinstance(textos["es"][clave], list):
                fallar(f"{codigo}.json: «{clave}» cambia de tipo respecto a es")
            if isinstance(valor, list) and len(valor) != len(textos["es"][clave]):
                fallar(f"{codigo}.json: «{clave}» tiene otro número de elementos que es")
            if not valor:
                fallar(f"{codigo}.json: «{clave}» está vacío")
    return textos


def version_aviso(codigo, textos):
    """Versión del aviso en el idioma `codigo`: huella del idioma y de sus claves `c_aviso*`.

    Cambia cuando cambia el texto que esa persona acepta, en cualquier idioma, así que lo registrado
    (idioma + versión) identifica el texto mostrado; el historial de git conserva el de cada versión."""
    canon = json.dumps({"idioma": codigo, **{k: v for k, v in textos.items() if k.startswith("c_aviso")}}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canon.encode()).hexdigest()[:8]


def selector_idioma(actual, pagina):
    filas = []
    for codigo, (nombre, base) in IDIOMAS.items():
        marca = ' aria-current="true"' if codigo == actual else ""
        icono = ICONO_OK if codigo == actual else ""
        filas.append(f'<li><a lang="{codigo}" hreflang="{codigo}" href="{base}{pagina}"{marca}><span>{nombre}</span>{icono}</a></li>')
    return "".join(filas)


def alternativas(actual, pagina):
    url = lambda c: f"{DOMINIO}{IDIOMAS[c][1]}{pagina}"
    filas = [f'<link rel="canonical" href="{url(actual)}">']
    filas += [f'<link rel="alternate" hreflang="{c}" href="{url(c)}">' for c in IDIOMAS]
    filas.append(f'<link rel="alternate" hreflang="x-default" href="{url("es")}">')
    return "\n".join(filas)


def sitemap():
    """Cada página indexable en cada idioma, con sus traducciones como alternativas (hreflang)."""
    filas = []
    for pagina, (_, _, enlace) in PAGINAS.items():
        if pagina == "404":
            continue
        alternas = "".join(
            f'<xhtml:link rel="alternate" hreflang="{c}" href="{DOMINIO}{base}{enlace}"/>' for c, (_, base) in IDIOMAS.items()
        )
        filas += [f"<url><loc>{DOMINIO}{base}{enlace}</loc>{alternas}</url>" for _, base in IDIOMAS.values()]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + "\n".join(filas) + "\n</urlset>\n"
    )


def con_punto(texto):
    """El punto final del mensaje y de los títulos lleva el acento (landing.yml: color.accent_use)."""
    return f'{texto[:-1]}<span class="punto">.</span>' if texto.endswith(".") else texto


def render(plantilla, variables, textos, usadas):
    def incluir(m):
        ruta = SRC / f"_{m.group(1)}.html"
        if not ruta.exists():
            fallar(f"parcial inexistente: {ruta.name}")
        return ruta.read_text(encoding="utf-8").rstrip("\n")

    for _ in range(3):
        plantilla = re.sub(r"\{\{>\s*([\w-]+)\s*\}\}", incluir, plantilla)

    def sustituir(m):
        clave = m.group(1)
        if clave in variables:
            return variables[clave]
        if clave not in textos:
            fallar(f"clave inexistente «{clave}»")
        usadas.add(clave)
        valor = textos[clave]
        if isinstance(valor, list):
            return "".join(f"<li>{v}</li>" for v in valor)
        return con_punto(valor) if clave.endswith("_titulo") else valor

    for _ in range(4):
        siguiente = PATRON.sub(sustituir, plantilla)
        if siguiente == plantilla:
            break
        plantilla = siguiente
    if "{{" in plantilla:
        fallar("quedan marcas sin resolver: " + ", ".join(PATRON.findall(plantilla)[:5]))
    return plantilla


def claves_de_conversacion(textos):
    """Las claves c_* las usa assets/conv.js: cada una debe aparecer allí y viceversa."""
    codigo = (RAIZ / "assets" / "conv.js").read_text(encoding="utf-8")
    usadas = set(re.findall(r"\bc_[a-z0-9_]+\b", codigo))
    definidas = {k for k in textos["es"] if k.startswith("c_")}
    if usadas - definidas:
        fallar(f"conv.js usa claves que no existen: {sorted(usadas - definidas)}")
    if definidas - usadas:
        fallar(f"claves c_* sin usar en conv.js: {sorted(definidas - usadas)}")
    return sorted(definidas)


# ---------- presupuesto de la portada ----------

def recursos_de_portada(html):
    """Lo que el navegador pide al abrir la portada: hoja de estilos, scripts, imágenes, fuentes precargadas,
    las fuentes que declaran las hojas y los iconos de pestaña (no el apple-touch-icon, que solo pide iOS al añadir a inicio)."""
    rutas = set()
    for etiqueta in re.findall(r"<(?:link|script|img)\b[^>]*>", html):
        rel = re.search(r'rel="([^"]+)"', etiqueta)
        if rel and rel.group(1) not in {"stylesheet", "preload", "icon"}:
            continue
        destino = re.search(r'(?:href|src)="([^"]+)"', etiqueta)
        if destino and destino.group(1).startswith("/"):
            rutas.add(destino.group(1))
    for ruta in list(rutas):
        if ruta.endswith(".css"):
            css = (DIST / ruta.lstrip("/")).read_text(encoding="utf-8")
            rutas |= {u for u in re.findall(r"url\(([^)]+)\)", css) if u.startswith("/")}
    return sorted(rutas)


def medir_portada(pagina, etiqueta):
    html = pagina.read_text(encoding="utf-8")
    filas = [(etiqueta, len(html.encode()), len(gzip.compress(html.encode(), 9)))]
    for ruta in recursos_de_portada(html):
        datos = (DIST / ruta.lstrip("/")).read_bytes()
        comprimido = len(gzip.compress(datos, 9)) if Path(ruta).suffix in TEXTO else len(datos)
        filas.append((ruta, len(datos), comprimido))
    return filas


def comprobar_presupuesto():
    peor = None
    for codigo, (_, base) in IDIOMAS.items():
        filas = medir_portada(DIST / base.strip("/") / "index.html", f"{base}index.html")
        # se cuenta lo transferido: GitHub Pages sirve el texto con gzip y woff2/png ya van comprimidos
        transferido = sum(f[2] for f in filas)
        if peor is None or transferido > peor[0]:
            peor = (transferido, sum(f[1] for f in filas), codigo, filas)
    total_gz, total, codigo, filas = peor
    for ruta, crudo, gz in peor[3]:
        print(f"  {crudo:>7} B  (gzip {gz:>6})  {ruta}")
    print(f"portada antes de «Háblanos» (peor idioma: {codigo}): {total} B sin comprimir, {total_gz} B con gzip; presupuesto {PRESUPUESTO_BYTES} B")
    if total_gz > PRESUPUESTO_BYTES:
        fallar(f"la portada transfiere {total_gz} B y el presupuesto es {PRESUPUESTO_BYTES} B")


def main():
    if not SITEKEY and os.environ.get("CI"):
        fallar("falta BISNE_TURNSTILE_SITEKEY (en CI no se publica sin la clave de Turnstile)")
    if not SITEKEY:
        print("aviso: sin BISNE_TURNSTILE_SITEKEY; la conversación no podrá verificar en este _dist", file=sys.stderr)

    textos = cargar_textos()
    claves_conv = claves_de_conversacion(textos)
    versiones = {codigo: version_aviso(codigo, t) for codigo, t in textos.items()}
    inicio_js = (SRC / "inicio.js").read_text(encoding="utf-8").strip()
    hash_inicio = base64.b64encode(hashlib.sha256(inicio_js.encode()).digest()).decode()
    origen_api = "{0.scheme}://{0.netloc}".format(urlparse(API))
    usadas = set()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(RAIZ / "assets", DIST / "assets")
    shutil.copy(RAIZ / "CNAME", DIST / "CNAME")
    shutil.copy(RAIZ / "favicon.ico", DIST / "favicon.ico")  # navegadores sin icono SVG lo piden en la raíz
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {DOMINIO}/sitemap.xml\n", encoding="utf-8")
    (DIST / "sitemap.xml").write_text(sitemap(), encoding="utf-8")

    for codigo, (_, base) in IDIOMAS.items():
        salida = DIST / base.strip("/")
        salida.mkdir(parents=True, exist_ok=True)
        for pagina, (plantilla, fichero, enlace) in PAGINAS.items():
            variables = {
                "LANG": codigo, "BASE": base, "URL": f"{DOMINIO}{base}",
                "SELECTOR_IDIOMA": selector_idioma(codigo, enlace),
                "ALTERNATIVAS": alternativas(codigo, enlace),
                "INICIO_JS": inicio_js, "INICIO_HASH": hash_inicio,
                "API": API, "API_ORIGEN": origen_api, "SITEKEY": SITEKEY,
                "VERSION_AVISO": versiones[codigo], "EMAIL_LINK": EMAIL_LINK,
                "MENSAJE": con_punto(textos[codigo]["mensaje"]),
            }
            usadas.add("mensaje")
            fuente = (SRC / plantilla).read_text(encoding="utf-8")
            (salida / fichero).write_text(render(fuente, variables, textos[codigo], usadas), encoding="utf-8")
        conversacion = {k: textos[codigo][k] for k in claves_conv}
        conversacion["version_aviso"] = versiones[codigo]
        (salida / "conversacion.json").write_text(json.dumps(conversacion, ensure_ascii=False), encoding="utf-8")

    sin_usar = sorted(k for k in set(textos["es"]) - usadas if not k.startswith("c_"))
    if sin_usar:
        fallar(f"claves sin usar en las plantillas: {sin_usar}")
    print(f"ok: {len(IDIOMAS)} idiomas x {len(PAGINAS)} páginas en {DIST.relative_to(RAIZ.parent)}")
    comprobar_presupuesto()


if __name__ == "__main__":
    main()
