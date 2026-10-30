/* =========================================
   KANJI LEARNING APP - capture.js
   Palabras de la web (etapa 3): la app se abre con ?add=…&sentence=…&source=…
   (el marcador «+ Kanji» o un enlace) o con ?share_text=… («Compartir» de
   Android, share_target del manifiesto). Se abre Agregar palabra con la
   palabra en su forma de diccionario y la frase con la palabra resaltada;
   no se guarda nada hasta que el usuario pulsa un botón.
   La frase se guarda como frase del usuario (almacén "sentences", source
   "web", con word y url): se sincroniza con su cuenta como las de sus textos,
   nunca se comparte con otros usuarios y en Repasar manda para su palabra
   (chooseCapturedSentence). Las reglas están en capture-core.js.
   Lo que llega de fuera se escribe con textContent, nunca como HTML.
   ========================================= */

/* Lo que llegó: { word, sentence, source, tokens, target, key } (tokens: la
   frase analizada; target: la unidad de la palabra; key: su clave) */
let capture = null;

/* Al abrir la app: si la dirección trae una palabra, Agregar palabra con ella.
   La dirección se limpia al momento: recargar no la vuelve a proponer. */
async function receiveCapture() {
  const received = readCapture(location.search);
  if (location.search) history.replaceState(null, "", location.pathname + location.hash);
  if (!received) return;
  capture = { ...received, tokens: null, target: -1, key: "" };
  switchView("add");
  $("addWordForm").reset();
  $("addWordMessage").textContent = "";
  if (capture.word) fillAddWord(capture.word, "");
  renderCapture();
  if (!capture.sentence) return baseFormOf(capture.word);

  try {
    const tokens = await analyseSentenceText(capture.sentence);
    if (!capture) return; // lo descartó mientras tanto
    capture.tokens = tokens;
    const index = capture.word ? findWordUnit(tokens, capture.word) : -1;
    if (index >= 0 && tokens[index].key) chooseCapturedUnit(index);
    else renderCapture();
  } catch (error) {
    console.error("No se pudo analizar la frase recibida:", error);
    if (capture) renderCapture(t("No se pudo analizar la frase. Puedes agregar la palabra igualmente."));
  }
}

/* Una palabra sin frase, quizá conjugada (食べました): su forma de diccionario.
   Si no se puede analizar, se queda como llegó. */
async function baseFormOf(word) {
  try {
    const tokens = await analyseSentenceText(word);
    const token = tokens[findWordUnit(tokens, word)];
    if (token?.key && capture?.word === word && normalizeText($("addWriting").value) === word) fillAddWord(...token.key.split("|"));
  } catch (error) {
    console.error("No se pudo analizar la palabra recibida:", error);
  }
}

/* Rellena el formulario de Agregar palabra con lo que sabe el banco */
function fillAddWord(writing, reading) {
  $("addWriting").value = writing;
  $("addReading").value = reading;
  $("addWriting").dispatchEvent(new Event("change")); // la lectura y el significado del banco
}

/* El usuario tocó (o se encontró) la unidad de la palabra */
function chooseCapturedUnit(index) {
  const token = capture.tokens[index];
  if (!token?.key) return;
  const [lemma, reading] = token.key.split("|");
  capture.target = index;
  capture.key = token.key;
  fillAddWord(lemma, reading);
  renderCapture();
}

/* ¿Ya está entre sus palabras? (estudiada, por aprender o dominada) */
const isOwnWord = (key) => {
  const rec = userWords.get(key);
  return !!rec && (rec.studied || ["learning", "mastered"].includes(rec.status));
};

/* El recuadro de la frase recibida, encima del formulario. note: un aviso */
function renderCapture(note = "") {
  const panel = $("capturePanel");
  panel.classList.toggle("hidden", !capture);
  if (!capture) return;

  const line = $("captureSentence");
  line.replaceChildren();
  if (capture.tokens) {
    // Cada palabra con contenido se puede tocar para elegirla
    capture.tokens.forEach((token, index) => {
      const pickable = !!token.key && !UNCOUNTED_POS.has(token.pos);
      const node = document.createElement(index === capture.target ? "mark" : pickable ? "button" : "span");
      node.textContent = token.surface;
      if (index === capture.target) node.className = "sent-target";
      else if (pickable) {
        node.type = "button";
        node.className = "capture-unit";
        node.dataset.captureUnit = index;
      }
      line.append(node);
    });
  } else {
    line.textContent = capture.sentence;
  }
  line.classList.toggle("hidden", !capture.sentence);

  const source = $("captureSource");
  source.replaceChildren();
  if (capture.source) {
    const link = document.createElement("a");
    link.href = capture.source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = new URL(capture.source).hostname;
    source.append(`${t("De")} `, link);
  }

  const own = capture.key && isOwnWord(capture.key);
  $("captureStatus").textContent = note ||
    (!capture.sentence ? "" :
      !capture.tokens ? t("Analizando la frase…") :
      capture.target < 0 ? t("Toca la palabra que quieres agregar.") :
      own ? t("{word} ya está en tus palabras. Puedes guardar esta frase como otro ejemplo.", { word: capture.tokens[capture.target].lemma }) :
      t("Comprueba la palabra y elige un botón. La frase será su ejemplo en Repasar."));
  $("captureSaveBtn").classList.toggle("hidden", !own);
}

/* Guarda la frase recibida como ejemplo de la palabra key. Devuelve un texto
   para el usuario, o "" si no hay frase que guardar. */
async function saveCapturedSentence(key) {
  if (!capture?.tokens || capture.key !== key) return "";
  const built = buildSentence({
    id: `web:${textHash(`${key}|${capture.sentence}`)}`, tokens: capture.tokens, en: "", es: "",
    source: "web", sourceId: "", attribution: "",
    wordOf: sentenceWordOf, tagsOf: sentenceTagsOf, fallbackLevel: meta.reading.level || "N5"
  });
  const record = { ...built, word: key, url: capture.source, capturedAt: Date.now(), updatedAt: Date.now() };
  // Solo si de verdad sirve para preguntar la palabra (está y se lee como ella)
  if (!chooseCapturedSentence({ id: key }, { candidates: [record] })) return t("La frase no se guardó: no se pudo enlazar con la palabra.");
  if (userSentences.has(record.id)) return t("Esa frase ya estaba guardada.");
  userSentences.set(record.id, record);
  await putRecords("sentences", [record]);
  forgetSentenceIndex();
  scheduleSync();
  return t("La frase será su ejemplo en Repasar.");
}

/* Después de «Quiero aprenderla» o «Ya la domino»: la frase va con la palabra */
async function finishCapture(key) {
  if (!capture) return "";
  const said = await saveCapturedSentence(key);
  if (capture.key === key || !capture.sentence) dropCapture();
  return said;
}

function dropCapture() {
  capture = null;
  renderCapture();
}

/* =========================================
   AJUSTES: AÑADIR PALABRAS DESDE LA WEB
   ========================================= */

/* La app sin ?… ni #…: a donde lleva el marcador */
const appAddress = () => location.origin + location.pathname;

function bindCapture() {
  $("captureSentence").addEventListener("click", (event) => {
    const unit = event.target.closest("[data-capture-unit]");
    if (unit && capture) chooseCapturedUnit(Number(unit.dataset.captureUnit));
  });
  $("captureDropBtn").onclick = dropCapture;
  $("captureSaveBtn").onclick = async () => {
    const said = await saveCapturedSentence(capture.key);
    dropCapture();
    $("addWordMessage").textContent = said;
    $("addWordMessage").className = "message correct";
  };

  const code = bookmarkletCode(appAddress(), t("Selecciona primero la palabra (o la frase) que quieres agregar."));
  const link = $("bookmarkletLink");
  link.href = code;
  // Dentro de la app no hace nada: se arrastra a la barra de marcadores
  link.onclick = (event) => {
    event.preventDefault();
    $("bookmarkletMessage").textContent = t("Arrástralo a la barra de marcadores; no se pulsa aquí.");
  };
  $("bookmarkletCode").value = code;
  $("bookmarkletCopyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      $("bookmarkletMessage").textContent = t("Código copiado. Pégalo como dirección de un marcador nuevo.");
    } catch {
      // Sin permiso para el portapapeles: se enseña para copiarlo a mano
      $("bookmarkletCode").classList.remove("hidden");
      $("bookmarkletCode").select();
      $("bookmarkletMessage").textContent = t("Cópialo a mano desde el cuadro.");
    }
  };
}
