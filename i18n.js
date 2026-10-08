/* =========================================
   KANJI LEARNING APP - i18n.js
   Idiomas de la interfaz: español (el del código) e inglés.
   El texto en español es la clave: t("Sin estudiar") devuelve
   "Not studied" en inglés. Si falta una traducción se queda en español.
   Para traducir un texto nuevo basta con añadirlo a EN.
   ========================================= */

const LANGS = ["es", "en"];

const EN = {
  /* ---------- Instalar como app ---------- */
  "Instalar la app": "Install the app",
  "Instalar app": "Install app",
  "Ya estás usando la app instalada.": "You are already using the installed app.",
  "Instálala para abrirla desde tu pantalla de inicio o escritorio, a pantalla completa y también sin conexión.": "Install it to open it from your home screen or desktop, full screen and also offline.",
  "En iPhone o iPad: abre esta página en Safari, pulsa Compartir y elige “Añadir a pantalla de inicio”.": "On iPhone or iPad: open this page in Safari, tap Share and choose “Add to Home Screen”.",
  "En Safari para Mac: menú Archivo → “Añadir al Dock”.": "In Safari for Mac: File menu → “Add to Dock”.",
  "Abre el menú del navegador y elige “Instalar app” o “Añadir a pantalla de inicio”. Si no aparece, usa Chrome o Edge.": "Open the browser menu and choose “Install app” or “Add to Home screen”. If it is not there, use Chrome or Edge.",
  /* ---------- Fase 2: repaso con FSRS y agregar palabra ---------- */
  "Agregar palabra": "Add a word",
  "TU VOCABULARIO": "YOUR VOCABULARY",
  "Escritura": "Writing",
  "Lectura (hiragana)": "Reading (hiragana)",
  "Significado (opcional)": "Meaning (optional)",
  "Si la palabra está en nuestro banco, la lectura y el significado se rellenan solos.": "If the word is in our bank, the reading and the meaning are filled in for you.",
  "Quiero aprenderla": "I want to learn it",
  "Ya la domino": "I already know it",
  "«Quiero aprenderla»: será la primera palabra nueva de tu próximo repaso. «Ya la domino»: no se presenta como nueva, vuelve a repasarse dentro de mucho y sus kanjis cuentan como conocidos.": "“I want to learn it”: it will be the first new word in your next review. “I already know it”: it is not introduced as new, it comes back for review after a long time and its kanji count as known.",
  "Palabras que agregaste": "Words you added",
  "Palabras nuevas como máximo en cada sesión. Los repasos pendientes salen siempre antes y no cuentan.": "Maximum number of new words per session. Due reviews always come first and do not count.",
  "Palabras nuevas por sesión": "New words per session",
  "Mostrar por qué sale cada palabra nueva": "Show why each new word is chosen",
  "El repaso espaciado usa": "Spaced repetition uses",
  "Otra vez: no la sabías, vuelve a salir en esta sesión. Difícil: te costó. Bien: la recordaste. Fácil: la sabías al instante. Debajo de cada botón ves cuándo volverá a salir.": "Again: you did not know it, it comes back in this session. Hard: it took effort. Good: you remembered it. Easy: you knew it instantly. Under each button you can see when it will come back.",
  "Difícil: te costó. Bien: la recordaste. Fácil: la sabías al instante. Debajo de cada botón ves cuándo volverá a salir.": "Hard: it took effort. Good: you remembered it. Easy: you knew it instantly. Under each button you can see when it will come back.",
  "mes": "month",
  "meses": "months",
  "año": "year",
  "años": "years",
  "elemento nuevo": "new item",
  "elementos nuevos": "new items",
  "Pulsa “Iniciar repaso” para empezar. Primero salen los repasos pendientes y después, como mucho, {n} de tu nivel ({level}).": "Press “Start review” to begin. Due reviews come first, then at most {n} from your level ({level}).",
  "No queda nada por estudiar ahora. Lee un texto o agrega palabras en “Mis palabras”.": "Nothing left to study right now. Read a text or add words in “My words”.",
  "agregada a mano": "added by you",
  "vista en lecturas": "seen in readings",
  "kanjis conocidos {known}/{total}": "known kanji {known}/{total}",
  "frecuencia n.º {rank}": "frequency #{rank}",
  "sin puesto de frecuencia": "no frequency rank",
  "espera al kanji {kanji}": "waiting for kanji {kanji}",
  "Depuración: próximas palabras nuevas": "Debug: next new words",
  "Puntuación = a mano × {manual} + lectura × {reading} + kanjis conocidos × {kanji} + frecuencia × {frequency}. Los pesos están en study-config.js.": "Score = added by you × {manual} + reading × {reading} + known kanji × {kanji} + frequency × {frequency}. The weights are in study-config.js.",
  "Puntos": "Score",
  "Por qué": "Why",
  "{n} en espera: son básicas pero llevan un kanji avanzado que aún no ha salido en tus lecturas.": "{n} on hold: basic words with an advanced kanji that has not appeared in your readings yet.",
  "a mano": "by hand",
  "lectura": "reading",
  "lista de frecuencia": "frequency list",
  "Escribe la palabra en japonés.": "Write the word in Japanese.",
  "Escribe la lectura en hiragana.": "Write the reading in hiragana.",
  "{word} guardada como dominada.": "{word} saved as known.",
  "{word} ya está en tus repasos.": "{word} is already in your reviews.",
  "{word} guardada. Al ir solo en kana no se repasa, pero se usará en tus textos.": "{word} saved. Kana-only words are not reviewed, but it will be used in your texts.",
  "{word} agregada: será de las primeras palabras nuevas del repaso.": "{word} added: it will be among the first new words in review.",
  "dominada": "known",
  "Todavía no has agregado ninguna palabra.": "You have not added any words yet.",
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
  "Biblioteca": "Library",
  "Mis palabras": "My words",
  "Ajustes": "Settings",
  "Modos de estudio": "Study modes",
  "Leer": "Read",
  "Repasar": "Review",
  "Estadísticas": "Stats",
  "LECTURA": "READING",
  "Lee a tu nivel": "Read at your level",
  "Antes de leer, veamos tu nivel": "Before reading, let's check your level",
  "Elige el nivel que crees tener y responde {n} preguntas rápidas. Con eso sabremos qué palabras dar por conocidas y qué textos proponerte.":
    "Pick the level you think you have and answer {n} quick questions. That tells us which words to treat as known and which texts to offer you.",
  "Empezar evaluación": "Start evaluation",
  "Evaluación de nivel": "Level evaluation",
  "¿Cómo se lee y qué significa?": "How is it read and what does it mean?",
  "No la conozco": "I don't know it",
  "Tu nivel de lectura: {level}": "Your reading level: {level}",
  "Acertaste {right} de {total}.": "You got {right} out of {total} right.",
  "Daremos por conocido el vocabulario hasta {level}; los textos irán afinándolo.":
    "We will treat vocabulary up to {level} as known; the texts will refine it.",
  "Empezaremos desde lo más básico; los textos irán marcando lo que ya sabes.":
    "We will start from the basics; the texts will mark what you already know.",
  "Empezar a leer": "Start reading",
  "TEXTO RECOMENDADO": "RECOMMENDED TEXT",
  "Leer ahora": "Read now",
  "No hay textos sin leer a tu nivel": "There are no unread texts at your level",
  "Crear un texto nuevo": "Create a new text",
  "Tipo de texto": "Text type",
  "Tema": "Topic",
  "Otro (escríbelo)": "Other (type it)",
  "Longitud": "Length",
  "Tu tema": "Your topic",
  "Crea uno nuevo aquí abajo: elige tipo, tema y longitud, y la IA lo escribe para ti.":
    "Create a new one below: choose type, topic and length, and the AI writes it for you.",
  "La IA escribe un texto a tu medida con las palabras que ya conoces. Tarda alrededor de un minuto.":
    "The AI writes a text tailored to you with the words you already know. It takes about a minute.",
  "Modo manual": "Manual mode",
  "Generar con IA": "Generate with AI",
  "1. Copia el prompt. 2. Pégalo en tu IA (ChatGPT, Claude, Gemini…). 3. Pega aquí su respuesta.":
    "1. Copy the prompt. 2. Paste it into your AI (ChatGPT, Claude, Gemini…). 3. Paste its answer here.",
  "Inicia sesión para generar textos con IA.": "Sign in to generate texts with AI.",
  "Has llegado al límite de hoy ({n} textos). Mañana podrás crear más, o usa el modo manual.":
    "You have reached today's limit ({n} texts). You can create more tomorrow, or use manual mode.",
  "Hoy ha habido demasiados intentos fallidos. Inténtalo mañana o usa el modo manual.":
    "There have been too many failed attempts today. Try again tomorrow or use manual mode.",
  "La IA no consiguió escribir un texto válido. No se ha descontado de tu límite; inténtalo de nuevo.":
    "The AI could not write a valid text. It has not been counted against your limit; try again.",
  "El primer intento no salió bien. Probando de nuevo…": "The first attempt did not work. Trying again…",
  "La IA ha agotado su cuota por ahora. Inténtalo más tarde o usa el modo manual.":
    "The AI has run out of quota for now. Try again later or use manual mode.",
  "El texto salió demasiado largo y se cortó. Prueba con una longitud menor.":
    "The text came out too long and was cut off. Try a shorter length.",
  "La generación con IA aún no está configurada. Usa el modo manual.":
    "AI generation is not set up yet. Use manual mode.",
  "La IA no pudo escribir el texto. Inténtalo de nuevo o usa el modo manual.":
    "The AI could not write the text. Try again or use manual mode.",
  "La IA está escribiendo tu texto… puede tardar un minuto.": "The AI is writing your text… it may take a minute.",
  "Revisando el formato del texto…": "Checking the text format…",
  "La IA no devolvió un texto válido. Inténtalo de nuevo.": "The AI did not return a valid text. Try again.",
  "Prompt para la IA": "Prompt for the AI",
  "Copiar prompt": "Copy prompt",
  "Copiado.": "Copied.",
  "Respuesta de la IA (JSON)": "AI answer (JSON)",
  "Validar y leer": "Validate and read",
  "Escribe un tema primero.": "Type a topic first.",
  "Historia corta": "Short story",
  "Diálogo": "Dialogue",
  "Diario": "Diary entry",
  "Mensaje o correo": "Message or email",
  "Descripción": "Description",
  "Noticia sencilla": "Simple news article",
  "Vida diaria": "Daily life",
  "Comida": "Food",
  "Viajes": "Travel",
  "Trabajo": "Work",
  "Escuela": "School",
  "Familia": "Family",
  "Compras": "Shopping",
  "Tiempo libre": "Free time",
  "Corto (unas 50 palabras)": "Short (about 50 words)",
  "Medio (unas 100 palabras)": "Medium (about 100 words)",
  "Largo (unas 150 palabras)": "Long (about 150 words)",
  "Salir": "Exit",
  "Traducción de la frase": "Sentence translation",
  "Pegar del portapapeles": "Paste from clipboard",
  "{n} caracteres": "{n} characters",
  "El navegador no dejó leer el portapapeles: mantén pulsado el cuadro y elige Pegar.":
    "The browser did not allow reading the clipboard: press and hold the box and choose Paste.",
  "La respuesta está incompleta: llegaron {chars} caracteres y el JSON se corta a medias. Suele pasar al pegar en el móvil o cuando la IA no termina de escribir. Prueba el botón “Pegar del portapapeles”, o pega el resto a continuación.":
    "The answer is incomplete: {chars} characters arrived and the JSON is cut off midway. This often happens when pasting on a phone or when the AI does not finish writing. Try the “Paste from clipboard” button, or paste the rest after it.",
  "Guardar solo las {n} completas": "Save only the {n} that are complete",
  "Oración {n}: hay una unidad vacía (dos “|” seguidos, o uno al principio o al final).":
    "Sentence {n}: there is an empty unit (two “|” in a row, or one at the start or the end).",
  "No se pudo cargar el analizador de japonés (unos 18 MB la primera vez). Comprueba la conexión y vuelve a intentarlo.":
    "The Japanese analyser could not be loaded (about 18 MB the first time). Check your connection and try again.",
  "Analizando el texto… la primera vez se descarga el analizador de japonés (18 MB).":
    "Analysing the text… the first time, the Japanese analyser is downloaded (18 MB).",
  "Créditos": "Credits",
  "y": "and",
  "Esta app usa los diccionarios": "This app uses the",
  ", propiedad del": "dictionaries, property of the",
  ", bajo su": ", under its",
  "(CC BY-SA 4.0). Los trazos de los kanjis son de": "(CC BY-SA 4.0). Kanji strokes are from",
  "(CC BY-SA 3.0). El análisis del japonés lo hace": "(CC BY-SA 3.0). Japanese analysis is done by",
  "(Apache 2.0) con el diccionario IPADIC.": "(Apache 2.0) with the IPADIC dictionary.",
  "licencia": "licence",
  "Reportar error": "Report an error",
  "Reportar un error en este texto": "Report an error in this text",
  "Sirve para mejorar los textos que escribe la IA.": "It helps improve the texts the AI writes.",
  "Tipo de error": "Type of error",
  "Traducción incorrecta": "Wrong translation",
  "Lectura o furigana incorrecta": "Wrong reading or furigana",
  "Palabras mal separadas": "Words split incorrectly",
  "Demasiado difícil para mi nivel": "Too difficult for my level",
  "Otro": "Other",
  "Comentario (opcional)": "Comment (optional)",
  "Enviar reporte": "Send report",
  "Inicia sesión para enviar reportes.": "Sign in to send reports.",
  "No se pudo enviar el reporte. Inténtalo de nuevo.": "The report could not be sent. Try again.",
  "Toca una palabra para ver su lectura y significado, o 訳 para traducir la frase entera.":
    "Tap a word to see its reading and meaning, or 訳 to translate the whole sentence.",
  "Ver la traducción de la frase": "See the sentence translation",
  "Nuevas": "New ones",
  "Ninguna": "None",
  "Saltar: es muy difícil": "Skip: too difficult",
  "TU TEXTO PENDIENTE": "YOUR PENDING TEXT",
  "Termina este texto para crear otro. Si es demasiado difícil puedes saltarlo (te quedan {n}).":
    "Finish this text to create another. If it is too difficult you can skip it ({n} left).",
  "salto": "skip",
  "saltos": "skips",
  "Ya saltaste {n} textos seguidos: termina este para poder crear otro.":
    "You have skipped {n} texts in a row: finish this one to be able to create another.",
  "Tienes un texto sin terminar ({title}). Léelo o sáltalo antes de agregar otro.":
    "You have an unfinished text ({title}). Read it or skip it before adding another.",
  "Terminar lectura": "Finish reading",
  "Cerrar": "Close",
  "Forma de diccionario": "Dictionary form",
  "Nueva": "New",
  "Conocía la palabra, no el kanji": "Knew the word, not the kanji",
  "La conocía, solo comprobaba": "Knew it, just checking",
  "Texto saltado": "Text skipped",
  "En la evaluación: {mastered} y {learning}.": "In the evaluation: {mastered} and {learning}.",
  "palabra dominada": "word mastered",
  "palabras dominadas": "words mastered",
  "por aprender": "to learn",
  "Lectura terminada. ¿Las conocías de verdad?": "Reading finished. Did you really know them?",
  "Hay {n} sin confirmar. Una evaluación rápida comprueba cuáles dominas ya.":
    "There are {n} still unconfirmed. A quick evaluation checks which ones you already master.",
  "Ahora no": "Not now",
  "Evaluación": "Evaluation",

  /* ---------- study.js: estudio y escritura sobre el banco ---------- */
  "Palabras y kanjis": "Words and kanji",
  "Se pide un kanji cada vez, por su significado y con una palabra de ejemplo. Dibuja cada trazo en su orden y dirección.":
    "One kanji is asked at a time, by its meaning and with an example word. Draw each stroke in its order and direction.",
  "No se pudo cargar el contenido de este nivel": "The content for this level could not be loaded",
  "Comprueba la conexión y vuelve a intentarlo.": "Check your connection and try again.",
  "Pulsa “Iniciar repaso” para empezar. Primero salen los repasos pendientes y después elementos nuevos.":
    "Press “Start review” to begin. Reviews that are due come first, then new items.",
  "No queda nada por estudiar con estos filtros. Cambia el contenido o el nivel.":
    "Nothing left to study with these filters. Change the content or the level.",
  "¿Qué significa este kanji?": "What does this kanji mean?",
  "Escribe la lectura (hiragana)": "Type the reading (hiragana)",
  "Esa lectura también existe, pero aquí se pide la más habitual.":
    "That reading also exists, but here we want the most usual one.",
  "Esa es la lectura de otro significado ({meaning}).": "That is the reading of another meaning ({meaning}).",
  "kanji disponible": "kanji available",
  "kanjis disponibles": "kanji available",
  "Aún no hay kanjis para escribir": "No kanji to write yet",
  "Aquí aparecen los kanjis de las palabras que ya has acertado al estudiar o que dominas al leer.":
    "The kanji of the words you have answered correctly when studying, or that you master when reading, appear here.",
  "Escribe el kanji que significa:": "Write the kanji that means:",
  "Usado en:": "Used in:",

  /* ---------- estadísticas de lectura ---------- */
  "Palabras vistas": "Words seen",
  "Sabes leer": "You can read",
  "Entiendes": "You understand",
  "Sabes escribir": "You can write",
  "Próximamente": "Coming soon",
  "Textos leídos": "Texts read",
  "Racha de lectura": "Reading streak",
  "Palabras por estado": "Words by status",
  "Palabras nuevas por semana": "New words per week",
  "Palabras que viste por primera vez en las últimas 8 semanas.": "Words you first saw in the last 8 weeks.",
  "Las que más consultas": "Most looked up",
  "Las que más fallas en las evaluaciones": "Most missed in evaluations",
  "Palabras de tus lecturas": "Words from your readings",
  "Buscar palabra, lectura o significado…": "Search word, reading or meaning…",
  "Repaso de kanjis y palabras": "Kanji and word review",
  "Dominadas": "Mastered",
  "Por confirmar": "To confirm",
  "Desconocidas": "Unknown",
  "Dominada": "Mastered",
  "Desconocida": "Unknown",
  "Aquí verás tus palabras cuando termines tu primera lectura.": "Your words will appear here once you finish your first reading.",
  "Esta semana": "This week",
  "palabra nueva": "new word",
  "palabras nuevas": "new words",
  "consulta": "lookup",
  "consultas": "lookups",
  "Aquí aparecerán las palabras que más consultes al leer.": "The words you look up most while reading will appear here.",
  "Aquí aparecerán las palabras que más falles en las evaluaciones.": "The words you miss most in evaluations will appear here.",
  "No se encontraron palabras.": "No words found.",
  "Todavía no hay palabras de tus lecturas.": "There are no words from your readings yet.",
  "Sabe leerla · Sabe el significado": "Can read it · Knows the meaning",
  "¿Cómo se lee?": "How is it read?",
  "¿Qué significa?": "What does it mean?",
  "Lectura terminada": "Reading finished",
  "Consultaste {n} de este texto.": "You looked up {n} in this text.",
  "palabra": "word",
  "Parece que este nivel te queda difícil. ¿Quieres textos de {level}?":
    "This level seems hard for you. Would you like {level} texts?",
  "Cambiar a {level}": "Switch to {level}",
  "Siguiente texto": "Next text",
  "Descartado": "Discarded",
  "Lectura": "Reading",
  "Furigana sobre las palabras y nivel de los textos que se te proponen.":
    "Furigana over words, and the level of the texts offered to you.",
  "Furigana: solo palabras desconocidas": "Furigana: unknown words only",
  "Furigana: siempre": "Furigana: always",
  "Furigana: nunca": "Furigana: never",
  "Nivel de lectura": "Reading level",
  "Repetir evaluación": "Retake evaluation",
  "TUS TEXTOS": "YOUR TEXTS",
  "Tu biblioteca está vacía": "Your library is empty",
  "Los textos que agregues se guardarán aquí, con el porcentaje de sus palabras que ya conoces.":
    "The texts you add will be saved here, with the percentage of their words you already know.",
  "Agregar un texto": "Add a text",
  "JSON del texto": "Text JSON",
  "Pega el JSON que te devolvió la IA. Se comprueba antes de guardarlo y, si algo falla, verás exactamente qué corregir.":
    "Paste the JSON the AI gave you. It is checked before saving and, if something is wrong, you will see exactly what to fix.",
  "Cargar ejemplo": "Load example",
  "Validar y guardar": "Validate and save",
  "texto": "text",
  "textos": "texts",
  "oración": "sentence",
  "oraciones": "sentences",
  "{percent} % conocido": "{percent}% known",
  "Leído": "Finished",
  "De la comunidad": "From the community",
  "Compartido": "Shared",
  "No aprobado": "Not approved",
  "Pendiente de aprobación": "Awaiting approval",
  "Sin leer": "Unread",
  "El texto no se guardó. Hay que corregir esto:": "The text was not saved. This needs fixing:",
  "…y {n} más.": "…and {n} more.",
  "Pega primero el JSON del texto.": "Paste the text JSON first.",
  "Texto guardado: {title} ({n}).": "Text saved: {title} ({n}).",
  "Ese texto ya está en tu biblioteca.": "That text is already in your library.",
  "¿Eliminar el texto “{title}”?": "Delete the text “{title}”?",

  /* ---------- reading.js: validador ---------- */
  "No es un JSON válido: {error}": "Not valid JSON: {error}",
  "El JSON debe ser un objeto con “title”, “level” y “sentences”.":
    "The JSON must be an object with “title”, “level” and “sentences”.",
  "Falta el campo “{field}” (texto no vacío).": "The field “{field}” is missing (non-empty text).",
  "“level” debe ser uno de: N5, N4, N3, N2, N1.": "“level” must be one of: N5, N4, N3, N2, N1.",
  "“sentences” debe ser una lista con al menos una oración.": "“sentences” must be a list with at least one sentence.",
  "Oración {n}, dictionary “{lemma}”: debe ser un objeto.": "Sentence {n}, dictionary “{lemma}”: must be an object.",
  "Oración {n}, dictionary “{lemma}”: “reading” debe estar en kana.":
    "Sentence {n}, dictionary “{lemma}”: “reading” must be in kana.",
  "Oración {n}, dictionary “{lemma}”: “{field}” debe ser una lista de textos.":
    "Sentence {n}, dictionary “{lemma}”: “{field}” must be a list of strings.",
  "Oración {n}: debe ser un objeto.": "Sentence {n}: must be an object.",
  "Oración {n}: “id” debe ser un número entero que no se repita.": "Sentence {n}: “id” must be a unique integer.",
  "Oración {n}: falta “{field}”.": "Sentence {n}: “{field}” is missing.",
  "Oración {n}: “paragraph” debe ser un número entero mayor que 0.": "Sentence {n}: “paragraph” must be an integer greater than 0.",
  "Oración {n}: falta “dictionary” (objeto con las palabras de la oración).":
    "Sentence {n}: “dictionary” is missing (an object with the words of the sentence).",
  "Oración {n}: “tokens” debe ser una lista no vacía.": "Sentence {n}: “tokens” must be a non-empty list.",
  "Oración {n}, token {i} ({surface}): falta “{field}”.": "Sentence {n}, token {i} ({surface}): “{field}” is missing.",
  "Oración {n}, token {i} ({surface}): “pos” no admite “{pos}”. Valores: {list}.":
    "Sentence {n}, token {i} ({surface}): “pos” does not allow “{pos}”. Values: {list}.",
  "Oración {n}, token {i} ({surface}): “reading” debe estar en kana.":
    "Sentence {n}, token {i} ({surface}): “reading” must be in kana.",
  "Oración {n}: falta “{lemma}” en “dictionary”.": "Sentence {n}: “{lemma}” is missing from “dictionary”.",
  "Oración {n}: los tokens no reproducen “jp”. Coinciden hasta “{same}”; después “jp” sigue con “{jp}” y los tokens con “{tokens}”.":
    "Sentence {n}: the tokens do not reproduce “jp”. They match up to “{same}”; then “jp” continues with “{jp}” and the tokens with “{tokens}”.",
  "CUENTA Y PREFERENCIAS": "ACCOUNT AND PREFERENCES",
  "Escribir": "Write",
  "Mis listas": "My lists",

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

  "Sincronizar ahora": "Sync now",
  "Descargar mis datos": "Download my data",
  "Descarga un archivo JSON con tus kanjis, palabras y progreso de repaso. Para tenerlos en otro dispositivo, inicia sesión con tu cuenta.":
    "Download a JSON file with your kanji, words and review progress. To have them on another device, sign in with your account.",
  "↓ Exportar JSON": "↓ Export JSON",
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
  "Escribe la lectura (hiragana o katakana)": "Type the reading (hiragana or katakana)",
  "Escribe la lectura de la palabra (hiragana)": "Type the reading of the word (hiragana)",
  "Esa lectura existe, pero aquí se pide la más común del kanji solo.":
    "That reading exists, but here we want the most common one for the kanji on its own.",
  "Esa lectura existe, pero aquí se pide la de la palabra completa.":
    "That reading exists, but here we want the reading of the whole word.",
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
  "Sincronizando…": "Syncing…",
  "Sincronizado": "Synced",
  "Sin conexión": "Offline",
  "Error al sincronizar": "Sync error",
  "Última sincronización: {time}.": "Last sync: {time}.",
  "{n} sin lectura. Puedes reintentar la consulta o escribirla a mano desde “Mis listas”.":
    "{n} without a reading. You can retry the lookup or type it by hand from “My lists”.",
  "Todos los elementos tienen lectura.": "All items have a reading.",
  "Con una cuenta, tus listas y tu progreso se guardan en la nube y se mantienen al día en todos tus dispositivos. Sin cuenta, todo se queda solo en este navegador.":
    "With an account, your lists and progress are stored in the cloud and kept up to date on all your devices. Without one, everything stays in this browser only.",
  "Iniciar sesión o crear cuenta": "Sign in or create an account",
  "Mi perfil": "My profile",
  "Estudiante desde {date}": "Student since {date}",
  "Palabras dominadas": "Words mastered",
  "Kanjis aprendidos": "Kanji learned",
  "Cambiar contraseña": "Change password",
  "Panel de administración": "Admin panel",
  "Cerrar sesión": "Sign out",
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
