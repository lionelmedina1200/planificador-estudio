"""
Exporta el plan de estudio (la lista de filas que genera planificador.py)
a un archivo PDF con formato de tabla.

ReportLab es opcional: si no está instalado, el programa sigue andando y
el PDF se hace desde el botón "Imprimir" del navegador.
"""

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    HAY_REPORTLAB = True
except ImportError:
    HAY_REPORTLAB = False


def exportar_plan_a_pdf(plan, destino):
    """
    Recibe el plan (lista de diccionarios con dia, materia, tema, duracion)
    y genera un PDF prolijo. 'destino' puede ser una ruta o un archivo en memoria.
    """
    if not HAY_REPORTLAB:
        raise RuntimeError("ReportLab no está instalado")

    documento = SimpleDocTemplate(destino, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    estilos = getSampleStyleSheet()
    elementos = [Paragraph("Plan de Estudio", estilos["Title"]), Spacer(1, 0.5 * cm)]

    filas_tabla = [["Día", "Materia", "Tema", "Duración"]]
    for fila in plan:
        dia = fila["dia"]
        dia_texto = dia.strftime("%d/%m/%Y") if hasattr(dia, "strftime") else str(dia)
        filas_tabla.append([dia_texto, fila["materia"], fila["tema"], fila["duracion"]])

    tabla = Table(filas_tabla, colWidths=[3 * cm, 4.5 * cm, 6 * cm, 3 * cm], repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3730A3")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D9DCEB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F5FB")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    elementos.append(tabla)
    documento.build(elementos)
