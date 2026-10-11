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
    if (!sentence && translateTally?.done) return endTranslateSession(); // se acabaron las frases: resumen de la tanda
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
          ${session.done ? `<button id="trEndBtn" class="button button-quiet" type="button">${t("Terminar")}</button>` : ""}
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
  if ($("trEndBtn")) $("trEndBtn").onclick = endTranslateSession;
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
  const current = translating;
  $("trCheckBtn").disabled = $("trUnknownBtn").disabled = $("trSkipBtn").disabled = $("trInput").disabled = true;
  say(t("Corrigiendo…"));
  const result = await gradeTranslation(translating.sentence, answer);
  if (translating !== current || current.phase !== "answer") return;
  if (result) return finishTranslation(result);
  // Sin corrección automática: ve la referencia y se corrige él mismo
  translating.phase = "self";
  renderTranslate();
}

/* Corrige una respuesta. Devuelve el resultado, o null si hay que corregirse a
   uno mismo. translating.notice explica por qué no hubo IA. */
async function gradeTranslation(sentence, answer) {
  translating.notice = "";
  // 1. La misma respuesta a la misma frase ya se corrigió: vale aquella corrección
  const key = answerKey(sentence.id, answer);
  const before = translationLog.findLast((entry) => entry.answerKey === key && ["ai", "local"].includes(entry.source) && !entry.contested);
  if (before) return { ...before.result, cached: true };
  // 2. Coincide con la traducción de referencia: no hace falta preguntar a la IA
  if (matchesReference(answer, sentence, STUDY_CONFIG.translate)) return localResult(sentence, "local", "correct");
  // 3. La IA (función grade-translation). Si no está disponible no se bloquea al
  //    estudiante: se le explica por qué y se corrige él mismo con la referencia.
  const unavailable = aiUnavailable();
  if (unavailable) { translating.notice = unavailable; return null; }
  try {
    return await requestGrade(sentence, answer);
  } catch (error) {
    translating.notice = error.message;
    return null;
  }
}

/* Por qué no se puede preguntar a la IA ahora mismo ("" si se puede) */
function aiUnavailable() {
  if (!sb || !sync.user) return t("Inicia sesión para que la IA corrija tus traducciones. Mientras tanto, compárala tú con la referencia.");
  if (!navigator.onLine) return t("Sin conexión: compárala tú con la traducción de referencia.");
  return "";
}

/* Mensaje claro para cada fallo de la función */
function gradingMessage(code, limit) {
  const messages = {
    unauthorized: t("Inicia sesión para que la IA corrija tus traducciones. Mientras tanto, compárala tú con la referencia."),
    limit: t("Has llegado al límite de hoy ({n} correcciones de la IA). Puedes seguir practicando y corregirte tú.", { n: limit }),
    busy: t("Hoy ha habido demasiados intentos fallidos con la IA. Puedes seguir practicando y corregirte tú."),
    invalid: t("La IA no consiguió corregir esta respuesta. No se ha descontado de tu límite; compárala tú con la referencia."),
    quota: t("La IA ha agotado su cuota por ahora. Puedes seguir practicando y corregirte tú."),
    not_configured: t("La corrección con IA aún no está configurada. Compárala tú con la referencia.")
  };
  return messages[code] || t("La IA no pudo corregir la respuesta. Compárala tú con la referencia.");
}

/* La llamada a la función de Supabase, aparte para poder imitarla en las pruebas */
function invokeGrade(body) {
  return sb.functions.invoke("grade-translation", { body });
}

/* Pide la corrección. A la función solo van la frase, sus unidades, la
   traducción de referencia, la respuesta y el idioma. Lanza un Error con el
   mensaje para el estudiante si no hay corrección. */
async function requestGrade(sentence, answer) {
  const seen = new Set();
  const units = sentence.tokens.map((token) => {
    // Cada palabra con contenido se valora una vez, en su primera aparición
    const content = trIsContent(token) && !!token.key && !seen.has(token.key);
    if (content) seen.add(token.key);
    return { surface: token.surface, lemma: token.lemma, reading: token.reading || "", content };
  });
  const requestId = newId();
  const { data, error } = await invokeGrade({
    sentenceId: sentence.id, ja: sentencePlain(sentence), units,
    reference: { en: sentence.en || "", es: sentence.es || "" }, answer, lang, requestId
  });
  if (error) {
    // Sin red, o la función no está desplegada todavía
    if (!error.context?.json) throw new Error(navigator.onLine ? gradingMessage("not_configured") : aiUnavailable());
    const info = await error.context.json().catch(() => ({}));
    throw new Error(gradingMessage(error.context.status === 404 ? "not_configured" : info.error, info.limit));
  }
  const result = data?.result;
  if (!result || !Array.isArray(result.words)) throw new Error(gradingMessage("invalid"));
  return {
    source: "ai", verdict: result.verdict, score: result.score, feedback: result.feedback || "",
    better: result.better || "", grammar_note: result.grammar_note || "",
    // Cada palabra valorada vuelve con su índice: de ahí sale su clave
    words: result.words.filter((word) => sentence.tokens[word.i]?.key).map((word) => ({
      lemma: sentence.tokens[word.i].lemma, key: sentence.tokens[word.i].key,
      understood: word.understood === true ? true : word.understood === false ? false : null, note: word.note || ""
    })),
    requestId: data.requestId || requestId, model: data.model || "", promptVersion: data.promptVersion || ""
  };
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

/* Una ficha por palabra valorada: entendida, no entendida o sin poder saberlo.
   Lleva icono y texto, para no depender solo del color; al tocarla se ve su nota. */
function wordChipsHTML(result, lookups) {
  const KIND = {
    yes: ["✓", t("entendida"), "yes"], no: ["✗", t("no entendida"), "no"],
    unclear: ["?", t("no se puede saber"), "unclear"], looked: ["👁", t("consultada"), "looked"]
  };
  return result.words.map((word, index) => {
    const kind = word.understood === false ? "no" : lookups.has(word.key) ? "looked" : word.understood === true ? "yes" : "unclear";
    const [icon, label, cls] = KIND[kind];
    return `<button class="tr-chip tr-chip-${cls}" type="button" data-tr-chip="${index}"
      aria-label="${escapeHTML(word.lemma)}: ${label}"><span aria-hidden="true">${icon}</span>
      <span lang="ja">${escapeHTML(word.lemma)}</span><small>${label}</small></button>`;
  }).join("");
}

/* Al tocar una ficha: la lectura y el significado de la palabra y la nota de la corrección */
function showWordChip(index) {
  const word = translating.result.words[index];
  const token = translating.sentence.tokens.find((item) => item.key === word.key);
  $("trChipNote").innerHTML = `${token ? tokenGlossHTML(token) : escapeHTML(word.lemma)}${
    word.note ? ` · <strong>${escapeHTML(word.note)}</strong>` : ""}`;
}

function renderTranslateResult() {
  const { sentence, answer, result } = translating;
  const [icon, label, cls] = VERDICTS()[result.verdict];
  const origin = {
    unknown: t("No la sabías: esta es la traducción."),
    self: t("Corregida por ti."),
    local: t("Coincide con la traducción de referencia."),
    contested: t("No estabas de acuerdo: cuenta como entendida, con menos peso. Hemos anotado el caso para revisarlo."),
    cache: t("Ya habías dado esta respuesta: es la corrección de entonces.")
  }[result.cached ? "cache" : result.source] || "";
  const canContest = result.source === "ai" && result.verdict !== "correct";
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
          result.source === "ai" ? ` · <span class="tr-score">${t("{score} de 100", { score: result.score })}</span>` : ""}</p>
        ${origin ? `<p class="helper tr-origin">${origin}</p>` : ""}
        ${result.feedback ? `<p class="tr-feedback">${escapeHTML(result.feedback)}</p>` : ""}
        <dl class="tr-compare">
          ${answer ? `<dt>${t("Tu traducción")}</dt><dd>${escapeHTML(answer)}</dd>` : ""}
          <dt>${t("Traducción de referencia")}</dt><dd>${escapeHTML(referenceOf(sentence))}</dd>
          ${result.better ? `<dt>${t("Una traducción natural")}</dt><dd>${escapeHTML(result.better)}</dd>` : ""}
          ${result.grammar_note ? `<dt>${t("Gramática")}</dt><dd>${escapeHTML(result.grammar_note)}</dd>` : ""}
        </dl>
        <p class="tr-compare-label">${t("Palabra por palabra")}</p>
        <div class="tr-chips">${wordChipsHTML(result, translating.lookups)}</div>
        <p id="trChipNote" class="helper sent-gloss">${t("Toca una palabra para ver su nota.")}</p>
      </div>
      <div class="row-actions">
        ${canContest ? `<button id="trContestBtn" class="button button-quiet" type="button">${t("No estoy de acuerdo")}</button>` : ""}
        ${"speechSynthesis" in window ? `<button id="trSpeakBtn" class="button button-quiet speak-btn" type="button">🔊 ${t("Escuchar")}</button>` : ""}
        <button id="trEndBtn" class="button button-outline" type="button">${t("Terminar")}</button>
        <button id="trNextBtn" class="button button-primary" type="button">${t("Siguiente")} →</button>
      </div>
    </div>`;
  if ($("trSpeakBtn")) $("trSpeakBtn").onclick = () => speak(sentencePlain(sentence));
  if ($("trContestBtn")) $("trContestBtn").onclick = contestTranslation;
  $("trEndBtn").onclick = endTranslateSession;
  $("trNextBtn").onclick = nextTranslation;
  $("trNextBtn").focus();
}

/* "No estoy de acuerdo": la corrección de la IA se deshace, la frase cuenta
   como entendida con menos peso (credit.contested) y el caso queda anotado
   para que un administrador lo revise y se pueda mejorar el prompt. */
async function contestTranslation() {
  const { sentence, answer, result, before, session } = translating;
  $("trContestBtn").disabled = true;
  // 1. El progreso vuelve a como estaba antes de la corrección
  const restore = async (store, map, list) => {
    const back = list.filter(([, rec]) => rec).map(([, rec]) => rec), gone = list.filter(([, rec]) => !rec).map(([id]) => id);
    back.forEach((rec) => map.set(rec.id, rec));
    gone.forEach((id) => map.delete(id));
    await putRecords(store, back, gone);
  };
  await restore("userWords", userWords, before.words);
  await restore("userKanji", userKanji, before.kanji);
  for (const key of translating.summary.failed) session.review.delete(key);
  // 2. Se vuelve a aplicar como entendida; el día no cuenta otra frase, solo pasa a "bien"
  const contested = { ...localResult(sentence, "contested", "correct"), requestId: result.requestId, original: result };
  const wasGood = result.verdict === "mostly";
  translating.summary = await saveTranslationProgress(contested, sentence, translating.lookups, false);
  if (!wasGood) { meta.days[today()].tc = (meta.days[today()].tc || 0) + 1; await saveMeta(); }
  for (const key of translating.summary.promoted) session.understood.add(key);
  session.scores[session.scores.length - 1] = contested.score;
  // 3. El registro de la frase y el reporte
  const entry = translationLog[translationLog.length - 1];
  Object.assign(entry, { source: "contested", verdict: "correct", score: contested.score, result: contested, contested: true });
  await putRecords("translations", [entry]);
  reportGrade(sentence, answer, result);
  translating.result = contested;
  renderTranslate();
}

/* Reporte de una corrección discutida (tabla text_reports, kind "grade"). Nunca bloquea. */
async function reportGrade(sentence, answer, result) {
  if (!sb || !sync.user) return;
  const { error } = await sb.from("text_reports").insert({
    text_id: sentence.sourceId || null, request_id: result.requestId || null,
    prompt_version: result.promptVersion || null, model: result.model || null,
    kind: "grade", category: "contested", comment: "",
    details: {
      sentenceId: sentence.id, ja: sentencePlain(sentence), reference: { en: sentence.en || "", es: sentence.es || "" },
      answer, lang, verdict: result.verdict, score: result.score, feedback: result.feedback, better: result.better,
      words: result.words.map((word) => ({ lemma: word.lemma, understood: word.understood, note: word.note }))
    },
    user_id: sync.user.id
  });
  if (error) console.error("No se pudo guardar el reporte:", error);
}

/* Resumen de la tanda: frases, nota media, palabras entendidas y por repasar */
function endTranslateSession() {
  const session = translateSession();
  const average = session.scores.length ? Math.round(session.scores.reduce((sum, score) => sum + score, 0) / session.scores.length) : 0;
  const list = (keys) => [...keys].map((key) => {
    const entry = wordEntry(key);
    return `<li><strong lang="ja">${escapeHTML(key.split("|")[0])}</strong><span>${entry ? escapeHTML(gloss(entry, 2)) : ""}</span></li>`;
  }).join("");
  translating = null;
  translateTally = null;
  $("translateArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>${t("Tanda terminada")}</h3>
      <p>${session.done
        ? t("Has traducido {n} · nota media {average} de 100.", { n: plural(session.done, "frase", "frases"), average })
        : t("No has traducido ninguna frase.")}</p>
      ${session.understood.size ? `<p class="tr-compare-label">${t("Palabras cuyo significado ya das por sabido")}</p>
        <ul class="missed-list">${list(session.understood)}</ul>` : ""}
      ${session.review.size ? `<p class="tr-compare-label">${t("Palabras para repasar")}</p>
        <ul class="missed-list">${list(session.review)}</ul>` : ""}
      <div class="row-actions">
        <button id="trAgainBtn" class="button button-primary" type="button">${t("Seguir traduciendo")}</button>
        <button class="button button-outline" data-go="progress" type="button">${t("Ver progreso")}</button>
      </div>
    </div>`;
  $("trAgainBtn").onclick = () => renderTranslate();
  renderAll();
  syncNow();
}

/* Aplica al progreso lo que devuelve applyTranslationResult. Solo guarda: las
   reglas están todas en esa función. Devuelve el resumen de lo que cambió. */
async function saveTranslationProgress(result, sentence, lookups, countDay = true) {
  const change = applyTranslationResult(result, sentence, {
    wordOf: (key) => userWords.get(key) || null,
    kanjiOf: (c) => userKanji.get(c) || null,
    readingOf: (key) => wordEntry(key)?.r || "",
    wordsWith: (c) => [...userWords.values()].filter((rec) => rec.lemma.includes(c)),
    // ¿Esta frase ya le sumó a esa palabra? (hacen falta frases distintas)
    credited: (key) => translationLog.some((entry) => entry.sentenceId === sentence.id &&
      entry.result?.words?.some((word) => word.key === key && word.understood === true) && !entry.lookups?.includes(key)),
    lookups, now: Date.now(), today: today()
  }, STUDY_CONFIG.translate);

  const now = Date.now();
  for (const rec of change.words) { rec.updatedAt = now; userWords.set(rec.id, rec); }
  for (const rec of change.kanji) { rec.updatedAt = now; userKanji.set(rec.id, rec); }
  await putRecords("userWords", change.words);
  await putRecords("userKanji", change.kanji);
  if (countDay) {
    const day = meta.days[today()] ??= { r: 0, c: 0, n: 0 };
    day.t = (day.t || 0) + change.day.t;
    day.tc = (day.tc || 0) + change.day.tc;
    await saveMeta();
  }
  scheduleSync();
  return change.summary;
}

/* Guarda la frase respondida y enseña la corrección */
async function finishTranslation(result) {
  const { sentence, answer, session } = translating;
  // Por si el estudiante no está de acuerdo: cómo estaba su progreso antes de esta corrección
  translating.before = {
    words: result.words.map((word) => [word.key, userWords.get(word.key) ? { ...userWords.get(word.key) } : null]),
    kanji: [...new Set(result.words.flatMap((word) => kanjiOf(word.key.split("|")[0])))]
      .map((c) => [c, userKanji.get(c) ? { ...userKanji.get(c) } : null])
  };
  translating.summary = await saveTranslationProgress(result, sentence, translating.lookups);
  for (const key of translating.summary.promoted) session.understood.add(key);
  for (const key of translating.summary.failed) session.review.add(key);
  translating.result = result;
  translating.phase = "result";
  session.done++;
  session.scores.push(result.score);
  const entry = {
    id: newId(), sentenceId: sentence.id, textId: sentence.sourceId || "", at: Date.now(),
    answer, answerKey: answer ? answerKey(sentence.id, answer) : "",
    source: result.source, verdict: result.verdict, score: result.score, result: { ...result, cached: undefined },
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
    const chip = event.target.closest("[data-tr-chip]");
    if (chip && translating.phase === "result") return showWordChip(Number(chip.dataset.trChip));
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
