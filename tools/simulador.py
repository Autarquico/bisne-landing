#!/usr/bin/env python3
"""Servidor simulado de los contratos del plan (solo stdlib) para probar la página en navegador.

    BISNE_API=http://127.0.0.1:8787/api/publico BISNE_TURNSTILE_SITEKEY=1x00000000000000000000AA python3 build.py
    python3 tools/simulador.py            # página en :8080, API en :8787

Qué responde se cambia en caliente: GET http://127.0.0.1:8787/sim/modo?abrir=503&turno=401
  abrir:    ok | 400 | 403 | 429 | 503
  turno:    ok | 401 | 409_limite | 409_curso | 429 | 503
  contacto: ok | 401 | 409 | 422 | 429
  lista:    ok | 400 | 422 | 429
Y por el texto del mensaje del interesado (se ignora mayúsculas):
  «propuesta» emite propuesta_contacto · «error» emite el evento error{proveedor} · «corta» corta el stream sin fin
  «limite» cierra con turnos_restantes=0 · «lento» tarda 4 s por delta · «larga» responde con un texto largo
"""
import json
import mimetypes
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "_dist"
ORIGEN_PAGINA = "http://127.0.0.1:8080"
MODO = {"abrir": "ok", "turno": "ok", "contacto": "ok", "lista": "ok"}
TURNOS = {}  # token -> turnos usados
FALLADAS = set()
CLAVES = {}  # clave -> eventos ya emitidos
REGISTRO = []  # lo que recibe cada llamada (para comprobar contratos)
RESUMEN = {"negocio": "Bar de tapas", "tamano": "3 personas", "que_le_quita_tiempo": "Las facturas y el papeleo de la asesoría", "que_usa_hoy": "Excel y WhatsApp", "asesoria": True, "modulos_interes": ["Facturación", "Impuestos"]}
PRIMER = "Hola, soy Agente Smith, el asistente de IA de bisne. Cuéntame: ¿qué negocio llevas?"


def evento(tipo, datos):
    return f"event: {tipo}\ndata: {json.dumps(datos, ensure_ascii=False)}\n\n".encode()


class Api(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def cabeceras(self, codigo, tipo="application/json", extra=None):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Access-Control-Allow-Origin", ORIGEN_PAGINA)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Vary", "Origin")
        for k, v in (extra or {}).items():
            self.send_header(k, v)

    def json(self, codigo, cuerpo):
        datos = json.dumps(cuerpo).encode()
        self.cabeceras(codigo)
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def error(self, codigo, nombre):
        self.json(codigo, {"error": nombre})

    def do_OPTIONS(self):
        self.cabeceras(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/sim/modo"):
            from urllib.parse import parse_qs, urlparse
            for k, v in parse_qs(urlparse(self.path).query).items():
                if k in MODO:
                    MODO[k] = v[0]
            return self.json(200, {"modo": MODO})
        if self.path == "/sim/registro":
            return self.json(200, REGISTRO)
        self.error(404, "no_existe")

    def do_POST(self):
        cuerpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        ruta = self.path.removeprefix("/api/publico/")
        REGISTRO.append({"ruta": ruta, "cuerpo": {k: v for k, v in cuerpo.items() if k != "turnstile"}, "turnstile": bool(cuerpo.get("turnstile"))})
        if ruta == "agente/abrir":
            return self.abrir(cuerpo)
        if ruta == "agente/turno":
            return self.turno(cuerpo)
        if ruta == "agente/contacto":
            return self.contacto(cuerpo)
        if ruta == "lista-espera":
            return self.lista(cuerpo)
        self.error(404, "no_existe")

    def abrir(self, c):
        m = MODO["abrir"]
        if not c.get("turnstile") or m == "400":
            return self.error(400, "turnstile")
        if not c.get("acepta_aviso") or m == "403":
            return self.error(403, "aviso_no_aceptado")
        if m == "429":
            return self.error(429, "limite_ip")
        if m == "503":
            return self.error(503, "no_disponible")
        token = uuid.uuid4().hex
        TURNOS[token] = 0
        self.json(201, {"token": token, "caduca_en": 1800, "primer_mensaje": PRIMER})

    def turno(self, c):
        m = MODO["turno"]
        token, clave, texto = c.get("token"), c.get("clave"), str(c.get("texto", ""))
        if token not in TURNOS or m == "401":
            return self.error(401, "token_invalido")
        if m == "409_limite":
            return self.error(409, "limite_conversacion")
        if m == "409_curso":
            return self.error(409, "turno_en_curso")
        if m == "429":
            return self.error(429, "limite_ip")
        if m == "503":
            return self.error(503, "no_disponible")
        if len(texto) > 1000:
            return self.error(422, "validacion")
        self.cabeceras(200, "text/event-stream", {"Cache-Control": "no-cache", "Connection": "close"})
        self.end_headers()
        self.close_connection = True
        t = texto.lower()
        if clave in CLAVES:  # misma clave: mismo resultado, sin «llamar al modelo»
            for ev in CLAVES[clave]:
                self.wfile.write(ev)
            return self.wfile.flush()
        TURNOS[token] += 1
        restantes = 0 if "limite" in t else 20 - TURNOS[token]
        delta = "Bar de tapas: lo normal es perder horas con facturas e impuestos. " if "larga" in t else "Entiendo. "
        partes = (delta * 6).split(" ") if "larga" in t else ["Entiendo.", " Te", " cuento", " qué", " hace", " bisne.", " <b>sin HTML</b> y sin enlaces."]
        emitidos = []

        def emitir(ev):
            emitidos.append(ev)
            self.wfile.write(ev)
            self.wfile.flush()

        try:
            for p in partes:
                time.sleep(4 if "lento" in t else 0.08)
                emitir(evento("texto", {"delta": p if p.startswith(" ") or p == partes[0] else " " + p}))
                if "corta" in t and p == partes[2]:
                    return
                if "error" in t and p == partes[2] and clave not in FALLADAS:
                    FALLADAS.add(clave)  # el primer intento falla; el reintento con la misma clave responde
                    emitir(evento("error", {"codigo": "proveedor"}))
                    return
            if "propuesta" in t:
                emitir(evento("propuesta_contacto", {"resumen": RESUMEN}))
            emitir(evento("fin", {"turnos_restantes": restantes}))
            CLAVES[clave] = emitidos
        except (BrokenPipeError, ConnectionResetError):
            pass

    def contacto(self, c):
        m = MODO["contacto"]
        if c.get("token") not in TURNOS or m == "401":
            return self.error(401, "token_invalido")
        if m == "409":
            return self.error(409, "sin_propuesta")
        if m == "429":
            return self.error(429, "limite_ip")
        if m == "422" or "@" not in str(c.get("email", "")) or not c.get("acepta_privacidad"):
            return self.error(422, "validacion")
        self.json(202, {"estado": "recibido"})

    def lista(self, c):
        m = MODO["lista"]
        if not c.get("turnstile") or m == "400":
            return self.error(400, "turnstile")
        if m == "429":
            return self.error(429, "limite_ip")
        if m == "422" or "@" not in str(c.get("email", "")) or not c.get("acepta_privacidad"):
            return self.error(422, "validacion")
        self.json(202, {"estado": "recibido"})


class Pagina(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        ruta = self.path.split("?")[0]
        destino = DIST / ruta.lstrip("/")
        if destino.is_dir():
            destino = destino / "index.html"
        if not destino.is_file():
            destino = DIST / "404.html"
            codigo = 404
        else:
            codigo = 200
        datos = destino.read_bytes()
        self.send_response(codigo)
        self.send_header("Content-Type", (mimetypes.guess_type(destino.name)[0] or "application/octet-stream") + ("; charset=utf-8" if destino.suffix in {".html", ".css", ".js", ".json"} else ""))
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    for puerto, clase in ((8787, Api), (8080, Pagina)):
        servidor = ThreadingHTTPServer(("127.0.0.1", puerto), clase)
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
    print("página http://127.0.0.1:8080  ·  API http://127.0.0.1:8787/api/publico  ·  modo http://127.0.0.1:8787/sim/modo", file=sys.stderr)
    threading.Event().wait()
