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
  "Sincronizar ahora": "Sync now",
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
  "Última sincronización: {time}.": "Last sync: {time}.",
  "{n} sin lectura. Puedes reintentar la consulta o escribirla a mano desde “Mis listas”.":
    "{n} without a reading. You can retry the lookup or type it by hand from “My lists”.",
  "Todos los elementos tienen lectura.": "All items have a reading.",
  "Cuenta y sincronización": "Account and sync",
  "Con una cuenta, tus listas y tu progreso se guardan en la nube y se mantienen al día en todos tus dispositivos. Sin cuenta, todo se queda solo en este navegador.":
    "With an account, your lists and progress are stored in the cloud and kept up to date on all your devices. Without one, everything stays in this browser only.",
  "Iniciar sesión o crear cuenta": "Sign in or create an account",
  "Cerrar sesión": "Sign out",
  "Sesión iniciada como {email}": "Signed in as {email}",
  "Las cuentas no están configuradas en esta instalación (falta rellenar config.js).":
    "Accounts are not configured in this installation (config.js has not been filled in).",
  "No se pudo cargar el servicio de cuentas. Comprueba la conexión y vuelve a abrir la app.":
    "The account service could not be loaded. Check your connection and reopen the app.",
  "Datos guardados en este navegador y en tu cuenta": "Data stored in this browser and in your account",
  "Faltan las tablas en Supabase: ejecuta supabase/schema.sql.":
    "The Supabase tables are missing: run supabase/schema.sql.",
  "No se pudo sincronizar ({error}).": "Could not sync ({error}).",
  "Este dispositivo tiene datos de otra cuenta. Para continuar se quitarán de este dispositivo (lo que no se hubiera sincronizado se perderá). ¿Continuar?":
    "This device holds data from another account. To continue it will be removed from this device (anything not yet synced will be lost). Continue?",
  "No se pudieron sincronizar los últimos cambios. Se quedan en este dispositivo y se subirán cuando vuelvas a iniciar sesión. ¿Cerrar sesión?":
    "The latest changes could not be synced. They stay on this device and will be uploaded when you sign in again. Sign out?",

  /* ---------- app.js: diálogo de cuenta ---------- */
  "Iniciar sesión": "Sign in",
  "Entrar": "Sign in",
  "Crear cuenta": "Create account",
  "Crear una cuenta": "Create an account",
  "Ya tengo cuenta": "I already have an account",
  "¿Olvidaste tu contraseña?": "Forgot your password?",
  "Continuar con Google": "Continue with Google",
  "Correo electrónico": "Email",
  "Contraseña": "Password",
  "Contraseña (mínimo 8 caracteres)": "Password (at least 8 characters)",
  "Recuperar contraseña": "Reset password",
  "Enviar enlace": "Send link",
  "Nueva contraseña": "New password",
  "Guardar contraseña": "Save password",
  "Tu progreso se guarda en tu cuenta y se mantiene al día en todos tus dispositivos.":
    "Your progress is stored in your account and kept up to date on all your devices.",
  "El progreso que ya tienes en este dispositivo se guardará en tu cuenta.":
    "The progress you already have on this device will be saved to your account.",
  "Te enviaremos un enlace para elegir una contraseña nueva.": "We will send you a link to choose a new password.",
  "Escribe la contraseña nueva para tu cuenta.": "Type the new password for your account.",
  "Un momento…": "One moment…",
  "No hay conexión. Inténtalo de nuevo cuando tengas internet.": "No connection. Try again when you are online.",
  "Correo o contraseña incorrectos.": "Wrong email or password.",
  "Confirma tu correo con el enlace que te enviamos antes de entrar.":
    "Confirm your email with the link we sent you before signing in.",
  "Ya existe una cuenta con ese correo. Inicia sesión o recupera la contraseña.":
    "An account with that email already exists. Sign in or reset the password.",
  "La contraseña es demasiado débil. Usa al menos 8 caracteres.": "The password is too weak. Use at least 8 characters.",
  "La contraseña nueva debe ser distinta de la anterior.": "The new password must differ from the old one.",
  "Revisa el correo: no parece válido.": "Check the email address: it does not look valid.",
  "Demasiados intentos. Espera unos minutos y vuelve a probar.": "Too many attempts. Wait a few minutes and try again.",
  "El registro de cuentas nuevas está desactivado.": "Sign-up for new accounts is disabled.",
  "No se pudo completar la operación ({error}).": "The operation could not be completed ({error}).",
  "Te enviamos un correo. Abre el enlace para confirmar la cuenta y luego inicia sesión.":
    "We sent you an email. Open the link to confirm the account, then sign in.",
  "Si hay una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.":
    "If there is an account with that email, you will receive a link to change the password.",
  "Contraseña actualizada.": "Password updated.",
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
