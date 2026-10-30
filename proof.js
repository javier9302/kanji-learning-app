/* =========================================
   KANJI LEARNING APP - proof.js
   Demostrar los kanjis de un nivel: una prueba, nivel a nivel desde N5, de
   los kanjis que ya ha visto en sus palabras (reglas en kanji-core.js,
   sección 5). De cada kanji: su significado (entre 4) y cómo suena en una
   palabra que conoce (escribirlo). Acertar las dos lo deja demostrado
   (userKanji[c].proofAt) y anota su lectura; un nivel está completo cuando
   todos sus kanjis lo están. Se abre desde Hoy y desde Mis palabras → Kanjis.
   Se carga después de kanji-table.js (usa currentKanjiStates).
   ========================================= */

let proof = null; // { level, questions, index, phase: "meaning" | "reading" | "result", answer, results: [] }

/* Demostrado: con la prueba, o ya sabía su significado y acertó alguna de sus lecturas en su casilla */
const kanjiProven = (c) => {
  const rec = userKanji.get(c);
  return !!rec && (!!rec.proofAt || !!rec.knowsMeaning && Object.values(rec.readings || {}).some((entry) => entry.ok > 0));
};

/* Cómo va cada nivel, con lo que ya está cargado (necesita el banco entero y kanji-info.js) */
function proofStatus() {
  const { states } = currentKanjiStates();
  const byLevel = kanjiByLevel();
  const seen = (c) => (states.get(c)?.state || "unknown") !== "unknown";
  const rows = proofLevels((level) => byLevel[level], seen, kanjiProven);
  // Dentro de cada nivel, primero los de las palabras que mejor conoce (más palabras conocidas con él)
  for (const row of rows) row.pending.sort((a, b) => (states.get(b)?.words.length || 0) - (states.get(a)?.words.length || 0));
  return { rows, states, next: nextProofLevel(rows) };
}

/* La palabra que conoce con ese kanji y cómo suena allí: la más frecuente que se pueda
   repartir, mejor una de varios caracteres (日 sola no da contexto: 毎日, 日曜日 sí) */
function proofWord(c, states) {
  const rank = (id) => BANK.frequency[id] || 1e6;
  const alone = (id) => [...id.split("|")[0]].length === 1;
  for (const id of [...(states.get(c)?.words || [])].sort((a, b) => alone(a) - alone(b) || rank(a) - rank(b))) {
    const entry = BANK.words.get(id);
    const boxes = entry && readingBoxes(wordSounds(entry.w, entry.r, sentenceTagsOf(id),
      (k) => kanjiVariants(BANK.kanji.get(k) || BANK.kanjiInfo.get(k))), kanjiReadingsOfWord(id)) || [];
    const index = boxes.findIndex((item) => item.kanji === c && item.reading);
    // at: en qué carácter de la palabra está (日曜日 lleva 日 dos veces, y suena distinto)
    const at = boxes.slice(0, index).reduce((sum, item) => sum + [...item.text].length, 0);
    if (index >= 0) return { id, w: entry.w, r: entry.r, sound: boxes[index].sound, reading: boxes[index].reading, at };
    // Una palabra de un solo kanji (山 やま): suena como la palabra entera
    if (entry && entry.w === c) return { id, w: entry.w, r: entry.r, sound: entry.r, reading: kanjiReadingsOfWord(id)[0]?.[1] || entry.r, at: 0 };
  }
  return null;
}

async function startProof(level) {
  await ensureStudyBank();
  const { rows, states } = proofStatus();
  const row = rows.find((item) => item.level === level) || nextProofLevel(rows);
  if (!row) return;
  const meaning = (c) => { const kanji = BANK.kanji.get(c); return kanji ? meaningOf(kanji).slice(0, 2).join(", ") : ""; };
  const others = kanjiByLevel()[row.level].map(meaning);
  const questions = buildProof(row.pending, { meaning, word: (c) => proofWord(c, states), others: () => others }, STUDY_CONFIG.kanjiProof);
  proof = { level: row.level, questions, index: 0, phase: "meaning", answer: {}, results: [] };
  switchView("proof");
}

function renderProof() {
  const area = $("proofArea");
  if (!proof) {
    area.innerHTML = `<p class="message">${t("Calculando…")}</p>`;
    return startProof().then(() => { if (!proof) renderProofNothing(); });
  }
  if (!proof.questions.length) return renderProofNothing();
  if (proof.index >= proof.questions.length) return renderProofEnd();
  const question = proof.questions[proof.index];
  const head = `
    <div class="card-top">
      <span class="pill">${t("Demostrar {level}", { level: proof.level })}</span>
      <span class="card-progress">${proof.index + 1} / ${proof.questions.length}</span>
    </div>
    <div class="meter" aria-hidden="true"><div style="width:${(proof.index / proof.questions.length) * 100}%"></div></div>
    <div class="card-symbol" lang="ja">${escapeHTML(question.c)}</div>`;

  if (proof.phase === "meaning") {
    area.innerHTML = `<div class="card proof-card">${head}
      <p class="helper">${t("¿Qué significa?")}</p>
      <div class="proof-options">${question.options.map((option, i) =>
        `<button class="button button-outline" type="button" data-proof-choice="${i}">${escapeHTML(option)}</button>`).join("")}</div>
    </div>`;
    return;
  }
  // La palabra con el kanji preguntado marcado (subrayado: se imprime en blanco y negro)
  const wordHTML = [...question.word.w].map((ch, i) => i === question.word.at
    ? `<span class="proof-target">${escapeHTML(ch)}</span>` : escapeHTML(ch)).join("");
  if (proof.phase === "reading") {
    area.innerHTML = `<div class="card proof-card">${head}
      <p class="helper">${t("¿Cómo suena {kanji} en esta palabra?", { kanji: question.c })}</p>
      <p class="proof-word" lang="ja">${wordHTML}</p>
      <form id="proofForm" autocomplete="off">
        <input id="proofInput" class="reading-input" type="text" lang="ja" inputmode="text"
          placeholder="${t("Escribe cómo suena (hiragana)")}" autocapitalize="off" autocomplete="off" spellcheck="false">
        <button class="button button-primary" type="submit">${t("Comprobar")}</button>
      </form>
    </div>`;
    const input = $("proofInput");
    if (window.wanakana?.bind) window.wanakana.bind(input);
    input.focus();
    return;
  }
  const result = proof.results[proof.results.length - 1];
  area.innerHTML = `<div class="card proof-card">${head}
    <p class="message ${result.ok ? "correct" : "incorrect"}">${result.ok ? t("¡Demostrado!") : t("Este todavía no.")}</p>
    <ul class="proof-answers">
      <li class="${result.meaningOk ? "read-good" : "read-again"}">${t("Significado")}: <strong>${escapeHTML(question.meaning)}</strong></li>
      <li class="${result.readingOk ? "read-good" : "read-again"}">${t("En {word} ({reading}) suena", { word: question.word.w, reading: question.word.r })}
        <strong lang="ja">${escapeHTML(question.word.sound)}</strong></li>
    </ul>
    <button id="proofNextBtn" class="button button-primary" type="button">${t("Siguiente")}</button>
  </div>`;
  $("proofNextBtn").focus();
}

function renderProofNothing() {
  $("proofArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon" lang="ja">証</div>
      <h3>${t("No hay kanjis que demostrar ahora")}</h3>
      <p>${t("Se demuestran los kanjis que ya has visto en tus palabras. Lee textos y repasa palabras, y los nuevos saldrán aquí.")}</p>
      <button class="button button-primary" type="button" data-go="today">${t("Volver a Hoy")}</button>
    </div>`;
}

/* Guarda lo de una pregunta en el kanji: demostrado o no, y su lectura (como en su casilla) */
async function saveProofAnswer(question, result) {
  const rec = userKanji.get(question.c) || blankUserKanji(question.c);
  rec.readings ??= {};
  addReadingResult(rec.readings, question.word.reading, result.readingOk, today());
  if (result.ok) Object.assign(rec, { proofAt: Date.now(), knowsMeaning: true });
  else if (!result.meaningOk) rec.knowsMeaning = false;
  await saveUserKanji(rec);
}

async function renderProofEnd() {
  const good = proof.results.filter((result) => result.ok).length;
  meta.kanjiProof = { ...meta.kanjiProof, lastDay: today() };
  await saveMeta();
  const { rows } = proofStatus();
  const row = rows.find((item) => item.level === proof.level);
  const failed = proof.questions.filter((question, i) => !proof.results[i]?.ok);
  $("proofArea").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${row?.complete ? "★" : "✓"}</div>
      <h3>${row?.complete ? t("¡{level} completo!", { level: proof.level }) : t("Prueba terminada")}</h3>
      <p>${t("Has demostrado {good} de {total}.", { good, total: proof.questions.length })}
        ${row ? t("En {level} llevas {proven} de {all} kanjis demostrados.", { level: proof.level, proven: row.proven, all: row.total }) : ""}</p>
      ${failed.length ? `<p class="helper">${t("Para la próxima, repásalos en Repasar (contenido «Kanjis»):")}
        <span lang="ja">${escapeHTML(failed.map((question) => question.c).join("、"))}</span></p>` : ""}
      <div class="row-actions">
        ${rows.some((item) => item.pending.length) ? `<button id="proofAgainBtn" class="button button-outline" type="button">${t("Otra prueba")}</button>` : ""}
        <button class="button button-primary" type="button" data-go="today">${t("Volver a Hoy")}</button>
      </div>
    </div>`;
  if ($("proofAgainBtn")) $("proofAgainBtn").onclick = () => { proof = null; renderProof(); };
}

function bindProof() {
  $("proofArea").addEventListener("click", async (event) => {
    const choice = event.target.closest("[data-proof-choice]");
    if (choice && proof?.phase === "meaning") {
      proof.answer = { choice: proof.questions[proof.index].options[Number(choice.dataset.proofChoice)] };
      proof.phase = "reading";
      return renderProof();
    }
    if (event.target.id === "proofNextBtn") {
      proof.index++;
      proof.phase = "meaning";
      proof.answer = {};
      renderProof();
    }
  });
  $("proofArea").addEventListener("submit", async (event) => {
    if (event.target.id !== "proofForm" || proof?.phase !== "reading") return;
    event.preventDefault();
    const typed = normalizeReading($("proofInput").value);
    if (!typed) return;
    const question = proof.questions[proof.index];
    const result = gradeProof(question, { ...proof.answer, typed }, normalizeReading);
    proof.results.push(result);
    proof.phase = "result";
    await saveProofAnswer(question, result);
    renderProof();
  });
}
