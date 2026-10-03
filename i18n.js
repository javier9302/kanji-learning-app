/* =========================================
   KANJI LEARNING APP - i18n.js
   Idiomas de la interfaz: español (el del código) e inglés.
   El texto en español es la clave: t("Sin estudiar") devuelve
   "Not studied" en inglés. Si falta una traducción se queda en español.
   Para traducir un texto nuevo basta con añadirlo a EN.
   ========================================= */

const LANGS = ["es", "en"];

const EN = {
  /* ---------- index.html ---------- */
  "Tu espacio de estudio japonés": "Your Japanese study space",
  "Idioma": "Language",
  "Sincronización": "Sync",
  "Solo en este dispositivo": "This device only",
  "ESTUDIO PERSONAL DE JAPONÉS": "PERSONAL JAPANESE STUDY",
  "Un paso más cerca": "One step closer",
  "de dominar el japonés.": "to mastering Japanese.",
  "Organiza tus kanjis y palabras, estudia a tu ritmo y lleva tu progreso contigo a cualquier dispositivo.":
    "Organize your kanji and words, study at your own pace and take your progress with you to any device.",
  "Secciones": "Sections",
  "Estudiar": "Study",
  "Escribir": "Write",
  "Mis listas": "My lists",
  "Progreso": "Progress",
  "Datos": "Data",

  "SESIÓN DE REPASO": "REVIEW SESSION",
  "¿Qué vamos a estudiar?": "What shall we study?",
  "Contenido": "Content",
  "Kanjis": "Kanji",
  "Palabras": "Words",
  "Mixto": "Mixed",
  "Nivel JLPT": "JLPT level",
  "Todos": "All",
  "Modo": "Mode",
  "Escribir la lectura": "Type the reading",
  "Tarjetas (autoevaluación)": "Flashcards (self-graded)",
  "Preguntas": "Questions",
  "Todas": "All",
  "Iniciar repaso →": "Start review →",
  "Tu próxima sesión empieza aquí": "Your next session starts here",
  "Agrega una lista base JLPT o tu propia lista en “Mis listas” y luego inicia un repaso.":
    "Add a JLPT base list or your own list in “My lists”, then start a review.",
  "Agregar contenido": "Add content",

  "ESCRITURA": "WRITING",
  "Dibuja el kanji": "Draw the kanji",
  "Aparecen los kanjis que ya has acertado al menos una vez. Dibuja cada trazo en su orden y dirección.":
    "Kanji you have answered correctly at least once appear here. Draw each stroke in its order and direction.",

  "TU CONTENIDO": "YOUR CONTENT",
  "Listas base JLPT": "JLPT base lists",
  "Kanjis y palabras de cada nivel, listos para agregar con un clic. Las lecturas y los significados se buscan automáticamente.":
    "Kanji and words for each level, ready to add with one click. Readings and meanings are looked up automatically.",
  "Tipo de contenido": "Content type",
  "Lista de kanjis": "Kanji list",
  "Lista de palabras": "Word list",
  "Separa los elementos con comas, punto y coma o saltos de línea. Los duplicados se omiten y las lecturas y significados se buscan automáticamente.":
    "Separate items with commas, semicolons or line breaks. Duplicates are skipped, and readings and meanings are looked up automatically.",
  "Agregar a mis listas": "Add to my lists",
  "Elementos guardados": "Saved items",
  "Filtrar por tipo": "Filter by type",
  "Tipo: todos": "Type: all",
  "Filtrar por nivel": "Filter by level",
  "Nivel: todos": "Level: all",
  "Filtrar por estado": "Filter by status",
  "Estado: todos": "Status: all",
  "Para repasar hoy": "Due today",
  "Sin estudiar": "Not studied",
  "Aprendiendo": "Learning",
  "Consolidados": "Mature",
  "Sin lectura": "No reading",
  "Buscar kanji, lectura o significado…": "Search kanji, reading or meaning…",
  "Mostrar más": "Show more",

  "TU CONSTANCIA": "YOUR CONSISTENCY",
  "Total guardado": "Total saved",
  "Estudiados": "Studied",
  "Racha actual": "Current streak",
  "Aciertos (30 días)": "Accuracy (30 days)",
  "Repasos de los próximos 14 días": "Reviews in the next 14 days",
  "Tarjetas ya estudiadas que vencen cada día.": "Already studied cards that fall due each day.",
  "Actividad": "Activity",
  "Respuestas por día en las últimas 16 semanas.": "Answers per day over the last 16 weeks.",
  "Menos": "Less",
  "Más": "More",
  "Avance por nivel": "Progress by level",
  "Los que más se te resisten": "Your hardest items",

  "TUS DATOS": "YOUR DATA",
  "Sincronización y copias": "Sync and backups",
  "Sincronización automática": "Automatic sync",
  "Guarda tus listas y tu progreso en un gist privado de tu cuenta de GitHub y mantenlos al día en todos tus dispositivos, sin exportar ni importar archivos.":
    "Store your lists and progress in a private gist in your GitHub account and keep them up to date on all your devices, without exporting or importing files.",
  "Crea un token de GitHub": "Create a GitHub token",
  "(el único permiso que necesita es": "(the only permission it needs is",
  "Pégalo aquí. Repite este paso en cada dispositivo.": "Paste it here. Repeat this step on each device.",
  "Token de GitHub": "GitHub token",
  "Conectar": "Connect",
  "El token se guarda solo en este navegador y no se incluye en las copias exportadas.":
    "The token is stored only in this browser and is not included in exported backups.",
  "Sincronizar ahora": "Sync now",
  "Ver gist": "View gist",
  "Desconectar": "Disconnect",
  "Copia de seguridad": "Backup",
  "Descarga un archivo JSON con todo, o carga uno exportado previamente: se combina con los datos actuales.":
    "Download a JSON file with everything, or load a previously exported one: it is merged with the current data.",
  "↓ Exportar JSON": "↓ Export JSON",
  "Elegir JSON": "Choose JSON",
  "Importar archivo": "Import file",
  "Meta diaria": "Daily goal",
  "Número de respuestas que quieres hacer cada día.": "Number of answers you want to give each day.",
  "Diccionario": "Dictionary",
  "Volver a consultar": "Look up again",

  "Lecturas aceptadas (separadas por comas)": "Accepted readings (comma-separated)",
  "Significados (separados por comas)": "Meanings (comma-separated)",
  "Reiniciar progreso": "Reset progress",
  "Cancelar": "Cancel",
  "Guardar": "Save",
  "Datos guardados localmente en este navegador": "Data stored locally in this browser",

  /* ---------- app.js: plurales ---------- */
  "elemento": "item",
  "elementos": "items",
  "pendiente": "due",
  "pendientes": "due",
  "día": "day",
  "días": "days",
  "palabra bloqueada": "word locked",
  "palabras bloqueadas": "words locked",
  "repaso pendiente": "review due",
  "repasos pendientes": "reviews due",
  "nuevo": "new",
  "nuevos": "new",
  "repaso": "review",
  "repasos": "reviews",
  "respuesta": "answer",
  "respuestas": "answers",
  "fallo": "mistake",
  "fallos": "mistakes",
  "aprendido": "learned",
  "aprendidos": "learned",
  "trazo": "stroke",
  "trazos": "strokes",
  "kanjis": "kanji",
  "palabras": "words",
  "kanji agregado": "kanji added",
  "kanjis agregados": "kanji added",
  "palabra agregada": "word added",
  "palabras agregadas": "words added",

  /* ---------- app.js: estudio ---------- */
  "Racha: {n}": "Streak: {n}",
  "Hoy: {done} / {goal} repasos": "Today: {done} / {goal} reviews",
  "{n} hasta que aciertes sus kanjis.": "{n} until you answer their kanji correctly.",
  "No hay elementos en esta selección": "No items in this selection",
  "{n} con estos filtros. Pulsa “Iniciar repaso” para empezar.":
    "{n} with these filters. Press “Start review” to begin.",
  "Las palabras se desbloquean cuando aciertas al menos una vez todos sus kanjis.":
    "Words unlock once you have answered all their kanji correctly at least once.",
  "Cambia el contenido o el nivel, o agrega más elementos en “Mis listas”.":
    "Change the content or level, or add more items in “My lists”.",
  "Repaso": "Review",
  "Nuevo": "New",
  "Práctica extra": "Extra practice",
  "Otra vez": "Again",
  "Sesión terminada": "Session finished",
  "Has repasado {n} · {percent} % a la primera.": "You reviewed {n} · {percent}% right first time.",
  "No quedaban tarjetas por repasar.": "There were no cards left to review.",
  "Otra sesión": "Another session",
  "Ver progreso": "View progress",
  "Escuchar": "Listen",
  "Cargando…": "Loading…",
  "No se pudo obtener la lectura ({error}).": "Could not get the reading ({error}).",
  "sin datos": "no data",
  "Reintentar": "Retry",
  "Saltar": "Skip",
  "Escribe una lectura kun (hiragana)": "Type a kun reading (hiragana)",
  "Escribe la lectura (hiragana o katakana)": "Type the reading (hiragana or katakana)",
  "Comprobar": "Check",
  "No lo sé": "I don't know",
  "Mostrar respuesta": "Show answer",
  "hoy": "today",
  "Siguiente": "Next",
  "Difícil": "Hard",
  "Bien": "Good",
  "Fácil": "Easy",
  "Esta es la respuesta:": "This is the answer:",
  "Escribe una lectura primero.": "Type a reading first.",
  "Esa es una lectura on. Escribe una lectura kun.": "That is an on reading. Type a kun reading.",
  "¡Correcto!": "Correct!",
  "No es correcto.": "Not correct.",

  /* ---------- app.js: listas ---------- */
  "Introduce al menos un elemento.": "Enter at least one item.",
  "Agregados: {n}": "Added: {n}",
  " (+{n} kanjis derivados)": " (+{n} derived kanji)",
  ". Ya existentes: {n}.": ". Already present: {n}.",
  " Formato no válido: {n}.": " Invalid format: {n}.",
  "{n} {name} · agregada": "{n} {name} · added",
  "Agregar {n} {name}": "Add {n} {name}",
  "Agregar {n} restantes": "Add {n} remaining",
  "Lista {level}: {n}.": "{level} list: {n}.",
  "Cada palabra aparecerá en los repasos cuando hayas acertado sus kanjis.":
    "Each word will appear in reviews once you have answered its kanji correctly.",
  "Repasar hoy": "Review today",
  "Próximo: {date}": "Next: {date}",
  "Todavía no has agregado kanjis ni palabras.": "You haven't added any kanji or words yet.",
  "No se encontraron elementos.": "No items found.",
  "No se pudo consultar": "Lookup failed",
  "Información pendiente": "Information pending",
  "Palabra": "Word",
  "Editar": "Edit",
  "Eliminar": "Delete",
  "Mostrar más ({n} restantes)": "Show more ({n} remaining)",
  "¿Eliminar {value} y su progreso?": "Delete {value} and its progress?",
  "Aciertos: {correct} · Fallos: {wrong} · {state}": "Correct: {correct} · Wrong: {wrong} · {state}",
  "¿Reiniciar el progreso de {value}?": "Reset the progress of {value}?",
  "La palabra no está en el diccionario": "The word is not in the dictionary",
  "Consultando el diccionario… {done} / {total}": "Looking up the dictionary… {done} / {total}",

  /* ---------- app.js: progreso ---------- */
  "Hoy": "Today",
  "Todavía no hay elementos.": "There are no items yet.",
  "{name}: {count} de {total}": "{name}: {count} of {total}",
  "Aquí aparecerán los elementos que más falles.": "The items you miss most will appear here.",

  /* ---------- app.js: escritura ---------- */
  "No se encontró {file}": "{file} not found",
  "Aún no hay kanjis aprendidos": "No kanji learned yet",
  "Aún no hay kanjis aprendidos en este nivel": "No kanji learned yet at this level",
  "Cuando aciertes un kanji en un repaso podrás practicar aquí su escritura.":
    "Once you answer a kanji correctly in a review you can practise writing it here.",
  "No se pudieron cargar los trazos ({error}).": "Could not load the strokes ({error}).",
  "Otro kanji": "Another kanji",
  "Zona de dibujo": "Drawing area",
  "Pista": "Hint",
  "Mostrar": "Show",
  "Reiniciar": "Restart",
  "Trazo {i} / {n}": "Stroke {i} / {n}",
  "El trazo va en la dirección contraria.": "The stroke goes in the opposite direction.",
  "Ese no es el trazo que toca.": "That is not the next stroke.",
  "Completado con {n}.": "Completed with {n}.",
  "¡Perfecto!": "Perfect!",
  "Así se escribe. Pulsa “Reiniciar” para intentarlo.": "This is how it is written. Press “Restart” to try it.",

  /* ---------- app.js: datos y sincronización ---------- */
  "El archivo no tiene un formato compatible.": "The file is not in a compatible format.",
  "Importación completada. Nuevos: {added}; actualizados: {updated}.":
    "Import complete. New: {added}; updated: {updated}.",
  "No se pudo importar el archivo.": "The file could not be imported.",
  "Archivo seleccionado: {name}": "Selected file: {name}",
  "Sincronizando…": "Syncing…",
  "Sincronizado": "Synced",
  "Sin conexión": "Offline",
  "Error al sincronizar": "Sync error",
  "Datos guardados en este navegador y en tu gist privado": "Data stored in this browser and in your private gist",
  "GitHub rechazó el token. Comprueba que sea válido.": "GitHub rejected the token. Check that it is valid.",
  "El token no tiene el permiso “gist” o se alcanzó el límite de GitHub.":
    "The token lacks the “gist” permission, or GitHub's rate limit was reached.",
  "GitHub respondió {status}.": "GitHub responded {status}.",
  "No se encontró el gist. Vuelve a sincronizar para crearlo de nuevo.":
    "The gist was not found. Sync again to create it anew.",
  "Última sincronización: {time}.": "Last sync: {time}.",
  "Pega primero el token.": "Paste the token first.",
  "¿Dejar de sincronizar en este dispositivo? Los datos locales y el gist se conservan.":
    "Stop syncing on this device? The local data and the gist are kept.",
  "{n} sin lectura. Puedes reintentar la consulta o escribirla a mano desde “Mis listas”.":
    "{n} without a reading. You can retry the lookup or type it by hand from “My lists”.",
  "Todos los elementos tienen lectura.": "All items have a reading.",
  "No se pudo abrir el almacenamiento local": "Local storage could not be opened",
  "Abre la aplicación desde un navegador compatible con IndexedDB.":
    "Open the app in a browser that supports IndexedDB."
};

/* Idioma elegido en este dispositivo; si no hay ninguno, el del navegador */
let lang = (() => {
  try {
    const saved = localStorage.getItem("kanji-lang");
    if (LANGS.includes(saved)) return saved;
  } catch { /* modo privado */ }
  return (navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en";
})();

/* Traduce un texto y sustituye sus {variables} */
function t(text, params) {
  const translated = lang === "en" ? EN[text] ?? text : text;
  return params
    ? translated.replace(/\{(\w+)\}/g, (match, key) => key in params ? params[key] : match)
    : translated;
}

/* Traduce el HTML fijo: cada texto y los atributos visibles */
function translatePage() {
  document.documentElement.lang = lang;
  if (lang === "es") return;

  const translate = (value) => {
    const key = value.trim().replace(/\s+/g, " ");
    return key in EN ? value.replace(value.trim(), EN[key]) : value;
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue.trim()) node.nodeValue = translate(node.nodeValue);
  }
  for (const attribute of ["placeholder", "title", "aria-label"]) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      element.setAttribute(attribute, translate(element.getAttribute(attribute)));
    }
  }
}

translatePage();

/* Al cambiar de idioma se recarga la app para que todo se vuelva a dibujar */
document.getElementById("langSelect").value = lang;
document.getElementById("langSelect").addEventListener("change", (event) => {
  try {
    localStorage.setItem("kanji-lang", event.target.value);
  } catch { /* modo privado: no se puede recordar */ }
  location.reload();
});
