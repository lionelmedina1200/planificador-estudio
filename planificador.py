"""
Lógica del Planificador de Estudio.

Acá está el "motor" del programa: las clases que representan un examen
y un tema, y la función que arma el plan de estudio día por día.

El tiempo se reparte en BLOQUES de 30 minutos, así los resultados son
siempre tiempos razonables (30 min, 1 h, 1 h 30 min, 2 h...) y no cosas
raras como "1.8 horas".
"""

from datetime import date, timedelta

BLOQUE_MINUTOS = 30


class Tema:
    """Un tema dentro de un examen (ej: 'Derivadas' dentro de Matemática)."""

    def __init__(self, nombre, dificultad="media"):
        self.nombre = nombre
        self.dificultad = dificultad  # "baja", "media" o "alta"

    def peso(self):
        """Los temas difíciles 'pesan' más, así les toca más tiempo de estudio."""
        return {"baja": 1, "media": 2, "alta": 3}.get(self.dificultad, 2)


class Examen:
    """Un examen: la materia, la fecha, y la lista de temas a estudiar."""

    def __init__(self, materia, fecha, temas=None):
        self.materia = materia
        self.fecha = fecha
        self.temas = temas or []


def formatear_duracion(minutos):
    """90 -> '1 h 30 min', 60 -> '1 h', 30 -> '30 min'."""
    horas, resto = divmod(minutos, 60)
    if horas and resto:
        return f"{horas} h {resto} min"
    if horas:
        return f"{horas} h"
    return f"{resto} min"


def generar_plan(examenes, hoy, horas_por_dia=3):
    """
    Arma el plan de estudio día por día hasta el último examen.

    Cada día se dispone de 'horas_por_dia' horas, cortadas en bloques de
    30 minutos. Cada bloque se le da al tema que más "lo necesita":
      - los exámenes más cercanos pesan más (urgencia),
      - dentro de un examen, los temas difíciles pesan más.
    Cada tema va acumulando "crédito" de un día para otro, así ningún tema
    queda sin estudiarse y se van rotando solos.

    Devuelve filas con: dia, materia, tema, minutos y duracion (texto).
    """
    if not examenes:
        return []

    bloques_por_dia = max(1, round(horas_por_dia * 60 / BLOQUE_MINUTOS))
    ultima_fecha = max(examen.fecha for examen in examenes)
    creditos = {}  # (examen, tema) -> crédito acumulado
    plan = []

    dia = hoy
    while dia < ultima_fecha:
        activos = [(i, e) for i, e in enumerate(examenes) if e.fecha > dia and e.temas]
        if activos:
            plan.extend(_repartir_dia(dia, activos, bloques_por_dia, creditos))
        dia += timedelta(days=1)

    return plan


def _repartir_dia(dia, activos, bloques_por_dia, creditos):
    """Reparte los bloques de UN día entre todos los temas de los exámenes activos."""
    # Urgencia: cuanto menos falte para el examen, más pesa
    urgencias = {i: 1 / max((e.fecha - dia).days, 1) for i, e in activos}
    total_urgencia = sum(urgencias.values())

    claves = []
    for i, examen in activos:
        peso_examen = urgencias[i] / total_urgencia
        peso_temas = sum(t.peso() for t in examen.temas)
        for j, tema in enumerate(examen.temas):
            parte = peso_examen * tema.peso() / peso_temas
            creditos[(i, j)] = creditos.get((i, j), 0.0) + parte * bloques_por_dia
            claves.append((i, j))

    # Cada bloque se le da al tema con más crédito acumulado
    bloques = {}
    for _ in range(bloques_por_dia):
        elegido = max(claves, key=lambda clave: creditos[clave])
        creditos[elegido] -= 1
        bloques[elegido] = bloques.get(elegido, 0) + 1

    filas = []
    examenes_por_indice = dict(activos)
    for (i, j) in sorted(bloques):
        minutos = bloques[(i, j)] * BLOQUE_MINUTOS
        filas.append({
            "dia": dia,
            "materia": examenes_por_indice[i].materia,
            "tema": examenes_por_indice[i].temas[j].nombre,
            "minutos": minutos,
            "duracion": formatear_duracion(minutos),
        })
    return filas
