"""
Planificador de Estudio - Servidor Web

Para ejecutarlo:   py server.py
Después abrís:     http://localhost:5000

Solo necesita Flask. ReportLab es opcional (para el PDF) y la IA se
conecta con librerías que ya trae Python, sin instalar nada más.
"""

import io
import json
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

from flask import Flask, render_template, request, jsonify, send_file

from planificador import Examen, Tema, generar_plan
from exportar_pdf import exportar_plan_a_pdf, HAY_REPORTLAB

CARPETA = os.path.dirname(os.path.abspath(__file__))

# Los archivos de diseño (CSS y JS) están en public/static:
#  - en tu compu los sirve Flask,
#  - en Vercel los sirve directamente su CDN desde la carpeta public/.
app = Flask(__name__, static_folder=os.path.join(CARPETA, "public", "static"), static_url_path="/static")


def leer_clave_api():
    """
    Busca la clave de la IA (Groq, OpenRouter o Grok) en este orden:
      1) variable de entorno IA_CLAVE
      2) archivo clave.txt al lado de server.py
    Si no hay ninguna, el programa usa el modo de prueba (sin IA).
    """
    clave = (os.environ.get("IA_CLAVE") or os.environ.get("XAI_API_KEY") or "").strip()
    if clave:
        return clave
    ruta = os.path.join(CARPETA, "clave.txt")
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as archivo:
            return archivo.read().strip()
    return ""


CLAVE_API = leer_clave_api()

# Proveedores de IA que funcionan igual (formato "compatible con OpenAI").
# Se elige solo según cómo empieza la clave:
#   gsk_    -> Groq        (GRATIS, sin tarjeta)  https://console.groq.com
#   sk-or-  -> OpenRouter  (tiene modelos gratis) https://openrouter.ai
#   xai-    -> Grok / xAI  (pago)                 https://console.x.ai
PROVEEDORES = {
    "groq": {"nombre": "Groq", "url": "https://api.groq.com/openai/v1",
             "modelo": "llama-3.3-70b-versatile"},
    "openrouter": {"nombre": "OpenRouter", "url": "https://openrouter.ai/api/v1",
                   "modelo": "openrouter/free"},
    "xai": {"nombre": "Grok", "url": "https://api.x.ai/v1", "modelo": "grok-4"},
}


def elegir_proveedor(clave):
    elegido = os.environ.get("IA_PROVEEDOR", "").strip().lower()
    if elegido in PROVEEDORES:
        return elegido
    if clave.startswith("sk-or-"):
        return "openrouter"
    if clave.startswith("xai-"):
        return "xai"
    return "groq"


PROVEEDOR = PROVEEDORES[elegir_proveedor(CLAVE_API)]
URL_BASE_IA = PROVEEDOR["url"]
MODELO_IA = os.environ.get("IA_MODELO") or os.environ.get("XAI_MODEL") or PROVEEDOR["modelo"]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/estado")
def api_estado():
    """Le avisa a la página si la IA está conectada y si el PDF directo está disponible."""
    return jsonify({"ia": bool(CLAVE_API), "proveedor": PROVEEDOR["nombre"], "pdf": HAY_REPORTLAB})


@app.route("/api/generar", methods=["POST"])
def api_generar():
    datos = request.get_json() or {}

    # Horas por día: entre 1 y 10, se aceptan medias horas (ej: 2.5)
    try:
        horas_por_dia = float(datos.get("horas_por_dia", 3))
    except (TypeError, ValueError):
        horas_por_dia = 3
    horas_por_dia = min(max(horas_por_dia, 1), 10)

    examenes = []
    for examen_json in datos.get("examenes", []):
        materia = (examen_json.get("materia") or "").strip()
        try:
            fecha_examen = datetime.strptime(examen_json["fecha"], "%Y-%m-%d").date()
        except (ValueError, KeyError, TypeError):
            return jsonify({"error": f"La fecha de '{materia or '?'}' no es válida."}), 400

        temas = [
            Tema(tema["nombre"], tema.get("dificultad", "media"))
            for tema in examen_json.get("temas", [])
            if (tema.get("nombre") or "").strip()
        ]
        if not temas:
            return jsonify({"error": f"El examen de '{materia or '?'}' no tiene temas."}), 400

        examenes.append(Examen(materia, fecha_examen, temas))

    if not examenes:
        return jsonify({"error": "Cargá al menos un examen."}), 400

    plan = generar_plan(examenes, fecha_de_hoy(datos.get("hoy")), horas_por_dia)

    return jsonify({"plan": [
        {
            "fecha": fila["dia"].isoformat(),          # para agrupar en la página
            "dia": fila["dia"].strftime("%d/%m/%Y"),   # para el PDF
            "materia": fila["materia"],
            "tema": fila["tema"],
            "minutos": fila["minutos"],
            "duracion": fila["duracion"],
        }
        for fila in plan
    ]})


def fecha_de_hoy(hoy_texto):
    """
    Usa la fecha de la compu del usuario (la manda la página), porque el
    servidor en internet puede estar en otra zona horaria. Si no llega o es
    rara (más de un día de diferencia), usa la del servidor.
    """
    servidor = date.today()
    try:
        hoy = datetime.strptime(hoy_texto, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return servidor
    return hoy if abs(hoy - servidor) <= timedelta(days=1) else servidor


@app.route("/api/pdf", methods=["POST"])
def api_pdf():
    datos = request.get_json() or {}
    plan = datos.get("plan", [])

    if not plan:
        return jsonify({"error": "No hay plan para exportar."}), 400

    if not HAY_REPORTLAB:
        # El navegador se encarga: abre "Imprimir" y se guarda como PDF desde ahí
        return jsonify({"error": "ReportLab no está instalado", "usar_imprimir": True}), 501

    buffer = io.BytesIO()
    exportar_plan_a_pdf(plan, buffer)
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name="plan_de_estudio.pdf",
                     mimetype="application/pdf")


# ---------------------------------------------------------------
# Ejercicios: con IA si hay clave, o en modo de prueba si no
# ---------------------------------------------------------------

def generar_ejercicios_locales(materia, tema, dificultad):
    """Modo de prueba SIN IA: ejercicios generales armados con plantillas."""
    plantillas = {
        "baja": [
            'Explicá con tus propias palabras qué es "{tema}" en {materia}.',
            'Escribí la definición de "{tema}" y dos ejemplos simples.',
            'Armá una lista con los 3 conceptos básicos que tenés que recordar sobre "{tema}".',
        ],
        "media": [
            'Resolvé un ejercicio típico de parcial sobre "{tema}" y explicá cada paso.',
            'Compará "{tema}" con otro tema de {materia} que ya hayas visto: ¿en qué se parecen y en qué se diferencian?',
            'Inventá un problema sobre "{tema}", resolvelo y revisá si el resultado tiene sentido.',
        ],
        "alta": [
            'Planteá un problema que combine "{tema}" con al menos otro tema de {materia} y resolvelo completo.',
            'Buscá un error común al aplicar "{tema}", explicá por qué ocurre y cómo evitarlo.',
            'Armá un ejercicio de nivel examen sobre "{tema}" sin mirar tus apuntes, y después corregilo con ellos.',
        ],
    }
    lista = plantillas.get(dificultad, plantillas["media"])
    lineas = [
        f"{n}. " + p.format(tema=tema, materia=materia)
        + "\nRespuesta: en modo prueba no hay respuesta automática. Corregilo con tus apuntes."
        for n, p in enumerate(lista, start=1)
    ]
    return "\n\n".join(lineas)


def _pedido_ia(ruta, cuerpo=None):
    """Hace un pedido a la API de IA usando solo urllib (viene con Python)."""
    pedido = urllib.request.Request(
        URL_BASE_IA + ruta,
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        method="POST" if cuerpo is not None else "GET",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CLAVE_API}",
            "User-Agent": "planificador-estudio/1.0",
        },
    )
    with urllib.request.urlopen(pedido, timeout=90) as respuesta:
        return json.loads(respuesta.read().decode("utf-8"))


def buscar_modelo_disponible():
    """
    Le pregunta al proveedor qué modelos tiene tu cuenta y elige uno de texto.
    Se usa solo si el modelo configurado no existe.
    """
    datos = _pedido_ia("/models")
    ids = [m.get("id", "") for m in datos.get("data", [])]
    descartar = ("image", "vision", "imagine", "video", "whisper", "tts", "guard", "embed", "audio")
    de_texto = [i for i in ids if not any(palabra in i.lower() for palabra in descartar)]
    preferidos = [i for i in de_texto if any(p in i for p in ("llama-3.3-70b", "grok", ":free"))]
    de_texto = preferidos or de_texto
    return de_texto[0] if de_texto else None


def pedir_ejercicios_a_la_ia(prompt):
    """Devuelve el texto que responde la IA. Si el modelo no existe, busca otro solo."""
    global MODELO_IA
    mensajes = [{"role": "user", "content": prompt}]
    try:
        datos = _pedido_ia("/chat/completions", {"model": MODELO_IA, "messages": mensajes})
    except urllib.error.HTTPError as error:
        if error.code not in (400, 404):
            raise
        otro = buscar_modelo_disponible()
        if not otro or otro == MODELO_IA:
            raise
        print(f"[IA] El modelo '{MODELO_IA}' no está disponible, uso '{otro}'.")
        MODELO_IA = otro
        datos = _pedido_ia("/chat/completions", {"model": MODELO_IA, "messages": mensajes})
    return datos["choices"][0]["message"]["content"].strip()


@app.route("/api/ejercicios", methods=["POST"])
def api_ejercicios():
    datos = request.get_json() or {}
    materia = (datos.get("materia") or "").strip()
    tema = (datos.get("tema") or "").strip()
    dificultad = datos.get("dificultad", "media")

    if not materia or not tema:
        return jsonify({"error": "Falta la materia o el tema."}), 400

    if not CLAVE_API:
        return jsonify({"ejercicios": generar_ejercicios_locales(materia, tema, dificultad), "modo": "prueba"})

    nivel = {
        "baja": "ejercicios introductorios, para practicar lo más básico del tema",
        "media": "ejercicios de nivel intermedio, típicos de un parcial normal",
        "alta": "ejercicios más exigentes, que requieran combinar varios conceptos del tema",
    }.get(dificultad, "ejercicios de nivel intermedio")

    prompt = f"""Sos un profesor de {materia} armando ejercicios de práctica para un estudiante.

Generá 3 ejercicios sobre el tema "{tema}": {nivel}.

Para cada ejercicio: empezá la línea con el número y un punto (1., 2., 3.), planteá el enunciado claro y al final agregá la respuesta o el resultado esperado en una línea que empiece con "Respuesta:".

Escribí en español rioplatense, en texto plano (sin asteriscos, sin # ni otros símbolos de formato) y andá directo a los ejercicios, sin introducción."""

    try:
        texto = pedir_ejercicios_a_la_ia(prompt)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            mensaje = "La clave de API no es válida o no tiene permisos. Revisá que esté bien copiada."
        elif error.code in (400, 404):
            mensaje = "El modelo de IA no está disponible en tu cuenta. Configurá otro en IA_MODELO."
        elif error.code == 429:
            mensaje = "Llegaste al límite de pedidos gratis. Esperá un minuto y probá de nuevo."
        else:
            mensaje = f"La IA devolvió un error ({error.code})."
        return jsonify({"error": mensaje}), 502
    except (urllib.error.URLError, TimeoutError):
        return jsonify({"error": "No se pudo conectar con la IA. Revisá tu conexión a internet."}), 502
    except (KeyError, IndexError, ValueError):
        return jsonify({"error": "La IA respondió algo inesperado. Probá de nuevo."}), 502

    return jsonify({"ejercicios": texto, "modo": "ia"})


if __name__ == "__main__":
    if CLAVE_API:
        print(f"[IA] Usando {PROVEEDOR['nombre']} con el modelo {MODELO_IA}")
    else:
        print("[IA] Sin clave: los ejercicios funcionan en modo prueba")
    app.run(debug=True)
