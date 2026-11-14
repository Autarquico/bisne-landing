#!/usr/bin/env python3
"""Genera las instancias estáticas recortadas de las fuentes de la portada.

Desarrollo, no build: la salida se versiona y build.py no depende de fonttools.

    uvx --from fonttools --with brotli python tools/fuentes.py

- Fraunces 600 (opsz 144), solo los glifos del mensaje y de los títulos (`*_titulo`) en los cinco idiomas.
- Manrope 400 y 700, solo los glifos de los textos de las páginas estáticas.
"""
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RAIZ = Path(__file__).resolve().parent.parent
TEXTOS = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in (RAIZ / "src" / "textos").glob("*.json")}
SALIDA = RAIZ / "assets" / "fuentes"


def glifos(textos):
    return "".join(sorted(set("".join(textos))))


def generar(origen, ejes, texto, destino):
    fuente = TTFont(origen)
    fuente = instancer.instantiateVariableFont(fuente, ejes)
    opciones = subset.Options()
    opciones.flavor = "woff2"
    opciones.layout_features = ["kern", "liga", "calt"]
    opciones.notdef_outline = True
    opciones.name_IDs = [1, 2]
    opciones.hinting = False
    sub = subset.Subsetter(opciones)
    sub.populate(text=texto)
    sub.subset(fuente)
    fuente.flavor = "woff2"
    fuente.save(destino)
    print(f"{destino.relative_to(RAIZ)}: {destino.stat().st_size} bytes")


mensajes = glifos(v for t in TEXTOS.values() for k, v in t.items() if k == "mensaje" or k.endswith("_titulo"))
estaticos = glifos(v for t in TEXTOS.values() for k, v in t.items() if isinstance(v, str) and not k.startswith("c_"))
estaticos += glifos(x for t in TEXTOS.values() for k, v in t.items() if isinstance(v, list) for x in v)
base = "".join(chr(c) for c in range(0x20, 0x7F)) + "«»¿¡…·—–’‘“”"

generar(RAIZ / "tools/origen/fraunces-latin-variable.woff2", {"opsz": 144, "wght": 600}, mensajes, SALIDA / "fraunces-600-mensaje.woff2")
for peso in (400, 700):
    generar(SALIDA / "manrope-latin-variable.woff2", {"wght": peso}, base + estaticos, SALIDA / f"manrope-{peso}.woff2")
