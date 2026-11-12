// =============================================================
// Planificador de estudio - lo que hace la página
// =============================================================

const COLORES = ["--r-amarillo", "--r-verde", "--r-rosa", "--r-celeste", "--r-naranja", "--r-violeta"];
const NOMBRE_DIFICULTAD = { baja: "Fácil", media: "Normal", alta: "Difícil" };
const SIGUIENTE_DIFICULTAD = { baja: "media", media: "alta", alta: "baja" };
const CLAVE_GUARDADO = "planificador-estudio-v2";

// ---------- Estado ----------

let estado = {
  examenes: [],   // { id, materia, fecha, color, temas: [{ nombre, dificultad }] }
  horas: 3,
};
let plan = null;            // última respuesta del servidor
let planArmado = false;     // si ya se armó una vez, se actualiza solo
let editandoId = null;      // id del examen que se está editando
let borrador = { temas: [], dificultad: "media" };

// ---------- Elementos ----------

const $ = (id) => document.getElementById(id);

const compositor = $("compositor");
const tituloCompositor = $("titulo-compositor");
const campoMateria = $("campo-materia");
const campoFecha = $("campo-fecha");
const cuentaRegresiva = $("cuenta-regresiva");
const cajaTemas = $("caja-temas");
const campoTema = $("campo-tema");
const selectorDificultad = $("selector-dificultad");
const botonGuardarExamen = $("boton-guardar-examen");
const botonCancelar = $("boton-cancelar-edicion");
const campoHoras = $("campo-horas");
const salidaHoras = $("salida-horas");
const detalleHoras = $("detalle-horas");
const listaExamenes = $("lista-examenes");
const contenedorPlan = $("plan");
const botonGenerar = $("boton-generar");
const botonPdf = $("boton-pdf");
const temasPractica = $("temas-practica");
const resultadoEjercicios = $("resultado-ejercicios");
const aviso = $("aviso");

// ---------- Ayudas ----------

// Crea un elemento HTML de forma segura (el texto nunca se interpreta como HTML)
function el(etiqueta, atributos = {}, hijos = []) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (clave === "texto") nodo.textContent = valor;
    else if (clave === "clase") nodo.className = valor;
    else if (clave === "estilo") Object.assign(nodo.style, valor);
    else if (clave.startsWith("al")) nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    else nodo.setAttribute(clave, valor);
  }
  for (const hijo of [].concat(hijos)) {
    if (hijo == null) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(hijo));
  }
  return nodo;
}

let temporizadorAviso;
function mostrarAviso(texto, esError = false) {
  aviso.textContent = texto;
  aviso.classList.toggle("error", esError);
  aviso.classList.add("visible");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove("visible"), 3200);
}

function puntos(dificultad) {
  return el("span", { clase: "puntos", "data-nivel": dificultad, "aria-hidden": "true" },
    [el("i"), el("i"), el("i")]);
}

function hoyISO() {
  const d = new Date();
  return aISO(d);
}

function aISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function desdeISO(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function diasHasta(iso) {
  const hoy = desdeISO(hoyISO());
  return Math.round((desdeISO(iso) - hoy) / 86400000);
}

function textoFaltan(dias) {
  if (dias < 0) return "Ya pasó";
  if (dias === 0) return "Es hoy";
  if (dias === 1) return "Mañana";
  return `Faltan ${dias} días`;
}

function fechaLarga(iso) {
  return desdeISO(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

function colorDeMateria(materia) {
  const examen = estado.examenes.find((e) => e.materia.toLowerCase() === materia.toLowerCase());
  return `var(${examen ? examen.color : COLORES[0]})`;
}

function siguienteColor() {
  const usados = estado.examenes.map((e) => e.color);
  return COLORES.find((c) => !usados.includes(c)) || COLORES[estado.examenes.length % COLORES.length];
}

function formatearHoras(horas) {
  const h = Math.floor(horas);
  return horas % 1 ? (h ? `${h} h 30 min` : "30 min") : `${h} h`;
}

// ---------- Guardar en el navegador (para no perder todo al recargar) ----------

function guardarEstado() {
  try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(estado)); } catch (e) { /* sin almacenamiento */ }
}

function cargarEstado() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_GUARDADO));
    if (guardado && Array.isArray(guardado.examenes)) estado = { horas: 3, ...guardado };
  } catch (e) { /* nada guardado */ }
}

// =============================================================
// Compositor: cargar un examen
// =============================================================

campoFecha.min = hoyISO();

function actualizarCuentaRegresiva() {
  if (!campoFecha.value) {
    cuentaRegresiva.textContent = "";
    return;
  }
  const dias = diasHasta(campoFecha.value);
  cuentaRegresiva.classList.toggle("mal", dias <= 0);
  cuentaRegresiva.textContent = dias <= 0
    ? "Elegí una fecha futura para que haya días de estudio."
    : `${textoFaltan(dias)}: ${fechaLarga(campoFecha.value)}`;
}

campoFecha.addEventListener("input", actualizarCuentaRegresiva);

document.querySelectorAll(".atajo").forEach((boton) => {
  boton.addEventListener("click", () => {
    const d = new Date();
    d.setDate(d.getDate() + Number(boton.dataset.dias));
    campoFecha.value = aISO(d);
    actualizarCuentaRegresiva();
  });
});

// Selector de dificultad (Fácil / Normal / Difícil)
function elegirDificultad(dificultad) {
  borrador.dificultad = dificultad;
  selectorDificultad.querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.dificultad === dificultad));
  });
}

selectorDificultad.addEventListener("click", (e) => {
  const boton = e.target.closest("button");
  if (boton) elegirDificultad(boton.dataset.dificultad);
});

// Atajos de teclado en el selector: flechas para moverse
selectorDificultad.addEventListener("keydown", (e) => {
  const orden = ["baja", "media", "alta"];
  const i = orden.indexOf(borrador.dificultad);
  if (e.key === "ArrowRight") elegirDificultad(orden[Math.min(i + 1, 2)]);
  if (e.key === "ArrowLeft") elegirDificultad(orden[Math.max(i - 1, 0)]);
});

// Temas como chips: Enter (o coma) agrega, Backspace en vacío borra el último
cajaTemas.addEventListener("click", (e) => {
  if (e.target === cajaTemas) campoTema.focus();
});

campoTema.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    agregarTemaDelCampo();
  } else if (e.key === "Backspace" && !campoTema.value && borrador.temas.length) {
    borrador.temas.pop();
    dibujarChips();
  }
});

// Si pegan "tema 1, tema 2, tema 3" se agregan todos
campoTema.addEventListener("paste", (e) => {
  const texto = (e.clipboardData || window.clipboardData).getData("text");
  if (texto.includes(",") || texto.includes("\n")) {
    e.preventDefault();
    texto.split(/[,\n]/).forEach((parte) => agregarTema(parte));
    dibujarChips();
  }
});

function agregarTema(nombre) {
  nombre = nombre.trim();
  if (!nombre) return false;
  if (borrador.temas.some((t) => t.nombre.toLowerCase() === nombre.toLowerCase())) {
    mostrarAviso(`"${nombre}" ya está en la lista.`, true);
    return false;
  }
  borrador.temas.push({ nombre, dificultad: borrador.dificultad });
  return true;
}

function agregarTemaDelCampo() {
  if (agregarTema(campoTema.value)) {
    campoTema.value = "";
    dibujarChips();
  }
}

function dibujarChips() {
  cajaTemas.querySelectorAll(".chip-tema").forEach((c) => c.remove());
  borrador.temas.forEach((tema, i) => {
    const chip = el("span", { clase: "chip-tema" }, [
      el("button", {
        type: "button",
        clase: "chip-cuerpo",
        title: "Cambiar dificultad",
        "aria-label": `${tema.nombre}, dificultad ${NOMBRE_DIFICULTAD[tema.dificultad]}. Tocá para cambiarla.`,
        alClick: () => {
          tema.dificultad = SIGUIENTE_DIFICULTAD[tema.dificultad];
          dibujarChips();
          cajaTemas.querySelectorAll(".chip-cuerpo")[i].focus();
        },
      }, [tema.nombre, puntos(tema.dificultad)]),
      el("button", {
        type: "button",
        clase: "chip-quitar",
        "aria-label": `Quitar ${tema.nombre}`,
        texto: "×",
        alClick: () => {
          borrador.temas.splice(i, 1);
          dibujarChips();
          campoTema.focus();
        },
      }),
    ]);
    cajaTemas.insertBefore(chip, campoTema);
  });
}

function limpiarCompositor() {
  editandoId = null;
  borrador = { temas: [], dificultad: borrador.dificultad };
  campoMateria.value = "";
  campoFecha.value = "";
  campoTema.value = "";
  actualizarCuentaRegresiva();
  dibujarChips();
  compositor.classList.remove("editando");
  tituloCompositor.textContent = "Nuevo examen";
  botonGuardarExamen.textContent = "Guardar examen";
  botonCancelar.hidden = true;
}

botonGuardarExamen.addEventListener("click", () => {
  // Si quedó algo escrito en el campo de tema, lo sumamos
  if (campoTema.value.trim()) agregarTemaDelCampo();

  const materia = campoMateria.value.trim();
  const fecha = campoFecha.value;

  if (!materia) { mostrarAviso("Escribí la materia.", true); campoMateria.focus(); return; }
  if (!fecha) { mostrarAviso("Elegí la fecha del examen.", true); campoFecha.focus(); return; }
  if (diasHasta(fecha) <= 0) { mostrarAviso("La fecha tiene que ser posterior a hoy.", true); return; }
  if (!borrador.temas.length) { mostrarAviso("Agregá al menos un tema.", true); campoTema.focus(); return; }

  if (editandoId) {
    const examen = estado.examenes.find((e) => e.id === editandoId);
    Object.assign(examen, { materia, fecha, temas: borrador.temas });
    mostrarAviso(`Examen de ${materia} actualizado.`);
  } else {
    estado.examenes.push({
      id: Date.now().toString(36),
      materia,
      fecha,
      color: siguienteColor(),
      temas: borrador.temas,
    });
    mostrarAviso(`Examen de ${materia} guardado.`);
  }

  estado.examenes.sort((a, b) => a.fecha.localeCompare(b.fecha));
  limpiarCompositor();
  huboCambios();
  campoMateria.focus();
});

botonCancelar.addEventListener("click", () => {
  limpiarCompositor();
  dibujarExamenes();
});

function editarExamen(examen) {
  editandoId = examen.id;
  campoMateria.value = examen.materia;
  campoFecha.value = examen.fecha;
  borrador.temas = examen.temas.map((t) => ({ ...t }));
  actualizarCuentaRegresiva();
  dibujarChips();
  compositor.classList.add("editando");
  tituloCompositor.textContent = `Editando ${examen.materia}`;
  botonGuardarExamen.textContent = "Guardar cambios";
  botonCancelar.hidden = false;
  dibujarExamenes();
  compositor.scrollIntoView({ behavior: "smooth", block: "start" });
  campoMateria.focus({ preventScroll: true });
}

function borrarExamen(examen) {
  estado.examenes = estado.examenes.filter((e) => e.id !== examen.id);
  if (editandoId === examen.id) limpiarCompositor();
  mostrarAviso(`Examen de ${examen.materia} borrado.`);
  huboCambios();
}

// ---------- Horas por día ----------

function dibujarHoras() {
  campoHoras.value = estado.horas;
  salidaHoras.textContent = formatearHoras(estado.horas);
  const bloques = Math.round(estado.horas * 2);
  detalleHoras.textContent = `${bloques} bloques de 30 minutos`;
}

campoHoras.addEventListener("input", () => {
  estado.horas = Number(campoHoras.value);
  dibujarHoras();
});
campoHoras.addEventListener("change", huboCambios);

// =============================================================
// Lista de exámenes
// =============================================================

function dibujarExamenes() {
  listaExamenes.replaceChildren();

  if (!estado.examenes.length) {
    listaExamenes.append(el("li", { clase: "vacio", texto: "Todavía no cargaste ningún examen. Empezá por la izquierda." }));
    return;
  }

  estado.examenes.forEach((examen) => {
    const dias = diasHasta(examen.fecha);
    listaExamenes.append(
      el("li", {
        clase: "ficha" + (editandoId === examen.id ? " editando" : ""),
      }, [
        el("div", { clase: "ficha-cabecera" }, [
          el("h3", { texto: examen.materia }),
          el("span", { clase: "faltan" + (dias < 0 ? " paso" : ""), texto: textoFaltan(dias) }),
        ]),
        el("p", { clase: "ficha-fecha", texto: fechaLarga(examen.fecha) }),
        el("div", { clase: "ficha-temas" },
          examen.temas.map((t) => el("span", { title: NOMBRE_DIFICULTAD[t.dificultad] }, [t.nombre, puntos(t.dificultad)]))),
        el("div", { clase: "ficha-acciones" }, [
          el("button", { type: "button", clase: "enlace", texto: "Editar", alClick: () => editarExamen(examen) }),
          el("button", { type: "button", clase: "enlace peligro", texto: "Borrar", alClick: () => borrarExamen(examen) }),
        ]),
      ]),
    );
  });

  // Cada ficha toma el color de resaltador de su materia
  listaExamenes.querySelectorAll(".ficha").forEach((li, i) => {
    li.style.setProperty("--color-materia", `var(${estado.examenes[i].color})`);
  });
}

// =============================================================
// Plan de estudio
// =============================================================

function examenesVigentes() {
  return estado.examenes.filter((e) => diasHasta(e.fecha) > 0);
}

async function armarPlan({ silencioso = false } = {}) {
  const vigentes = examenesVigentes();
  if (!vigentes.length) {
    if (!silencioso) mostrarAviso("Cargá al menos un examen con fecha futura.", true);
    plan = null;
    dibujarPlan();
    return;
  }

  botonGenerar.disabled = true;
  botonGenerar.textContent = "Armando...";

  try {
    const respuesta = await fetch("/api/generar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examenes: vigentes, horas_por_dia: estado.horas, hoy: hoyISO() }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      mostrarAviso(datos.error || "No se pudo armar el plan.", true);
      return;
    }

    plan = datos.plan;
    planArmado = true;
    dibujarPlan();
    if (!silencioso) {
      $("seccion-plan").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    mostrarAviso("No se pudo conectar con el servidor. ¿Está prendido server.py?", true);
  } finally {
    botonGenerar.disabled = false;
    botonGenerar.textContent = planArmado ? "Volver a armar" : "Armar plan";
  }
}

botonGenerar.addEventListener("click", () => armarPlan());

function dibujarPlan() {
  contenedorPlan.replaceChildren();
  botonPdf.disabled = !plan || !plan.length;

  if (!plan) {
    contenedorPlan.append(el("p", { clase: "vacio", texto: "Cuando tengas al menos un examen cargado, apretá “Armar plan”." }));
    return;
  }
  if (!plan.length) {
    contenedorPlan.append(el("p", { clase: "vacio", texto: "No quedan días para estudiar antes de los exámenes cargados." }));
    return;
  }

  // Agrupamos por día y marcamos los días de examen
  const dias = new Map();
  plan.forEach((fila) => {
    if (!dias.has(fila.fecha)) dias.set(fila.fecha, { filas: [], examenes: [] });
    dias.get(fila.fecha).filas.push(fila);
  });
  examenesVigentes().forEach((examen) => {
    if (!dias.has(examen.fecha)) dias.set(examen.fecha, { filas: [], examenes: [] });
    dias.get(examen.fecha).examenes.push(examen);
  });

  const totalMin = plan.reduce((s, f) => s + f.minutos, 0);
  const cantidadDias = new Set(plan.map((f) => f.fecha)).size;
  contenedorPlan.append(el("p", {
    clase: "resumen-plan",
    texto: `${cantidadDias} días de estudio, ${formatearHoras(Math.round(totalMin / 30) / 2)} en total.`,
  }));

  const hoy = hoyISO();
  [...dias.keys()].sort().forEach((fecha) => {
    const { filas, examenes } = dias.get(fecha);
    const d = desdeISO(fecha);
    const diff = diasHasta(fecha);
    const nombre = fecha === hoy ? "Hoy" : diff === 1 ? "Mañana"
      : d.toLocaleDateString("es-AR", { weekday: "long" });

    const barra = el("div", { clase: "barra-dia", "aria-hidden": "true" });
    filas.forEach((f) => {
      const tramo = el("span", { title: `${f.tema}: ${f.duracion}` });
      tramo.style.flexGrow = f.minutos;
      tramo.style.setProperty("--color-materia", colorDeMateria(f.materia));
      barra.append(tramo);
    });

    const lista = el("ul", { clase: "bloques" });
    filas.forEach((f) => {
      const item = el("li", { clase: "bloque" }, [
        el("span", {}, [
          el("span", { clase: "bloque-tema", texto: f.tema }),
          el("span", { clase: "bloque-materia", texto: f.materia }),
        ]),
        el("span", { clase: "bloque-duracion", texto: f.duracion }),
      ]);
      item.style.setProperty("--color-materia", colorDeMateria(f.materia));
      lista.append(item);
    });

    contenedorPlan.append(
      el("article", { clase: "dia" + (fecha === hoy ? " hoy" : "") }, [
        el("div", { clase: "dia-fecha" }, [
          el("span", { clase: "dia-nombre", texto: nombre }),
          el("span", { clase: "dia-numero", texto: d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }) }),
        ]),
        el("div", {}, [
          ...examenes.map((e) => el("div", { clase: "marca-examen", texto: `Examen de ${e.materia}` })),
          filas.length ? barra : null,
          filas.length ? lista : null,
        ]),
      ]),
    );
  });
}

// ---------- Guardar como PDF ----------

botonPdf.addEventListener("click", async () => {
  if (!plan || !plan.length) return;

  botonPdf.disabled = true;
  botonPdf.textContent = "Generando...";

  try {
    const respuesta = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });

    if (!respuesta.ok) {
      const info = await respuesta.json().catch(() => ({}));
      if (info.usar_imprimir) {
        mostrarAviso("Elegí “Guardar como PDF” en la ventana de imprimir.");
        setTimeout(() => window.print(), 600);
        return;
      }
      mostrarAviso("No se pudo generar el PDF.", true);
      return;
    }

    const blob = await respuesta.blob();
    const url = URL.createObjectURL(blob);
    const enlace = el("a", { href: url, download: "plan_de_estudio.pdf" });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    mostrarAviso("PDF descargado.");
  } catch (error) {
    mostrarAviso("No se pudo conectar con el servidor.", true);
  } finally {
    botonPdf.disabled = false;
    botonPdf.textContent = "Guardar PDF";
  }
});

// =============================================================
// Práctica con IA
// =============================================================

function dibujarTemasPractica() {
  temasPractica.replaceChildren();
  const items = [];
  examenesVigentes().forEach((examen) => {
    examen.temas.forEach((t) => items.push({ materia: examen.materia, tema: t.nombre, dificultad: t.dificultad, color: examen.color }));
  });

  if (!items.length) {
    temasPractica.append(el("p", { clase: "ayuda", texto: "Acá van a aparecer los temas de tus exámenes." }));
    return;
  }

  items.forEach((item) => {
    const boton = el("button", {
      type: "button",
      clase: "boton-practica",
      title: `${item.materia}, ${NOMBRE_DIFICULTAD[item.dificultad]}`,
      alClick: () => pedirEjercicios(item, boton),
    }, [el("span", { clase: "punto-color", "aria-hidden": "true" }), item.tema, puntos(item.dificultad)]);
    boton.style.setProperty("--color-materia", `var(${item.color})`);
    temasPractica.append(boton);
  });
}

async function pedirEjercicios(item, boton) {
  if (boton.getAttribute("aria-busy") === "true") return;
  boton.setAttribute("aria-busy", "true");

  // Panel con "esqueleto" mientras responde la IA
  const panel = el("div", { clase: "panel-ejercicios" }, [
    el("h3", { texto: item.tema }),
    el("p", { clase: "panel-materia", texto: `${item.materia}, nivel ${NOMBRE_DIFICULTAD[item.dificultad].toLowerCase()}` }),
    el("div", { clase: "cargando" }), el("div", { clase: "cargando", estilo: { width: "80%" } }),
    el("div", { clase: "cargando", estilo: { width: "60%" } }),
  ]);
  panel.style.setProperty("--color-materia", `var(${item.color})`);
  resultadoEjercicios.prepend(panel);

  try {
    const respuesta = await fetch("/api/ejercicios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materia: item.materia, tema: item.tema, dificultad: item.dificultad }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      panel.remove();
      mostrarAviso(datos.error || "No se pudieron generar los ejercicios.", true);
      return;
    }

    panel.querySelectorAll(".cargando").forEach((c) => c.remove());
    panel.append(armarEjercicios(datos.ejercicios));
    if (datos.modo === "prueba") {
      panel.append(el("p", { clase: "ayuda", texto: "Modo prueba: configurá la clave de la IA para ejercicios reales." }));
    }
  } catch (error) {
    panel.remove();
    mostrarAviso("No se pudo conectar con el servidor.", true);
  } finally {
    boton.removeAttribute("aria-busy");
  }
}

// Separa el texto en ejercicios y esconde cada respuesta en un desplegable
function armarEjercicios(texto) {
  const partes = texto.split(/\n(?=\s*\d+[.)]\s)/).map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return el("pre", { clase: "texto-plano", texto });

  const lista = el("ol", { clase: "ejercicios" });
  partes.forEach((parte) => {
    const sinNumero = parte.replace(/^\d+[.)]\s*/, "");
    const [enunciado, ...resto] = sinNumero.split(/\n?\s*Respuesta:\s*/i);
    const respuestaTexto = resto.join(" ").trim();
    lista.append(el("li", {}, [
      enunciado.trim(),
      respuestaTexto
        ? el("details", {}, [el("summary", { texto: "Ver respuesta" }), el("p", { texto: respuestaTexto })])
        : null,
    ]));
  });
  return lista;
}

// =============================================================
// Inicio
// =============================================================

let temporizadorPlan;
function huboCambios() {
  guardarEstado();
  dibujarExamenes();
  dibujarTemasPractica();
  // Si el plan ya estaba armado, se actualiza solo
  if (planArmado) {
    clearTimeout(temporizadorPlan);
    temporizadorPlan = setTimeout(() => armarPlan({ silencioso: true }), 250);
  }
}

async function mostrarEstadoIA() {
  try {
    const datos = await (await fetch("/api/estado")).json();
    const pastilla = $("estado-ia");
    pastilla.textContent = datos.ia ? `IA conectada (${datos.proveedor})` : "Ejercicios en modo prueba";
    pastilla.classList.toggle("conectada", datos.ia);
    pastilla.hidden = false;
  } catch (e) { /* servidor apagado: no mostramos nada */ }
}

cargarEstado();
dibujarHoras();
dibujarExamenes();
dibujarTemasPractica();
dibujarPlan();
mostrarEstadoIA();
if (examenesVigentes().length) armarPlan({ silencioso: true });
