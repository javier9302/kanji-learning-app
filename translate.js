/* =========================================
   KANJI LEARNING APP - translate.js
   Sección "Traducir": se enseña una frase en japonés, el estudiante escribe
   su traducción y se corrige. Las reglas están en translate-core.js; aquí va
   lo que toca al navegador. Se carga después de sentences.js.

   Almacén de IndexedDB:
     translations  un registro por frase respondida:
                   { id, sentenceId, textId, at, answer, answerKey, source, verdict, score, result }
                   Sirve para no repetir frases, para reutilizar una corrección
                   ya hecha y para el resumen. Se queda en el dispositivo.
   ========================================= */

let translationLog = [];   // registros de translations, del más antiguo al más reciente
let translating = null;    // ejercicio en curso: { sentence, lookups: Set(claves), phase, result, session }

async function loadTranslateData() {
  translationLog = (await getAll("translations")).sort((a, b) => a.at - b.at);
}

/* =========================================
   1. QUÉ FRASE TOCA
   ========================================= */

/* Frases que se pueden proponer. Hoy salen de los textos del usuario (y de las
   comunes de la app cuando existan); todo lo demás usa solo esta función, así
   que añadir otra fuente no cambia nada más. */
function translationCandidates() {
  const list = [...userSentences.values()];
  for (const level of staticSentences.values()) list.push(...level);
  return list.filter((sentence) => isTranslatable(sentence, STUDY_CONFIG.translate));
}

/* Lo que se sabe de una palabra para elegir la frase */
function translateWordState(key, known = knownLemmas()) {
  const rec = userWords.get(key);
  const isKnown = isKnownKey(key, known);
  return {
    known: isKnown,
    status: rec?.status || (isKnown ? "mastered" : "unknown"),
    lookups: rec?.lookups || 0,
    failures: (rec?.evalWrong || 0) + (rec?.incorrectCount || 0) + (rec?.meaningWrong || 0)
  };
}

function nextTranslationSentence() {
  const known = knownLemmas();
  const lastSeen = new Map(translationLog.map((entry) => [entry.sentenceId, entry.at]));
  return chooseTranslationSentence({
    candidates: translationCandidates(),
    wordOf: (key) => translateWordState(key, known),
    lastSeenOf: (id) => lastSeen.get(id) || 0,
    lastTextId: translationLog[translationLog.length - 1]?.textId || "",
    now: Date.now()
  }, STUDY_CONFIG.translate);
}

/* =========================================
   2. EL EJERCICIO
   -----------------------------------------
   Fases: "answer" (escribe la traducción), "self" (sin IA: ve la referencia y
   se corrige él mismo) y "result" (la corrección).
   ========================================= */

const referenceOf = (sentence) => sentenceTranslation(sentence);
const sentencePlain = (sentence) => sentence.tokens.map((token) => token.surface).join("");

/* La frase con cada palabra como botón: al tocarla se ve su lectura y su significado */
function translateLineHTML(sentence, { reveal = false } = {}) {
  const known = knownLemmas();
  return sentence.tokens.map((token, index) => {
    const hasKanji = /\p{Script=Han}/u.test(token.surface) && token.reading;
    const unknown = !!token.key && !UNCOUNTED_POS.has(token.pos) && !isKnownKey(token.key, known);
    const ruby = hasKanji && (reveal || prefs.furigana === "all" || prefs.furigana === "unknown" && unknown);
    const html = ruby ? rubyHTML(token.surface, token.reading) : escapeHTML(token.surface);
    if (!token.key) return html;
    const looked = translating.lookups.has(token.key);
    return `<span class="tok tr-tok${looked ? " tok-looked" : ""}" role="button" tabindex="0" data-tr-tok="${index}">${html}</span>`;
  }).join("");
}

async function renderTranslate() {
  const area = $("translateArea");
  if (!translating) {
    // Las frases comunes de su nivel (cuando existan) también valen
    await ensureSentences(BANK.LEVELS.slice(0, BANK.LEVELS.indexOf(userLevel()) + 1)).catch(() => {});
    if (document.body.dataset.view !== "translate" || translating) return;
    const sentence = nextTranslationSentence();
    if (!sentence) {
      area.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" lang="ja">訳</div>
          <h3>${t("Todavía no hay frases para traducir")}</h3>
          <p>${t("Las frases salen de los textos que has leído o guardado (los que tienen traducción). Lee un texto y vuelve.")}</p>
          <button class="button button-primary" type="button" data-go="read">${t("Ir a Leer")}</button>
        </div>`;
      return;
    }
    translating = { sentence, lookups: new Set(), phase: "answer", result: null, answer: "", session: translateSession() };
  }
  if (translating.phase === "answer") return renderTranslateQuestion();
  if (translating.phase === "self") return renderTranslateSelf();
  renderTranslateResult();
}

/* Resumen de la tanda actual (se pierde al salir de la app: es solo orientativo) */
let translateTally = null;
const translateSession = () => translateTally ??= { done: 0, scores: [], understood: new Set(), review: new Set() };

function renderTranslateQuestion() {
  const { sentence, session } = translating;
  const max = STUDY_CONFIG.translate.answerMax;
  $("translateArea").innerHTML = `
    <div class="card translate-card">
      <div class="card-top">
        <span class="pill">${t("Traducir")}</span>
        <span class="card-progress">${plural(session.done, "frase hecha", "frases hechas")}</span>
      </div>
      <div class="card-sentence" lang="ja">${translateLineHTML(sentence)}</div>
      <p id="trGloss" class="helper sent-gloss" aria-live="polite">${t("Toca una palabra si necesitas ayuda (contará como consultada).")}</p>
      <form id="trForm" autocomplete="off">
        <label class="field">
          <span>${t("Tu traducción")}</span>
          <textarea id="trInput" rows="2" maxlength="${max}" spellcheck="true"
            placeholder="${t("Escribe qué significa la frase, en español o en inglés")}">${escapeHTML(translating.answer)}</textarea>
        </label>
        <div class="tr-tools">
          <span id="trCount" class="helper" aria-live="off"></span>
          <span class="helper">${t("Ctrl + Intro para comprobar")}</span>
        </div>
        <div class="row-actions">
          <button id="trSkipBtn" class="button button-quiet" type="button">${t("Saltar")}</button>
          <button id="trUnknownBtn" class="button button-secondary" type="button">${t("No lo sé")}</button>
          <button id="trCheckBtn" class="button button-primary" type="submit">${t("Comprobar")}</button>
        </div>
      </form>
      <p id="trFeedback" class="message" role="status" aria-live="polite"></p>
    </div>`;

  const input = $("trInput");
  const count = () => {
    const length = [...input.value].length;
    $("trCount").textContent = t("{n} / {max} caracteres", { n: length, max });
    $("trCount").classList.toggle("limit", length >= max);
  };
  input.addEventListener("input", () => {
    translating.answer = input.value;
    $("trFeedback").textContent = ""; // el aviso anterior ya no vale
    count();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $("trForm").requestSubmit(); }
  });
  count();
  input.focus();

  $("trForm").addEventListener("submit", (event) => { event.preventDefault(); checkTranslation(); });
  $("trUnknownBtn").onclick = () => finishTranslation(localResult(sentence, "unknown", "incorrect"));
  $("trSkipBtn").onclick = skipTranslation;
}

/* Tocar una palabra mientras se responde: se ve su lectura y significado, y
   queda anotada como consultada (después no suma como entendida) */
function translateLookup(index) {
  const token = translating.sentence.tokens[index];
  if (!token?.key) return;
  if (translating.phase === "answer") translating.lookups.add(token.key);
  const gloss = $("trGloss");
  if (gloss) gloss.innerHTML = tokenGlossHTML(token);
  document.querySelectorAll(`[data-tr-tok="${index}"]`).forEach((node) => node.classList.add("tok-looked"));
}

/* "Comprobar": primero lo que se puede resolver sin IA */
async function checkTranslation() {
  const say = (text, cls = "") => { $("trFeedback").textContent = text; $("trFeedback").className = `message ${cls}`; };
  const answer = normalizeAnswer($("trInput").value, STUDY_CONFIG.translate.answerMax);
  const problem = answerProblem(answer, STUDY_CONFIG.translate);
  if (problem) {
    return say(problem === "empty" ? t("Escribe tu traducción primero.")
      : t("Es demasiado corta para corregirla: escribe al menos una palabra."), "incorrect");
  }
  translating.answer = answer;
  const result = await gradeTranslation(translating.sentence, answer);
  if (!translating) return;
  if (result) return finishTranslation(result);
  // Sin corrección automática: ve la referencia y se corrige él mismo
  translating.phase = "self";
  renderTranslate();
}

/* Corrige una respuesta. Devuelve el resultado, o null si hay que corregirse a
   uno mismo. translating.notice explica por qué no hubo IA. */
async function gradeTranslation(sentence, answer) {
  translating.notice = "";
  return null;
}

/* Sin IA: la traducción de referencia y tres botones para corregirse */
function renderTranslateSelf() {
  const { sentence, answer, notice } = translating;
  $("translateArea").innerHTML = `
    <div class="card translate-card">
      <div class="card-top"><span class="pill">${t("Traducir")}</span></div>
      <div class="card-sentence answered" lang="ja">${translateLineHTML(sentence, { reveal: true })}</div>
      <p id="trGloss" class="helper sent-gloss" aria-live="polite"></p>
      ${notice ? `<p class="message">${escapeHTML(notice)}</p>` : ""}
      <dl class="tr-compare">
        <dt>${t("Tu traducción")}</dt><dd>${escapeHTML(answer)}</dd>
        <dt>${t("Traducción de referencia")}</dt><dd>${escapeHTML(referenceOf(sentence))}</dd>
      </dl>
      <p class="helper">${t("Compara las dos y dinos cómo te fue. Lo que importa es el significado, no las palabras exactas.")}</p>
      <div class="card-actions">
        <button class="button button-wrong" type="button" data-tr-self="incorrect">✗ ${t("No la entendí")}</button>
        <button class="button button-hard" type="button" data-tr-self="partial">≈ ${t("En parte")}</button>
        <button class="button button-good" type="button" data-tr-self="correct">✓ ${t("La entendí")}</button>
      </div>
    </div>`;
  $("translateArea").querySelector('[data-tr-self="correct"]').focus();
}

const VERDICTS = () => ({
  correct: ["✓", t("Correcta"), "correct"],
  mostly: ["✓", t("Casi correcta"), "correct"],
  partial: ["≈", t("En parte"), "partial"],
  incorrect: ["✗", t("Incorrecta"), "incorrect"]
});

function renderTranslateResult() {
  const { sentence, answer, result } = translating;
  const [icon, label, cls] = VERDICTS()[result.verdict];
  const origin = {
    unknown: t("No la sabías: esta es la traducción."),
    self: t("Corregida por ti."),
    local: t("Coincide con la traducción de referencia."),
    cache: t("Ya habías dado esta respuesta: es la corrección de entonces.")
  }[result.cached ? "cache" : result.source] || "";
  $("translateArea").innerHTML = `
    <div class="card translate-card">
      <div class="card-top">
        <span class="pill">${t("Traducir")}</span>
        <span class="card-progress">${plural(translating.session.done, "frase hecha", "frases hechas")}</span>
      </div>
      <div class="card-sentence answered" lang="ja">${translateLineHTML(sentence, { reveal: true })}</div>
      <p id="trGloss" class="helper sent-gloss" aria-live="polite"></p>
      <div id="trResult" aria-live="polite">
        <p class="tr-verdict tr-${cls}"><span aria-hidden="true">${icon}</span> ${label}${
          result.source === "ai" ? ` · ${result.score} / 100` : ""}</p>
        ${origin ? `<p class="helper tr-origin">${origin}</p>` : ""}
        <dl class="tr-compare">
          ${answer ? `<dt>${t("Tu traducción")}</dt><dd>${escapeHTML(answer)}</dd>` : ""}
          <dt>${t("Traducción de referencia")}</dt><dd>${escapeHTML(referenceOf(sentence))}</dd>
        </dl>
      </div>
      <div class="row-actions">
        ${"speechSynthesis" in window ? `<button id="trSpeakBtn" class="button button-quiet speak-btn" type="button">🔊 ${t("Escuchar")}</button>` : ""}
        <button id="trNextBtn" class="button button-primary" type="button">${t("Siguiente")} →</button>
      </div>
    </div>`;
  if ($("trSpeakBtn")) $("trSpeakBtn").onclick = () => speak(sentencePlain(sentence));
  $("trNextBtn").onclick = nextTranslation;
  $("trNextBtn").focus();
}

/* Guarda la frase respondida y enseña la corrección */
async function finishTranslation(result) {
  const { sentence, answer, session } = translating;
  translating.result = result;
  translating.phase = "result";
  session.done++;
  session.scores.push(result.score);
  const entry = {
    id: newId(), sentenceId: sentence.id, textId: sentence.sourceId || "", at: Date.now(),
    answer, source: result.source, verdict: result.verdict, score: result.score, result,
    lookups: [...translating.lookups]
  };
  translationLog.push(entry);
  await putRecords("translations", [entry]);
  if (translating?.result === result) renderTranslate();
}

/* "Saltar": ni suma ni resta; la frase tarda en volver a salir */
async function skipTranslation() {
  const { sentence } = translating;
  const entry = { id: newId(), sentenceId: sentence.id, textId: sentence.sourceId || "", at: Date.now(), source: "skip" };
  translationLog.push(entry);
  await putRecords("translations", [entry]);
  nextTranslation();
}

function nextTranslation() {
  translating = null;
  renderTranslate();
}

function bindTranslate() {
  const area = $("translateArea");
  area.addEventListener("click", (event) => {
    if (!translating) return;
    const token = event.target.closest("[data-tr-tok]");
    if (token) return translateLookup(Number(token.dataset.trTok));
    const self = event.target.closest("[data-tr-self]");
    if (self && translating.phase === "self") finishTranslation(localResult(translating.sentence, "self", self.dataset.trSelf));
  });
  area.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-tr-tok]")) {
      event.preventDefault();
      event.target.click();
    }
  });
}
