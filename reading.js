/* =========================================
   KANJI LEARNING APP - reading.js
   Leer: perfil de lectura y palabras conocidas, evaluación inicial de nivel,
   elegir o crear un texto (el prompt de la IA), el lector y la evaluación
   tras la lectura. Se carga después de texts.js.
   ========================================= */

/* =========================================
   6. PERFIL DE LECTURA Y PALABRAS CONOCIDAS
   -----------------------------------------
   meta.reading = { level, assumed, placedAt }
     level    nivel de los textos que se le proponen
     assumed  hasta qué nivel JLPT se da el vocabulario por conocido
              ("" = ninguno). Evita guardar miles de filas pre_known.
   ========================================= */

/* ¿Se da por sabida? Dominada, repasada con la lectura acertada, o «por confirmar»
   con algo que lo apoye (reciente o vista varias veces sin consultarla):
   knownRecord, learning-core.js, sección 6 */
const isKnownWord = (rec, now = Date.now()) => knownRecord(rec, now, STUDY_CONFIG.preKnown);
const COVERAGE_TARGET = 90;   // % mínimo de palabras conocidas para proponer un texto
const HARD_RATIO = 0.15;      // palabras marcadas como no conocidas a partir de las que el texto es difícil
const PLACEMENT_SIZE = 20;
const PLACEMENT_PASS = 0.7;
const PLACEMENT_STOP = 5; // tantas seguidas sin saber terminan la prueba

/* Vocabulario de un nivel: las palabras del banco (bank/bank.js) */
const levelVocabulary = (level) => [...BANK.words.values()].filter((word) => word.level === level);

const assumedLevels = () => LEVELS.slice(0, LEVELS.indexOf(meta.reading.assumed) + 1);

function knownLemmas() {
  const known = new Set();
  for (const level of assumedLevels()) {
    for (const word of levelVocabulary(level)) known.add(word.w);
  }
  // Lo que el usuario ha demostrado (leyendo o estudiando) manda sobre lo supuesto
  const now = Date.now();
  for (const word of userWords.values()) {
    if (isKnownWord(word, now)) known.add(word.lemma);
    else known.delete(word.lemma);
  }
  return known;
}

/* Una palabra escrita solo en kana (これ, する, コーヒー) no está en las listas
   por nivel: se da por conocida mientras el usuario no la marque al leer. */
function isKnownKey(key, known) {
  const mine = userWords.get(key);
  if (mine) return isKnownWord(mine);
  const lemma = key.split("|")[0];
  return known.has(lemma) || !/\p{Script=Han}/u.test(lemma);
}

function textCoverage(text, known = knownLemmas()) {
  if (!text.total) return 100;
  let covered = 0;
  for (const [key, count] of Object.entries(text.lemmas)) {
    if (isKnownKey(key, known)) covered += count;
  }
  return Math.round((covered / text.total) * 100);
}

function blankUserWord(lemma, reading) {
  const now = Date.now();
  return {
    id: wordKey(lemma, reading), lemma: normalizeText(lemma), reading: normalizeText(reading),
    status: "unknown",
    canReadKanji: false, knowsMeaning: false, canWrite: false,
    seen: 0, lookups: 0, evalCorrect: 0, evalWrong: 0,
    firstSeen: now, lastSeen: now, updatedAt: now
  };
}

async function saveUserWord(word) {
  word.updatedAt = Date.now();
  userWords.set(word.id, word);
  await putRecords("userWords", [word]);
  scheduleSync();
}

/* =========================================
   7. EVALUACIÓN INICIAL DE NIVEL
   ========================================= */

let placement = null;

function renderOnboarding() {
  $("readArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML("appear")}
      <h3>${t("¿Cuánto japonés sabes ya?")}</h3>
      <p>${t("Si estás empezando de cero, empieza directamente. Si ya sabes algo, una prueba de {n} preguntas nos dice qué palabras dar por conocidas.", { n: PLACEMENT_SIZE })}</p>
      <button id="beginnerBtn" class="button button-primary" type="button">${t("Empiezo de cero")}</button>
      <p class="helper placement-levels">${t("Los niveles son los del examen oficial JLPT: de N5 (el más fácil) a N1.")}</p>
      <div class="inline-form placement-start">
        <select id="placementLevel" aria-label="${t("Nivel que crees tener")}">
          ${LEVELS.map((level) => `<option>${level}</option>`).join("")}
        </select>
        <button id="placementStartBtn" class="button button-outline" type="button">
          ${t("Hacer la prueba de nivel")}
        </button>
      </div>
    </div>`;
  $("placementStartBtn").onclick = () => startPlacement($("placementLevel").value);
  $("beginnerBtn").onclick = startAsBeginner;
}

/* Quien empieza de cero no hace la prueba (no sabría leer ni las opciones):
   nivel N5, nada dado por conocido, y a aprender sus primeras palabras */
async function startAsBeginner() {
  meta.reading = { level: "N5", assumed: "", placedAt: Date.now(), updatedAt: Date.now() };
  await saveMeta();
  scheduleSync();
  $("readLevel").textContent = "N5";
  $("readArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML("appear")}
      <h3>${t("¡Bienvenido! Empezamos por lo más básico")}</h3>
      <p>${t("Primero, las letras: el hiragana, una fila cada día. Y en Repasar aprenderás tus primeras palabras: te enseñamos cada una, con su lectura en rōmaji, y después te la preguntamos. Puedes ir haciendo las dos cosas a la vez.")}</p>
      <div class="row-actions">
        <button id="beginnerKanaBtn" class="button button-primary" type="button">${t("Aprender hiragana")}</button>
        <button id="beginnerGoBtn" class="button button-outline" type="button">${t("Aprender mis primeras palabras")}</button>
      </div>
    </div>`;
  $("beginnerGoBtn").onclick = () => { switchView("study"); startSession(); };
  $("beginnerKanaBtn").onclick = () => { switchView("kana"); startKana(); };
  $("beginnerKanaBtn").focus();
}

async function startPlacement(level) {
  const index = LEVELS.indexOf(level);
  await BANK.loadUpTo(level);
  const pool = (lv) => shuffle(levelVocabulary(lv)
    .filter((word) => !word.kana && /\p{Script=Han}/u.test(word.w))
    .map((word) => ({ lemma: word.w, reading: word.r, en: word.en, es: word.es })));
  const own = pool(level);
  const easier = index > 0 ? pool(LEVELS[index - 1]) : [];
  const fromEasier = easier.length ? Math.round(PLACEMENT_SIZE * 0.4) : 0;

  const questions = [
    ...own.slice(0, PLACEMENT_SIZE - fromEasier).map((word) => ({ word, group: "own", pool: own })),
    ...easier.slice(0, fromEasier).map((word) => ({ word, group: "easier", pool: easier }))
  ];
  placement = { level, questions: shuffle(questions), index: 0, results: [] };
  renderPlacement();
}

const wordGloss = (word) => (lang === "es" && word.es.length ? word.es : word.en).slice(0, 2).join(", ");

function renderPlacement() {
  const { questions, index } = placement;
  const question = questions[index];
  const wrong = shuffle(question.pool.filter((other) =>
    other.reading !== question.word.reading && wordGloss(other) !== wordGloss(question.word))).slice(0, 3);
  const options = shuffle([question.word, ...wrong]);

  $("readArea").innerHTML = `
    <div class="card">
      <div class="card-top">
        <span class="pill">${t("Prueba de nivel")}</span>
        <span class="card-progress">${index + 1} / ${questions.length}</span>
      </div>
      <div class="meter" aria-hidden="true">
        <div style="width:${(index / questions.length) * 100}%"></div>
      </div>
      <div class="card-symbol word" lang="ja">${escapeHTML(question.word.lemma)}</div>
      <p class="helper">${t("¿Cómo se lee y qué significa?")}</p>
      <div class="choices">
        ${options.map((option, i) => `
          <button class="button button-outline choice" type="button" data-choice="${i}">
            <span lang="ja">${escapeHTML(option.reading)}</span>${romajiHTML(option.reading)} · ${escapeHTML(wordGloss(option))}
          </button>`).join("")}
        <button class="button button-quiet choice" type="button" data-choice="-1">${t("No la conozco")}</button>
      </div>
      <p id="placementSay" class="sr-only" role="status"></p>
    </div>`;

  $("readArea").querySelectorAll("[data-choice]").forEach((button) => {
    button.onclick = () => {
      const picked = options[Number(button.dataset.choice)];
      const correct = picked === question.word;
      $("readArea").querySelectorAll("[data-choice]").forEach((b) => {
        b.disabled = true;
        if (options[Number(b.dataset.choice)] === question.word) b.classList.add("choice-right");
      });
      if (!correct) button.classList.add("choice-wrong");
      $("placementSay").textContent = correct ? t("¡Correcto!")
        : t("Era {reading}: {meaning}", { reading: question.word.reading, meaning: wordGloss(question.word) });
      placement.results.push({ ...question, correct });
      // Cinco seguidas sin saberlas: el nivel ya se ve, no hace falta pasar por las 20
      const lastFive = placement.results.slice(-PLACEMENT_STOP);
      const enough = lastFive.length === PLACEMENT_STOP && lastFive.every((result) => !result.correct);
      setTimeout(() => {
        if (!placement) return;
        placement.index++;
        if (placement.index < questions.length && !enough) renderPlacement();
        else finishPlacement();
      }, correct ? 450 : 1100);
    };
  });
}

async function finishPlacement() {
  const { level, results } = placement;
  const rate = (group) => {
    const answers = results.filter((r) => r.group === group);
    return answers.length ? answers.filter((r) => r.correct).length / answers.length : null;
  };
  const index = LEVELS.indexOf(level);
  const own = rate("own"), easier = rate("easier");

  // Aprueba su nivel: se da por conocido. Si no, se baja un escalón.
  let assumed, readLevel = level;
  if (own >= PLACEMENT_PASS) assumed = level;
  else {
    readLevel = LEVELS[Math.max(0, index - 1)];
    assumed = easier !== null && easier >= PLACEMENT_PASS ? LEVELS[index - 1] : LEVELS[index - 2] || "";
  }
  meta.reading = { level: readLevel, assumed, placedAt: Date.now(), updatedAt: Date.now() };
  await saveMeta();
  scheduleSync();

  // Las acertadas cuentan ya como sabidas. Las que no sabía no se apuntan: no son
  // fallos (aún no las ha estudiado) y saldrán como nuevas en Repasar
  const known = results.filter((result) => result.correct);
  const fresh = [];
  for (const { word } of known) {
    const mine = blankUserWord(word.lemma, word.reading);
    Object.assign(mine, { status: "mastered", canReadKanji: true, knowsMeaning: true, evalCorrect: 1 });
    // Acertarla una vez no basta: entra en el repaso para comprobarlo dentro de unos días
    giveCheckedCard(mine, STUDY_CONFIG.checkedIntervalDays.placement);
    userWords.set(mine.id, mine);
    if (!words.has(mine.id)) {
      const entry = { id: mine.id, lemma: mine.lemma, reading: mine.reading, meanings: word.en,
        meaningsEs: word.es, pos: "", source: "jmdict", updatedAt: Date.now() };
      words.set(entry.id, entry);
      fresh.push(entry);
    }
  }
  await putRecords("userWords", known.map(({ word }) => userWords.get(wordKey(word.lemma, word.reading))));
  await putRecords("words", fresh);

  const right = results.filter((r) => r.correct).length;
  placement = null;
  $("readArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML(right >= results.length / 2 ? "celebrate" : "idle")}
      <h3>${t("Tu nivel de lectura: {level}", { level: readLevel })}</h3>
      <p>${t("Acertaste {right} de {total}.", { right, total: results.length })} ${
        assumed
          ? t("Daremos por conocido el vocabulario hasta {level}; los textos irán afinándolo.", { level: assumed })
          : t("Empezaremos desde lo más básico; los textos irán marcando lo que ya sabes.")}</p>
      <button id="placementDoneBtn" class="button button-primary" type="button">${
        assumed ? t("Empezar a leer") : t("Aprender mis primeras palabras")}</button>
    </div>`;
  // Sin nada dado por conocido, un texto aún sería ilegible: primero, palabras
  $("placementDoneBtn").onclick = assumed ? renderRead : () => { switchView("study"); startSession(); };
  $("readLevel").textContent = readLevel;
}

/* =========================================
   8. ELEGIR O CREAR UN TEXTO
   ========================================= */

const TEXT_TYPES = [
  ["short story", "Historia corta"], ["dialogue", "Diálogo"], ["diary entry", "Diario"],
  ["message or email", "Mensaje o correo"], ["description", "Descripción"],
  ["simple news article", "Noticia sencilla"], ["instructions", "Instrucciones"], ["opinion", "Opinión"]
];
const TEXT_TOPICS = [
  ["daily life", "Vida diaria"], ["food", "Comida"], ["travel", "Viajes"], ["work", "Trabajo"],
  ["school", "Escuela"], ["family", "Familia"], ["shopping", "Compras"], ["free time", "Tiempo libre"],
  ["health", "Salud"], ["news and society", "Actualidad"], ["Japanese culture", "Cultura japonesa"],
  ["technology", "Tecnología"], ["nature and seasons", "Naturaleza y estaciones"]
];
const CAST_SIZE = 8; // personajes de renderPromptSeg (CAST)
const TEXT_LENGTHS = [[50, "Corto (unas 50 palabras)"], [100, "Medio (unas 100 palabras)"], [150, "Largo (unas 150 palabras)"]];
const PROMPT_WORD_LIMIT = 1500;

const MAX_SKIPS = 3; // textos que se pueden saltar seguidos antes de tener que terminar uno

/* Texto que el usuario tiene a medias: uno suyo sin leer. Mientras exista no
   puede crear otro; así nunca hay más de un texto incompleto. */
const pendingOwnText = () => texts.find((text) =>
  isOwnText(text) && !text.local && !text.readAt && !text.discardedAt && !text.hiddenAt);

/* Saltos seguidos: textos descartados desde la última lectura terminada */
async function skipsUsed() {
  const sessions = (await getAll("sessions")).sort((a, b) => b.finishedAt - a.finishedAt);
  let used = 0;
  while (used < sessions.length && sessions[used].discarded) used++;
  return used;
}

/* Saltar un texto: se quita de la biblioteca del usuario y cuenta como salto */
async function skipText(text, clicks = new Map(), startedAt = Date.now()) {
  const record = {
    id: newId(), textId: text.id, startedAt, finishedAt: Date.now(), discarded: true,
    clicks: Object.fromEntries(clicks)
  };
  await putRecords("sessions", [record]);
  await deleteText(text.id);
  return record;
}

/* Texto sin leer con suficientes palabras conocidas; primero el más fácil */
/* El texto que se propone: de los que conoce al menos el 90 %, el que tiene más
   palabras que le toca repasar (leerlo cuenta como repaso) y, a igualdad, el más fácil */
function nextText() {
  const known = knownLemmas();
  const due = dueWordIds();
  const dueIn = (text) => Object.keys(text.lemmas).filter((key) => due.has(key)).length;
  return texts
    .filter((text) => !text.readAt && !text.discardedAt && !text.hiddenAt)
    .map((text) => ({ text, coverage: textCoverage(text, known), due: dueIn(text) }))
    .filter((entry) => entry.coverage >= COVERAGE_TARGET)
    .sort((a, b) => b.due - a.due || b.coverage - a.coverage || a.text.createdAt - b.text.createdAt)[0];
}

/* Las palabras que le toca repasar hoy (estudiadas, con la fecha de hoy o atrasada) */
const dueWordIds = (day = today()) => new Set([...userWords.values()]
  .filter((rec) => rec.studied && rec.nextReview && rec.nextReview <= day).map((rec) => rec.id));

/* Las que se le piden a la IA en el texto: las que tocan o tocarán pronto y, por
   cada kanji que toca, una palabra que conoce con él (story-core.js).
   clean(rec) -> { label } o { drop }: se eligen entre las palabras ya limpias,
   así una que no vale (下手|したて) no ocupa el sitio de otra que toca */
function currentStoryTargets(clean) {
  const day = today();
  const known = (rec) => rec.status === "mastered" || rec.studied && rec.canReadKanji;
  const usable = [...userWords.values()].map((rec) => [rec, clean(rec)]).filter(([, word]) => !word.drop);
  const words = usable.map(([rec, word]) => ({ id: rec.id, label: word.label, nextReview: rec.nextReview, studied: rec.studied }));
  const kanjiDue = [...userKanji.values()].filter((rec) => rec.studied && rec.nextReview <= day).map((rec) => {
    const found = usable.find(([w]) => known(w) && (w.lemma || "").includes(rec.id));
    return { c: rec.id, nextReview: rec.nextReview, word: found && { id: found[0].id, label: found[1].label } };
  });
  return storyTargets(words, kanjiDue, day, STUDY_CONFIG.stories);
}

/* Lo que toca de tipo, tema y personajes, según los últimos textos que escribió la IA para él */
function currentVariety() {
  const history = texts.filter((text) => text.source === "api").sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, STUDY_CONFIG.stories.recentTexts).map((text) => ({ type: text.type, topic: text.topic, cast: text.cast || [] }));
  return nextVariety(history, TEXT_TYPES.map(([value]) => value), TEXT_TOPICS.map(([value]) => value), CAST_SIZE);
}

/* Lo que necesita promptWord (story-core.js, sección 4) para limpiar una
   palabra: kuromoji (si no se puede cargar, sin él: solo se aplican las reglas
   que no lo necesitan), si es del banco, si tiene significado y cómo se le
   escribe a la IA. */
async function promptTools() {
  const tokenizer = await loadTokenizer().catch(() => null);
  const inBank = (lemma, reading) => (BANK.byWriting.get(lemma) || []).some((word) => !reading || word.r === reading);
  return {
    tokens: tokenizer && ((text) => tokenizer.tokenize(text).map((token) => ({
      surface: token.surface_form, pos: token.pos, detail: token.pos_detail_1, base: token.basic_form }))),
    inBank,
    // Sin significado solo si se sabe seguro: su ficha propia está vacía, o la escritura es del
    // banco y esa lectura no (下手|したて). Sin ficha en este dispositivo (palabras leídas en
    // otro, que llegan solo como progreso) no se puede saber: decide kuromoji.
    // Sin lectura (venía conjugada: 来て -> 来る) vale la forma de diccionario.
    hasMeaning: (lemma, reading) => {
      if (!reading) return true;
      const id = wordKey(lemma, reading);
      const own = words.get(id);
      if (own) return [...(own.meanings || []), ...(own.meaningsEs || [])].length > 0;
      if (BANK.words.has(id)) return true;
      const senses = BANK.byWriting.get(lemma);
      return !senses || senses.some((word) => (word.alt || []).includes(reading));
    },
    // Cómo se le escribe cada palabra a la IA:
    // - si casi siempre va en kana, en kana (有る -> ある; 居る|いる -> いる, no おる);
    // - un kanji solo con lectura de adjetivo, con su okurigana (堅|かたい -> 堅い);
    // - si la escritura tiene varias lecturas, con la que el estudiante conoce: 角(かど).
    label: (lemma, reading) => {
      const senses = BANK.byWriting.get(lemma) || [];
      if (senses.length && senses.every((word) => word.kana)) return (senses.find((word) => word.r === reading) || senses[0]).r;
      let writing = lemma;
      if (tokenizer && [...lemma].length === 1 && /い$/.test(reading || senses[0]?.r || "")) {
        const pieces = tokenizer.tokenize(`${lemma}い`);
        if (pieces.length === 1 && pieces[0].pos === "形容詞") writing = `${lemma}い`;
      }
      return senses.length > 1 && reading ? `${writing}(${reading})` : writing;
    }
  };
}

/* Escenas gastadas (story-core.js, sección 5): sustantivos de cosas, sitios o
   animales que salen en muchos de los últimos textos. No cuentan los muy
   comunes, los de posición (中, 上, 前: dicen dónde, no qué) ni los que se le
   piden usar (repasar o aprendiendo). */
async function currentScenes(tools, wanted) {
  const sessions = await getAll("sessions").catch(() => []);
  const lemmasOf = (id) => texts.find((text) => text.id === id)?.lemmas || null;
  const place = /^(上|下|中|前|後|後ろ|外|内|横|隣|側|間|奥|周り|近く|向こう|先|辺り)$/;
  const skip = (key) => {
    const [writing] = key.split("|");
    if (wanted.has(writing) || place.test(writing) || (BANK.frequency[key] || Infinity) <= STUDY_CONFIG.stories.scenes.commonRank) return true;
    if (!tools.tokens) return false;
    const pieces = tools.tokens(writing);
    return !(pieces.length === 1 && pieces[0].pos === "名詞" && ["一般", "固有名詞"].includes(pieces[0].detail));
  };
  return overusedScenes(sessions, lemmasOf, STUDY_CONFIG.stories.scenes, skip);
}

/* Datos del usuario que necesita el prompt. Con niveles altos la lista entera
   no cabe: se manda el nivel dado por conocido y solo lo confirmado por el usuario.
   Las tres listas pasan por cleanWordLists (sin formas conjugadas, trozos ni
   grafías raras, y cada palabra en una sola lista). Es asíncrona: espera a
   kuromoji y a las sesiones de lectura. */
async function promptParams({ type, topic, length, cast, avoid = [] }) {
  const tools = await promptTools();
  const item = (rec) => ({ lemma: rec.lemma, reading: rec.reading, status: rec.status });
  const readingOf = new Map([...userWords.values()].map((w) => [w.lemma, w.reading]));
  const statusOf = new Map([...userWords.values()].map((w) => [w.lemma, w.status]));
  let known = [...knownLemmas()].map((lemma) =>
    ({ lemma, reading: readingOf.get(lemma) || BANK.byWriting.get(lemma)?.[0].r, status: statusOf.get(lemma) }));
  let assumed = [];
  if (known.length > PROMPT_WORD_LIMIT) {
    known = [...userWords.values()].filter((w) => isKnownWord(w)).map(item).slice(0, PROMPT_WORD_LIMIT);
    assumed = assumedLevels();
  }
  // Palabras solo en kana: no se estudian como tarjeta, así que se aprenden
  // leyendo. Van por frecuencia, primero las que menos han salido en sus lecturas.
  const timesSeen = (kana) => userWords.get(wordKey(kana, kana))?.seen || 0;
  const prefer = BANK.kanaByFrequency
    .map((kana, index) => ({ kana, index, seen: timesSeen(kana) }))
    .sort((a, b) => a.seen - b.seen || a.index - b.index)
    .slice(0, STUDY_CONFIG.kanaWordsInPrompt).map((entry) => entry.kana);

  const lists = cleanWordLists({
    targets: currentStoryTargets((rec) => promptWord(item(rec), tools))
      .map((target) => ({ id: target.id, ...item(userWords.get(target.id)) })),
    // Las que está aprendiendo; primero las que buscó en el diccionario, para que salgan en sus textos
    learning: promptLearning([...userWords.values()], 60).map(item),
    known
  }, tools);
  const wanted = new Set([...lists.targets.map((target) => target.label), ...lists.learning]);
  return {
    level: meta.reading.level, type, topic, length, prefer,
    // Las que toca repasar: la IA las usa y luego se comprueba cuáles salieron (storyTargets)
    targets: lists.targets.map((target) => target.label), targetIds: lists.targets.map((target) => target.id),
    cast: cast ?? currentVariety().cast, avoid,
    known: lists.known, assumedLevels: assumed, learning: lists.learning,
    // Las estructuras de su hoja de ruta (premium): { ja, en }
    grammar: roadmapGrammar(),
    scenes: await currentScenes(tools, wanted)
  };
}

/* Versión del prompt: súbela cada vez que cambies su texto. Se guarda con cada
   generación para saber con qué versión salió cada error. */
const PROMPT_VERSION = "2026-10-08.1";

/* El prompt del formato antiguo (con tokens y diccionario) ya no lo usa la app;
   la función generate-text conserva su copia para versiones anteriores de la app. */

/* Versión del prompt segmentado (formato nuevo): súbela al cambiar su texto. */
const SEGMENTED_VERSION = "2026-11-02.1-seg";

/* Prompt del formato nuevo: la IA solo escribe el texto separado en unidades
   con "|" y la traducción de cada oración. Lemas, lecturas y significados los
   pone la app (kuromoji + diccionario). IMPORTANTE: la función generate-text
   lleva una copia de esta función; si cambias una, cambia la otra. */
function renderPromptSeg({ level, type, topic, length, known, assumedLevels, learning, prefer = [], targets = [], cast = [], avoid = [], grammar = [], scenes = [] }) {
  // Personajes que se repiten de un texto a otro, cada uno con su carácter; la app elige dos (story-core.js, nextVariety)
  const CAST = [
    "ゆき (Yuki), a cheerful university student who always wants to try something new",
    "たなかさん (Mr Tanaka), a calm office worker who notices small details nobody else sees",
    "はると (Haruto), a curious ten-year-old boy who asks too many questions",
    "さとうさん (Mrs Sato), a retired neighbour who loves her garden and local gossip",
    "けん (Ken), a clumsy but very kind cook at a small restaurant",
    "エマ (Emma), an exchange student from abroad, often surprised by Japanese customs",
    "もりせんせい (Dr Mori), a busy doctor with a dry sense of humour",
    "あおい (Aoi), an ambitious high-school student in the music club"
  ];
  const characters = cast.map((i) => CAST[i]).filter(Boolean);
  const fresh = Math.round(length * 0.1);
  const minUnits = Math.round(length * 0.9), maxUnits = Math.round(length * 1.25);
  const minSentences = Math.ceil(length / 9), maxSentences = Math.ceil(length / 6.5);
  const knownLine = assumedLevels.length
    ? `Known words: all standard JLPT ${assumedLevels.join(", ")} vocabulary` +
      (known.length ? `, plus: ${known.join("、")}` : ".")
    : known.length
      ? `Known words (the learner can read these): ${known.join("、")}`
      : "Known words: none yet. Use only the most basic beginner vocabulary.";

  return `You are writing a graded Japanese reading text for a learner.

LEARNER
- Target level: JLPT ${level}.
- ${knownLine}
${targets.length ? `- Words due for review: use EACH of these at least once, naturally and with this exact meaning: ${targets.join("、")}\n` : ""}${learning.length ? `- Words the learner is still learning (reuse a few of them): ${learning.join("、")}\n` : ""}${prefer.length ? `- Common words written in kana, most frequent first. Prefer them when they fit naturally; they do not count as new words: ${prefer.join("、")}\n` : ""}${grammar.length ? `- Grammar the learner is practising: use each of these at least once, naturally: ${grammar.map((point) => `${point.ja} (${point.en})`).join("; ")}\n` : ""}- A word written with its reading in brackets, like 角(かど), has several readings: use it ONLY with that reading and its meaning (角(かど) is "corner", never つの "horn"). Never write the brackets in the text.

TEXT
- Type: ${type}. Topic: ${topic}.
- LENGTH (strict): the text must contain between ${minUnits} and ${maxUnits} units that are not punctuation, in about ${minSentences}-${maxSentences} sentences. Count them before answering: a text with fewer than ${minUnits} is rejected. If you are short, continue the story with more sentences.
- Natural Japanese with grammar no harder than JLPT ${level}.
- Make it enjoyable to read: one concrete situation with a small story arc, a surprise or a touch of humour. Sentences must connect with each other; never a list of unrelated textbook sentences.
${characters.length ? `- Characters (write their names exactly as given, in kana, and keep their personalities): ${characters.join("; ")}.\n` : ""}- Avoid overused textbook situations and phrases such as お腹が空きました, お弁当を食べました, 公園に行きました, 友達と遊びました, 天気がいいです, or ending with 楽しかったです. Find a fresher situation and vary how sentences begin.
${avoid.length ? `- These sentences already appeared in the learner's recent texts: do not repeat them or close variants of them: ${avoid.join(" / ")}\n` : ""}${scenes.length ? `- Places, animals and objects the learner's recent texts keep coming back to: do not build this story around them: ${scenes.join("、")}\n` : ""}- About 90% of the content words must be known words. Introduce at most ${fresh} new words (about 10%), useful ones at level ${level}.
- Write with the kanji a normal text of this level would use. Words that Japanese normally writes in kana must stay in kana (ある, いる, する, できる, ください, たくさん, かわいい, おいしい): never use rare kanji spellings such as 有る, 居る, 為る, 出来る, 下さい or 沢山.

OUTPUT
Return ONLY one compact JSON object (no explanations, no markdown), with exactly these fields:

{"title":"毎朝のコーヒー","title_en":"Morning coffee","title_es":"El café de cada mañana","sentences":[
{"p":1,"ja":"私|は|毎朝|コーヒー|を|飲みます|。","en":"I drink coffee every morning.","es":"Bebo café todas las mañanas."},
{"p":1,"ja":"今日|は|新しい|店|で|買いました|が|、|あまり|おいしくなかった|です|。","en":"Today I bought it at a new shop, but it was not very good.","es":"Hoy lo compré en una tienda nueva, pero no estaba muy bueno."},
{"p":2,"ja":"「|明日|も|一緒に|行きません|か|」|と|友達|に|聞かれました|。","en":"\\"Won't you come with me tomorrow too?\\" my friend asked me.","es":"«¿No vienes conmigo mañana también?», me preguntó mi amigo."}]}

SEGMENTATION RULES
1. "ja" is the sentence with "|" between units. Removing every "|" must give the exact sentence: no spaces, nothing added, nothing dropped.
2. A conjugated verb or adjective is ONE unit together with its endings and auxiliaries (食べています, 高くなかった, 行きましょう, 聞かれました).
3. Particles are separate units (は, が, を, に, で, も, と, の, か, ね, よ). です and だ after a noun or adjective are their own unit.
4. Compound words stay as they appear in a dictionary (毎日, 食事中, 図書館, 一緒に).
5. Every punctuation mark and bracket is its own unit.
6. No empty units: never "||", and no "|" at the start or the end.
7. Do NOT give lemmas, readings, word translations or parts of speech. Only "p", "ja", "en" and "es".
8. "p" is the paragraph number, starting at 1 (in a dialogue, one paragraph per speaker turn). "en" and "es" are natural translations of the whole sentence.`;
}

// La app pide siempre el formato nuevo; el antiguo se sigue aceptando al pegar
const buildPrompt = async (options) => renderPromptSeg(await promptParams(options));

/* Sin cuenta, todo vive solo en este navegador, y algunos (Safari en iPhone,
   sobre todo) borran los datos de una web que no se usa durante semanas. Se
   avisa cuando ya hay progreso que perder; "Ahora no" lo calla dos semanas. */
const GUEST_NOTICE_DAYS = 14;
function guestNoticeHTML() {
  if (sync.user || userWords.size < 10 || Date.now() - (prefs.guestNoticeAt || 0) < GUEST_NOTICE_DAYS * 86400000) return "";
  return `
    <div class="panel guest-notice" role="note">
      <p>${t("Sin cuenta, tu progreso se guarda solo en este navegador, y algunos (sobre todo Safari en iPhone) lo borran si no abres la app durante unas semanas.")}
        ${sb ? t("Crea una cuenta gratuita para no perderlo; instalar la app también ayuda.") : t("Instalar la app ayuda a que no se borre.")}</p>
      <div class="import-actions">
        <button id="guestLaterBtn" class="button button-quiet" type="button">${t("Ahora no")}</button>
        ${sb ? `<button id="guestAccountBtn" class="button button-primary" type="button">${t("Crear cuenta")}</button>` : ""}
      </div>
    </div>`;
}
function bindGuestNotice() {
  if ($("guestLaterBtn")) $("guestLaterBtn").onclick = () => {
    prefs.guestNoticeAt = Date.now();
    saveLocal("kanji-prefs", prefs);
    document.querySelector(".guest-notice")?.remove();
  };
  if ($("guestAccountBtn")) $("guestAccountBtn").onclick = () => openAuth("signup");
}

async function renderReadHome() {
  const skips = await skipsUsed();
  if (reader || placement || evaluation || document.body.dataset.view !== "read") return;

  // Primero el texto que tiene a medias; si no hay, uno de la comunidad a su nivel
  const own = pendingOwnText();
  const candidate = own ? { text: own, coverage: textCoverage(own) } : nextText();
  const canSkip = skips < MAX_SKIPS;
  const optionsOf = (list) => list.map(([value, label]) =>
    `<option value="${escapeHTML(String(value))}">${t(label)}</option>`).join("");

  $("readArea").innerHTML = `
    ${guestNoticeHTML()}
    ${candidate ? `
    <div class="panel read-next">
      <div>
        <p class="eyebrow">${own ? t("TU TEXTO PENDIENTE") : t("TEXTO RECOMENDADO")}</p>
        <h3 lang="ja">${escapeHTML(candidate.text.title)}</h3>
        <p class="helper">${escapeHTML(lang === "es" ? candidate.text.titleEs : candidate.text.titleEn)} ·
          ${escapeHTML(candidate.text.level)} · ${t("{percent} % conocido", { percent: candidate.coverage })}</p>
      </div>
      <div class="import-actions">
        ${canSkip ? `<button id="readSkipBtn" class="button button-quiet" type="button">${t("Saltar: es muy difícil")}</button>` : ""}
        <button id="readNextBtn" class="button button-primary" type="button">${t("Leer ahora")} →</button>
      </div>
    </div>
    <p class="helper read-rule">${canSkip
      ? t("Termina este texto para crear otro. Si es demasiado difícil puedes saltarlo (te quedan {n}).", { n: plural(MAX_SKIPS - skips, "salto", "saltos") })
      : t("Ya saltaste {n} textos seguidos: termina este para poder crear otro.", { n: MAX_SKIPS })}</p>` : `
    <div class="empty-state">
      ${darumiHTML("curious")}
      <h3>${t("No hay textos sin leer a tu nivel")}</h3>
      ${sb && sync.user ? `<p>${t("Crea uno nuevo aquí abajo: elige tipo, tema y longitud, y la IA lo escribe para ti.")}</p>` : `
      <p>${t("Sin cuenta puedes leer el texto de ejemplo o pegar uno en japonés en Biblioteca. Con una cuenta gratis, la IA escribe textos a tu medida con tus palabras.")}</p>
      <div class="row-actions">
        <button id="readSampleBtn" class="button button-primary" type="button">${t("Leer el texto de ejemplo")}</button>
        ${sb ? `<button id="readSignupBtn" class="button button-outline" type="button">${t("Crear una cuenta gratis")}</button>` : ""}
      </div>`}
    </div>`}

    ${candidate ? "" : `
    <div class="panel">
      <h3>${t("Crear un texto nuevo")}</h3>
      <div class="form-grid prompt-grid">
        <label class="field"><span>${t("Tipo de texto")}</span>
          <select id="promptType">${optionsOf(TEXT_TYPES)}</select></label>
        <label class="field"><span>${t("Tema")}</span>
          <select id="promptTopic">${optionsOf(TEXT_TOPICS)}
            <option value="">${t("Otro (escríbelo)")}</option></select></label>
        <label class="field"><span>${t("Longitud")}</span>
          <select id="promptLength">${optionsOf(TEXT_LENGTHS)}</select></label>
      </div>
      <label id="promptCustomField" class="field hidden"><span>${t("Tu tema")}</span>
        <input id="promptCustom" class="search" type="text" maxlength="80" autocomplete="off"></label>
      <div class="form-footer">
        <p class="helper">${t("La IA escribe un texto a tu medida con las palabras que ya conoces. Tarda alrededor de un minuto.")}${
          aiQuotaText() ? `<br><span class="ai-quota">${escapeHTML(aiQuotaText())}</span>` : ""}</p>
        <div class="import-actions">
          <button id="promptBuildBtn" class="button button-quiet" type="button">${t("Usar otro chat de IA")}</button>
          <button id="generateBtn" class="button button-primary" type="button">✦ ${t("Generar con IA")}</button>
        </div>
      </div>

      <div id="promptStep" class="hidden">
        <p class="helper">${t("1. Copia el prompt. 2. Pégalo en tu IA (ChatGPT, Claude, Gemini…). 3. Pega aquí su respuesta.")}</p>
        <label class="field"><span>${t("Prompt para la IA")}</span>
          <textarea id="promptOutput" rows="6" readonly spellcheck="false"></textarea></label>
        <div class="inline-form">
          <button id="promptCopyBtn" class="button button-outline" type="button">${t("Copiar prompt")}</button>
          <span id="promptCopied" class="helper"></span>
        </div>
        <label class="field"><span>${t("Respuesta de la IA (JSON)")}</span>
          <textarea id="promptAnswer" rows="6" spellcheck="false" autocomplete="off"
            autocapitalize="off" autocorrect="off"></textarea></label>
        <div class="inline-form paste-tools">
          <button id="promptPasteBtn" class="button button-outline" type="button">${t("Pegar del portapapeles")}</button>
          <span id="promptAnswerCount" class="helper"></span>
        </div>
        <div class="form-footer">
          <span></span>
          <button id="promptOpenBtn" class="button button-primary" type="button">${t("Validar y leer")}</button>
        </div>
      </div>
      <div id="promptMessage" class="message" role="status"></div>
    </div>`}`;

  bindGuestNotice();
  if (candidate) {
    $("readNextBtn").onclick = () => openText(candidate.text.id);
    if (canSkip) $("readSkipBtn").onclick = async () => {
      await skipText(candidate.text);
      renderRead();
    };
    return; // con un texto pendiente no se muestra el formulario para crear otro
  }

  $("promptLength").value = meta.reading.level === "N5" ? "50" : "100";
  // De entrada, el tipo y el tema que hace más que no salen (story-core.js, nextVariety)
  const variety = currentVariety();
  $("promptType").value = variety.type;
  $("promptTopic").value = variety.topic;
  $("promptTopic").onchange = () =>
    $("promptCustomField").classList.toggle("hidden", $("promptTopic").value !== "");

  /* Lo elegido en el formulario, o null (con aviso) si falta el tema */
  const chosen = () => {
    const topic = $("promptTopic").value || $("promptCustom").value.trim();
    $("promptMessage").className = "message";
    $("promptMessage").textContent = topic ? "" : t("Escribe un tema primero.");
    return topic ? { type: $("promptType").value, topic, length: Number($("promptLength").value) } : null;
  };

  $("promptBuildBtn").onclick = async () => {
    const options = chosen();
    if (!options) return;
    $("promptOutput").value = await buildPrompt(options);
    $("promptStep").classList.remove("hidden");
    $("promptCopied").textContent = "";
  };

  if ($("readSampleBtn")) $("readSampleBtn").onclick = readSampleText;
  if ($("readSignupBtn")) $("readSignupBtn").onclick = () => openAuth("signup");
  $("generateBtn").onclick = () => {
    const options = chosen();
    if (options) generateAndOpen(options);
  };

  $("promptCopyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("promptOutput").value);
    } catch {
      $("promptOutput").select(); // sin permiso de portapapeles: queda seleccionado para copiar a mano
      document.execCommand?.("copy");
    }
    $("promptCopied").textContent = t("Copiado.");
  };

  $("promptOpenBtn").onclick = async () => {
    const message = $("promptMessage");
    const raw = $("promptAnswer").value;
    if (!raw.trim()) {
      message.className = "message";
      message.textContent = t("Pega primero el JSON del texto.");
      return;
    }
    const save = async (content) => openText((await addText(content)).id);
    const fail = (error) => showPasteError(error, message, (json) => save(json).catch(fail));
    await save(raw).catch(fail);
  };
  bindPasteBox($("promptAnswer"), $("promptAnswerCount"), $("promptPasteBtn"));
}

/* ---------- Generar el texto con la IA (función generate-text de Supabase) ---------- */

/* Mensaje claro para cada fallo de la función */
function generationMessage(code, limit) {
  const messages = {
    unauthorized: t("Inicia sesión para generar textos con IA."),
    limit: t("Has llegado al límite de hoy ({n} textos). Mañana podrás crear más, o usa el modo manual.", { n: limit }),
    busy: t("Hoy ha habido demasiados intentos fallidos. Inténtalo mañana o usa el modo manual."),
    invalid: t("La IA no consiguió escribir un texto válido. No se ha descontado de tu límite; inténtalo de nuevo."),
    quota: t("La IA ha agotado su cuota por ahora. Inténtalo más tarde o usa el modo manual."),
    truncated: t("El texto salió demasiado largo y se cortó. Prueba con una longitud menor."),
    not_configured: t("La generación con IA aún no está configurada. Usa el modo manual.")
  };
  return messages[code] || t("La IA no pudo escribir el texto. Inténtalo de nuevo o usa el modo manual.");
}

/* Textos con IA de hoy: lo que dijo la función en la última respuesta
   (sync.config.aiToday = { day, remaining, limit, plan }) */
function rememberAiQuota(info) {
  if (!Number.isFinite(info?.limit)) return;
  sync.config.aiToday = { day: today(), remaining: Math.max(0, info.remaining ?? 0), limit: info.limit, plan: info.plan || "free" };
  saveLocal("kanji-sync", sync.config);
}
const planName = (plan) => plan === "premium" ? t("Premium") : t("Gratuito");

/* "Plan gratuito: 10 textos con IA al día · te quedan 7 hoy" (o vacío si no se sabe) */
function aiQuotaText() {
  if (!sync.user) return "";
  const known = sync.config.aiToday?.day === today() ? sync.config.aiToday : null;
  const plan = known?.plan || sync.config.plan?.plan || "free";
  const limit = known?.limit;
  return [
    limit ? t("Plan {plan}: {n} textos con IA al día", { plan: planName(plan).toLowerCase(), n: limit }) : t("Plan {plan}", { plan: planName(plan).toLowerCase() }),
    known ? t("te quedan {n} hoy", { n: known.remaining }) : ""
  ].filter(Boolean).join(" · ");
}

async function requestText(params) {
  const { data, error } = await sb.functions.invoke("generate-text", { body: params });
  if (!error) return data;
  // Sin red, o la función no está desplegada todavía
  if (!error.context?.json) throw new Error(navigator.onLine ? generationMessage("not_configured") : t("No hay conexión. Inténtalo de nuevo cuando tengas internet."));
  const info = await error.context.json().catch(() => ({}));
  if (info.error === "limit") rememberAiQuota({ limit: info.limit, remaining: 0, plan: info.plan });
  const code = error.context.status === 404 ? "not_configured" : info.error;
  throw Object.assign(new Error(generationMessage(code, info.limit)), { canRetry: !!info.canRetry });
}

/* El texto de ejemplo de Biblioteca, para leer sin cuenta: se guarda (si no
   estaba ya) y se abre */
async function readSampleText() {
  let text = texts.find((item) => item.title === SAMPLE_TEXT.title);
  if (!text) {
    $("textInput").value = JSON.stringify(SAMPLE_TEXT);
    await addTextFromInput();
    text = texts.find((item) => item.title === SAMPLE_TEXT.title);
  }
  if (text) openText(text.id);
}

/* Pide el texto a la IA. Si la respuesta falla (formato roto, error del
   servicio) la función lo indica y se repite la misma petición, hasta dos
   veces más. Solo cuenta para el límite del estudiante el texto que recibe. */
async function generateAndOpen(options) {
  const message = $("promptMessage");
  if (!sb || !sync.user) {
    message.className = "message";
    message.textContent = generationMessage("unauthorized");
    if (sb) openAuth("login");
    return;
  }

  const button = $("generateBtn");
  const say = (text) => { if (message.isConnected) { message.className = "message"; message.textContent = text; } };
  button.disabled = true;
  say(t("La IA está escribiendo tu texto… puede tardar un minuto."));

  try {
    let params = { ...(await promptParams(options)), requestId: newId(), format: 2 };
    const ask = async () => {
      while (true) {
        try {
          return await requestText(params);
        } catch (error) {
          if (!error.canRetry) throw error;
          say(t("El primer intento no salió bien. Probando de nuevo…"));
        }
      }
    };
    let answer = await ask();
    rememberAiQuota(answer);
    // Si repite frases de los últimos textos se pide otro (una sola vez), diciéndole cuáles no repetir
    const similar = textSimilarity(answerSentences(answer.text), recentSentences(), STUDY_CONFIG.stories.similarity);
    if (similar.tooSimilar && answer.remaining !== 0) {
      say(t("El texto se parecía demasiado a los últimos que has leído. Pidiendo otro…"));
      params = { ...params, requestId: newId(), avoid: similar.repeated.slice(0, 10).map((sentence) => sentence.replace(/\|/g, "")) };
      answer = await ask();
      rememberAiQuota(answer);
    }
    say(t("Analizando el texto… la primera vez se descarga el analizador de japonés (18 MB)."));
    const record = await addText(answer.text, "api", {
      requestId: params.requestId, promptVersion: answer.promptVersion, model: answer.model,
      topic: params.topic, level: params.level
    });
    // Qué se pidió: el tipo y los personajes (para variar el siguiente) y cuáles de las que tocan salieron
    Object.assign(record, {
      type: params.type, cast: params.cast,
      targets: { asked: params.targetIds, found: targetsFound(params.targetIds.map((id) => ({ id })), record.lemmas) }
    });
    await putRecords("texts", [record]);
    openText(record.id);
  } catch (error) {
    if (!message.isConnected) return;
    if (Array.isArray(error)) showTextErrors(error, message); // texto roto
    else {
      message.className = "message incorrect";
      message.textContent = friendlyError(error, t("No se pudo crear el texto. Comprueba tu conexión e inténtalo otra vez en un momento."));
    }
  } finally {
    button.disabled = false;
  }
}

/* Las frases de una respuesta de la IA (formato segmentado), sin las barras */
function answerSentences(raw) {
  try {
    const data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return (data.sentences || []).map((sentence) => String(sentence.ja || "").replace(/\|/g, ""));
  } catch {
    return []; // si no es JSON lo dirá la validación del texto
  }
}

/* Las frases de los últimos textos (de la IA o leídos), para no repetirlas */
const recentSentences = () => texts.filter((text) => text.source === "api" || text.readAt)
  .sort((a, b) => (b.readAt || b.createdAt) - (a.readAt || a.createdAt)).slice(0, STUDY_CONFIG.stories.recentTexts)
  .flatMap((text) => text.data.sentences.map((sentence) => sentence.jp || sentence.tokens.map((token) => token.surface).join("")));

/* =========================================
   9. LECTOR
   ========================================= */

let reader = null; // { text, dictionary, canSkip, clicks: Map(clave -> clasificación), panel, startedAt }
// panel: lo que muestra el panel lateral: { kind: "word", s, t } | { kind: "sentence", s } | null

const CLASSES = {
  new: "Nueva", kanji: "Conocía la palabra, no el kanji", check: "La conocía, solo comprobaba"
};

/* La lectura en curso se guarda en el dispositivo (localStorage "kanji-reader")
   cada vez que se toca o se marca una palabra: si la página se recarga, o se
   sale y se vuelve al mismo texto, se sigue donde se estaba.
     { textId, clicks: [[clave, clasificación]], startedAt, closed }
   closed: se salió con "Salir"; no se vuelve a abrir solo al recargar. */
const READER_KEY = "kanji-reader";
const savedReader = () => loadLocal(READER_KEY, {});

function saveReaderState(closed = false) {
  if (!reader) return;
  saveLocal(READER_KEY, { textId: reader.text.id, clicks: [...reader.clicks], startedAt: reader.startedAt, closed });
}
function clearReaderState() {
  try { localStorage.removeItem(READER_KEY); } catch { /* modo privado */ }
}

/* Al abrir la app: si se recargó en mitad de una lectura, se vuelve a ella */
async function restoreReader() {
  const saved = savedReader();
  const text = saved.textId && texts.find((x) => x.id === saved.textId);
  if (!text || text.readAt || text.hiddenAt || saved.closed) return false;
  await openText(text.id);
  return true;
}

async function openText(id) {
  const text = texts.find((x) => x.id === id);
  if (!text) return;
  const canSkip = !text.readAt && await skipsUsed() < MAX_SKIPS; // un texto ya leído no se salta
  const dictionary = {};
  const entries = {};
  for (const sentence of text.data.sentences) {
    Object.assign(dictionary, sentence.dictionary);
    Object.assign(entries, sentence.entries);
  }
  // Abrir otro texto deja la evaluación pendiente para otro momento (como "Ahora no"):
  // si no, la evaluación tapaba el texto que se acababa de abrir
  evaluation = null;
  // Lo que ya se había consultado en este mismo texto (antes de recargar o de salir)
  const saved = savedReader();
  const resume = saved.textId === id && !text.readAt;
  // rubyShown: palabras que han salido con furigana (al leer no cuentan como repaso: la lectura estaba a la vista)
  reader = { text, dictionary, entries, canSkip, clicks: new Map(resume ? saved.clicks : []), panel: null,
    startedAt: resume && saved.startedAt || Date.now(), rubyShown: new Set(), keyMap: new Map() };
  // Las claves de un texto guardado antes de la limpieza (来ました, のは) se pasan a su
  // lema; sin esperar a kuromoji para abrirlo: al estar, se vuelve a pintar
  reader.keyMapReady = textKeyMap(text).then((map) => {
    if (reader?.text !== text) return;
    reader.keyMap = map;
    if (map.size && !reader.panel) refreshReader();
  });
  saveReaderState();
  switchView("read");
}

/* La clave con la que se guarda cada palabra de un texto (savedWord, story-core.js,
   sección 6): Map(clave del texto -> clave buena, o "" si no se guarda). Solo lleva
   las que cambian. Las palabras nuevas reciben su ficha en el diccionario propio. */
async function textKeyMap(text) {
  const map = new Map();
  try {
    const tools = await readingWordTools();
    const fresh = [];
    for (const key of Object.keys(text.lemmas || {})) {
      const [lemma, reading] = key.split("|");
      const result = savedWord({ ...userWords.get(key), lemma, reading }, tools);
      if (result.drop) { map.set(key, ""); continue; }
      if (result.id === key) continue;
      map.set(key, result.id);
      const entry = lemmaEntry(result, words.get(key));
      if (entry) fresh.push(entry);
    }
    await putRecords("words", fresh);
  } catch (error) {
    console.error("No se pudieron revisar las palabras del texto:", error); // se lee igual, con sus claves
  }
  return map;
}

/* Lo que necesita savedWord en el navegador */
async function readingWordTools() {
  await BANK.loadUpTo("N1").catch(() => {});
  const [tokenizer, jmdict] = await Promise.all([loadTokenizer().catch(() => null), loadLocalDictionary()]);
  return savedWordTools({ bank: BANK, jmdict, entries: words, records: userWords, tokenizer });
}

/* La ficha de una palabra que pasa a su lema (来ました -> 来る): la del banco, o la
   de la forma que tenía (su significado), con la escritura nueva. null si ya la hay. */
function lemmaEntry(target, old) {
  if (words.has(target.id)) return null;
  const word = BANK.words.get(target.id);
  const entry = word
    ? { id: target.id, lemma: word.w, reading: word.r, meanings: word.en, meaningsEs: word.es, pos: "", source: "jmdict", updatedAt: Date.now() }
    : old ? { ...old, id: target.id, lemma: target.lemma, reading: target.reading, updatedAt: Date.now() } : null;
  if (entry) words.set(entry.id, entry);
  return entry;
}

/* Las claves de las palabras de un texto, ya pasadas a su lema y sin repetirse */
const readerKeys = (text, keyMap = new Map()) =>
  [...new Set(Object.keys(text.lemmas).map((key) => keyMap.has(key) ? keyMap.get(key) : key))].filter(Boolean);

/* La palabra de una unidad del texto: su clave y su entrada. Los textos nuevos
   llevan la clave en cada unidad; los anteriores, un diccionario por lema. */
const tokenEntry = (token) => token.key && reader.entries?.[token.key] || reader.dictionary[token.lemma] || null;
function tokenKey(token) {
  const key = token.key && reader.entries?.[token.key] ? token.key
    : reader.dictionary[token.lemma] ? wordKey(token.lemma, reader.dictionary[token.lemma].reading) : "";
  return reader.keyMap?.has(key) ? reader.keyMap.get(key) : key;
}

/* Furigana solo sobre la parte en kanji: 飲みます -> 飲(の)みます */
function rubyHTML(surface, reading) {
  const s = [...surface], r = [...reading];
  const same = (a, b) => !isKanji(a) && normalizeReading(a) === normalizeReading(b);
  let end = 0;
  while (end < s.length && end < r.length && same(s[s.length - 1 - end], r[r.length - 1 - end])) end++;
  let start = 0;
  while (start < s.length - end && start < r.length - end && same(s[start], r[start])) start++;
  const base = s.slice(start, s.length - end).join("");
  const top = r.slice(start, r.length - end).join("");
  if (!base || !top) return escapeHTML(surface);
  return `${escapeHTML(s.slice(0, start).join(""))}<ruby>${escapeHTML(base)}<rt>${escapeHTML(top)}</rt></ruby>${
    escapeHTML(s.slice(s.length - end).join(""))}`;
}

function sentenceHTML(sentence, index, known) {
  const mode = prefs.furigana;
  const open = reader.panel;
  const words = sentence.tokens.map((token, tokenIndex) => {
    const key = tokenKey(token);
    if (!key) return escapeHTML(token.surface);

    const hasKanji = /\p{Script=Han}/u.test(token.surface);
    const unknown = !UNCOUNTED_POS.has(token.pos) && !isKnownKey(key, known);
    const furigana = hasKanji && (mode === "all" || mode === "unknown" && unknown);
    if (furigana) reader.rubyShown.add(key);
    const mark = reader.clicks.get(key);
    const active = open?.kind === "word" && open.s === index && open.t === tokenIndex;
    return `<span class="tok${mark ? ` tok-${mark}` : ""}${active ? " active" : ""}" role="button" tabindex="0"
      data-s="${index}" data-t="${tokenIndex}">${
        furigana ? rubyHTML(token.surface, token.reading) : escapeHTML(token.surface)}</span>`;
  }).join("");
  // Un texto pegado no trae traducción: sin ella no hay botón 訳
  if (!(sentence.es || sentence.en)) return `<span class="sent${open?.s === index ? " active" : ""}" data-sent="${index}">${words}</span>`;
  // El botón 訳 enseña la traducción de la frase entera sin tener que tocar una palabra
  return `<span class="sent${open?.s === index ? " active" : ""}" data-sent="${index}">${words}</span><button
    class="sent-btn${open?.kind === "sentence" && open.s === index ? " on" : ""}" type="button" data-translate="${index}"
    title="${t("Traducción de la frase")}" aria-label="${t("Traducción de la frase")}" lang="ja">訳</button>`;
}

const FURIGANA_MODES = [["unknown", "Nuevas"], ["all", "Todas"], ["none", "Ninguna"]];

/* Panel junto al texto (debajo en móvil): la palabra tocada o la traducción de una frase */
function panelHTML() {
  const open = reader.panel;
  if (!open) return `<p class="helper">${t("Toca una palabra para ver su lectura y significado, o 訳 para traducir la frase entera.")}</p>`;

  const sentence = reader.text.data.sentences[open.s];
  const close = `<button class="icon-btn pop-close" type="button" data-panel-close
    title="${t("Cerrar")}" aria-label="${t("Cerrar")}">×</button>`;
  const translation = escapeHTML(lang === "es" ? sentence.es : sentence.en);

  if (open.kind === "sentence") {
    return `${close}
      <p class="panel-label">${t("Traducción de la frase")}</p>
      <p class="panel-jp" lang="ja">${escapeHTML(sentence.jp)}</p>
      <p class="panel-translation">${translation}</p>`;
  }

  const token = sentence.tokens[open.t];
  const entry = tokenEntry(token);
  const meanings = lang === "es" && entry.meanings_es?.length ? entry.meanings_es : entry.meanings;
  const current = reader.clicks.get(tokenKey(token));
  return `${close}
    <div class="pop-word" lang="ja">${escapeHTML(token.surface)}</div>
    <div class="pop-reading"><span lang="ja">${escapeHTML(token.reading)}</span>${romajiHTML(token.reading)}${"speechSynthesis" in window
      ? ` <button class="link-btn" type="button" data-panel-speak="${escapeHTML(token.reading)}" title="${t("Escuchar")}" aria-label="${t("Escuchar")}">🔊</button>` : ""}</div>
    ${token.lemma !== token.surface ? `<p class="pop-lemma">${t("Forma de diccionario")}:
      <span lang="ja">${escapeHTML(token.lemma)}（${escapeHTML(entry.reading)}）</span></p>` : ""}
    <p class="meaning">${escapeHTML(meanings.join(", "))}</p>
    <p class="helper">${escapeHTML(entry.pos || token.pos || "")}</p>
    <div class="pop-actions">
      ${Object.entries(CLASSES).map(([cls, label]) => `
        <button class="button pop-${cls}${current === cls ? " chosen" : ""}" type="button"
          data-class="${cls}">${t(label)}</button>`).join("")}
    </div>
    ${translation ? `<button class="link-btn panel-more" type="button" data-translate="${open.s}">${t("Ver la traducción de la frase")}</button>` : ""}`;
}

function renderReader() {
  const { text, canSkip } = reader;
  const known = knownLemmas();
  // Las oraciones seguidas del mismo párrafo se leen como texto corrido
  const paragraphs = [];
  text.data.sentences.forEach((sentence, index) => {
    const last = paragraphs[paragraphs.length - 1];
    if (last && (sentence.paragraph ?? 1) === (last[0][0].paragraph ?? 1)) last.push([sentence, index]);
    else paragraphs.push([[sentence, index]]);
  });
  $("readArea").innerHTML = `
    <div class="reader${reader.panel ? " has-panel" : ""}">
      <div class="reader-head">
        <div>
          <h3 lang="ja">${escapeHTML(text.title)}</h3>
          <p class="helper">${escapeHTML(lang === "es" ? text.titleEs : text.titleEn)} ·
            ${escapeHTML(text.level)} · ${escapeHTML(text.topic)} · ${plural(wordCount(text.data), "palabra", "palabras")}</p>
          ${text.targets?.asked?.length ? `<p class="helper">${t("Salen {found} de las {asked} palabras que te tocaba repasar: si no las tocas, cuentan como repasadas.",
            { found: text.targets.found.length, asked: text.targets.asked.length })}</p>` : ""}
        </div>
        <button id="readerCloseBtn" class="button button-quiet" type="button">${t("Salir")}</button>
      </div>
      <div class="reader-tools">
        <button id="reportBtn" class="link-btn report-btn" type="button">⚑ ${t("Reportar error")}</button>
        <span class="helper">Furigana</span>
        <div class="toggle-group" role="group" aria-label="Furigana">
          ${FURIGANA_MODES.map(([mode, label]) => `
            <button class="toggle${prefs.furigana === mode ? " on" : ""}" type="button"
              data-furigana="${mode}">${t(label)}</button>`).join("")}
        </div>
      </div>
      <div class="reader-body">
        <div class="reading-text" lang="ja">
          ${paragraphs.map((group) => `
          <p>${group.map(([sentence, index]) => sentenceHTML(sentence, index, known)).join("")}</p>`).join("")}
        </div>
        <aside id="readerPanel" class="reader-panel${reader.panel ? "" : " empty"}" aria-live="polite">${panelHTML()}</aside>
      </div>
      <div class="row-actions">
        ${canSkip ? `<button id="readerDiscardBtn" class="button button-outline" type="button">${t("Saltar: es muy difícil")}</button>` : ""}
        <button id="readerFinishBtn" class="button button-primary" type="button">${t("Terminar lectura")}</button>
      </div>
    </div>`;

  $("readerCloseBtn").onclick = () => { saveReaderState(true); reader = null; renderRead(); };
  $("reportBtn").onclick = openReport;
  $("readerFinishBtn").onclick = () => finishReading(false);
  if (canSkip) $("readerDiscardBtn").onclick = () => finishReading(true);
}

/* ---------- Reportar un error del texto ---------- */

function openReport() {
  $("reportComment").value = "";
  $("reportMessage").textContent = sb && sync.user ? "" : t("Inicia sesión para enviar reportes.");
  $("reportSendBtn").disabled = !(sb && sync.user);
  $("reportDialog").showModal();
}

async function submitReport(event) {
  event.preventDefault();
  if (!reader) return $("reportDialog").close();
  $("reportSendBtn").disabled = true;
  const sent = await sendReport(reader.text, "user", $("reportCategory").value, $("reportComment").value.trim());
  $("reportSendBtn").disabled = false;
  if (!sent) {
    $("reportMessage").textContent = t("No se pudo enviar el reporte. Inténtalo de nuevo.");
    return;
  }
  $("reportDialog").close();
}

/* Vuelve a dibujar el lector sin mover el texto y deja a la vista lo que se tocó
   (en móvil el panel ocupa la parte baja de la pantalla) */
function refreshReader() {
  const scroll = window.scrollY;
  renderReader();
  window.scrollTo(0, scroll);
  const active = document.querySelector(".tok.active, .sent.active");
  const panel = $("readerPanel");
  if (!active || getComputedStyle(panel).position !== "fixed") return;
  const hidden = active.getBoundingClientRect().bottom - (panel.getBoundingClientRect().top - 12);
  if (hidden > 0) window.scrollBy({ top: hidden, behavior: "smooth" });
}

function closeWordPop() {
  if (reader) reader.panel = null;
}

function showPanel(panel) {
  reader.panel = panel;
  if (panel?.kind === "word") {
    const key = tokenKey(reader.text.data.sentences[panel.s].tokens[panel.t]);
    if (!reader.clicks.has(key)) reader.clicks.set(key, "looked");
    saveReaderState();
  }
  refreshReader();
}

/* New: no la conocía. Kanji: conocía la palabra pero no su escritura.
   Check: la conocía; queda como posiblemente conocida hasta la evaluación. */
async function classifyWord(cls) {
  const { s, t: index } = reader.panel;
  const token = reader.text.data.sentences[s].tokens[index];
  const key = tokenKey(token);
  if (!key) return;
  const mine = userWords.get(key) || blankUserWord(...key.split("|"));
  if (reader.clicks.get(key) === "looked" || !reader.clicks.has(key)) mine.lookups++;
  mine.lastSeen = Date.now();
  mine.origin ??= "lectura";

  if (cls === "new") Object.assign(mine, { status: "learning", canReadKanji: false, knowsMeaning: false });
  if (cls === "kanji") Object.assign(mine, { status: "learning", canReadKanji: false, knowsMeaning: true });
  if (cls === "check" && mine.status !== "mastered") mine.status = "pre_known";

  reader.clicks.set(key, cls);
  saveReaderState();
  await saveUserWord(mine);
  if (reader) refreshReader(); // el panel sigue abierto, con la opción elegida marcada
}

/* ---------- Fin de la lectura ---------- */

async function finishReading(discarded) {
  await reader.keyMapReady;
  const { text, clicks, startedAt } = reader;
  const keys = readerKeys(text, reader.keyMap);
  const now = Date.now();

  let record;
  if (discarded) {
    record = await skipText(text, clicks, startedAt);
  } else {
    text.readAt = text.updatedAt = now;
    await putRecords("texts", [text]);
    record = { id: newId(), textId: text.id, startedAt, finishedAt: now, discarded, clicks: Object.fromEntries(clicks) };
    await putRecords("sessions", [record]);
  }

  const marked = [...clicks.values()].filter((cls) => cls === "new" || cls === "kanji").length;
  const unique = keys.length || 1;
  const summary = {
    discarded, record,
    looked: clicks.size,
    hard: discarded || marked / unique >= HARD_RATIO,
    easier: LEVELS[LEVELS.indexOf(meta.reading.level) - 1]
  };

  // Un texto descartado no se leyó: sus palabras no cambian de estado
  const candidates = discarded ? [] : await markSeenWords(keys, clicks);
  if (!discarded) summary.reviews = await reviewByReading(keys, clicks, reader.rubyShown, record);
  reader = null;
  clearReaderState();
  scheduleSync();
  if (candidates.length) startEvaluation(candidates, summary);
  else renderReadSummary(summary);
}

/* Al terminar un texto, sus palabras sin progreso pasan a pre_known
   (posiblemente conocidas, sin confirmar). Devuelve las pre_known vistas,
   primero las que el usuario consultó. */
async function markSeenWords(keys, clicks) {
  const now = Date.now();
  const seen = [];
  for (const key of keys) {
    const entry = words.get(key);
    if (!entry) continue;
    let mine = userWords.get(key);
    if (!mine) {
      mine = blankUserWord(entry.lemma, entry.reading);
      mine.status = "pre_known";
    }
    mine.origin ??= "lectura";
    mine.seen++;
    mine.lastSeen = mine.updatedAt = now;
    userWords.set(key, mine);
    seen.push(mine);
  }
  await putRecords("userWords", seen);

  // Los kanjis del texto quedan como "vistos": desbloquean las palabras básicas que los llevan
  const seenKanji = [];
  for (const c of new Set(keys.flatMap((key) => kanjiOf(key.split("|")[0])))) {
    const record = userKanji.get(c) || blankUserKanji(c);
    if (record.seenAt) continue;
    record.seenAt = record.updatedAt = now;
    userKanji.set(c, record);
    seenKanji.push(record);
  }
  await putRecords("userKanji", seenKanji);

  const hasKanji = (word) => /\p{Script=Han}/u.test(word.lemma);
  return shuffle(seen.filter((word) => word.status === "pre_known"))
    .sort((a, b) => clicks.has(b.id) - clicks.has(a.id) || hasKanji(b) - hasKanji(a));
}

/* Leer cuenta como repaso (learning-core.js, sección 3): las palabras del texto
   que tocaba repasar. Devuelve [{ key, result, before }] (before: el registro
   como estaba, para poder deshacerlo desde el resumen) y lo apunta en la sesión
   (record.reviews = { clave: "good" | "again" }). */
async function reviewByReading(keys, clicks, rubyShown, record) {
  const day = today(), done = [];
  for (const key of keys) {
    const rec = userWords.get(key);
    const { result } = readingCredit({
      rec, tapped: clicks.has(key), checked: clicks.get(key) === "check", furigana: rubyShown.has(key), day
    }, STUDY_CONFIG.readingReview);
    if (!result) continue;
    const before = structuredClone(rec);
    applyReadingReview(rec, result);
    rec.updatedAt = Date.now();
    done.push({ key, result, before });
  }
  if (!done.length) return done;
  await putRecords("userWords", done.map(({ key }) => userWords.get(key)));
  record.reviews = Object.fromEntries(done.map(({ key, result }) => [key, result]));
  await putRecords("sessions", [record]);
  updateCounts();
  return done;
}

/* Deshacer desde el resumen: una palabra tocada sin querer cuenta como acertada,
   y una que no se tocó pero no se sabía, como fallada */
async function flipReadingReview(item, record) {
  const rec = structuredClone(item.before);
  item.result = item.result === "good" ? "again" : "good";
  applyReadingReview(rec, item.result);
  rec.updatedAt = Date.now();
  userWords.set(rec.id, rec);
  await putRecords("userWords", [rec]);
  record.reviews = { ...record.reviews, [item.key]: item.result };
  await putRecords("sessions", [record]);
  scheduleSync();
}

/* Las palabras repasadas al leer, con su botón para cambiarlo */
function readingReviewsHTML(reviews) {
  if (!reviews?.length) return "";
  const row = (item, i) => {
    const [lemma, reading] = item.key.split("|");
    return `<li class="read-review read-${item.result}">
      <span><strong lang="ja">${escapeHTML(lemma)}</strong> <span lang="ja">${escapeHTML(reading)}</span>
        · ${item.result === "good" ? t("bien") : t("a repasar")}</span>
      <button class="link-btn" type="button" data-flip="${i}">${item.result === "good" ? t("No la sabía") : t("La toqué sin querer")}</button>
    </li>`;
  };
  const good = reviews.filter((item) => item.result === "good").length;
  return `
    <div class="panel read-reviews">
      <h3>${t("Repasadas al leer: {good} bien, {again} a repasar", { good, again: reviews.length - good })}</h3>
      <p class="helper">${t("Palabras que te tocaba repasar. Las que no tocaste cuentan como acertadas (su próximo repaso se aleja un poco menos que en Repasar); las que tocaste vuelven a repaso.")}</p>
      <ul class="read-review-list">${reviews.map(row).join("")}</ul>
    </div>`;
}

function renderReadSummary(summary) {
  const { discarded, looked, hard, easier, mastered, learning } = summary;
  $("readArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML(discarded ? "idle" : "celebrate")}
      <h3>${discarded ? t("Texto saltado") : t("Lectura terminada")}</h3>
      <p>${t("Consultaste {n} de este texto.", { n: plural(looked, "palabra", "palabras") })}
        ${mastered === undefined ? "" : t("Al comprobarlas: {mastered} y {learning}.", {
          mastered: plural(mastered, "palabra dominada", "palabras dominadas"),
          learning: plural(learning, "por aprender", "por aprender") })}
        ${hard && easier ? t("Parece que este nivel te queda difícil. ¿Quieres textos de {level}?", { level: easier }) : ""}
        ${summary.reviews?.length ? t("Además repasaste {n} al leer (debajo).", { n: plural(summary.reviews.length, "palabra", "palabras") }) : ""}</p>
      <div class="row-actions">
        ${hard && easier ? `<button id="readEasierBtn" class="button button-outline" type="button">
          ${t("Cambiar a {level}", { level: easier })}</button>` : ""}
        <button class="button button-outline" data-go="today" type="button">${t("Volver a Hoy")}</button>
        <button id="readMoreBtn" class="button button-primary" type="button">${t("Siguiente texto")}</button>
      </div>
    </div>
    ${readingReviewsHTML(summary.reviews)}`;
  $("readMoreBtn").onclick = renderRead;
  $("readArea").querySelectorAll("[data-flip]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      await flipReadingReview(summary.reviews[Number(button.dataset.flip)], summary.record);
      renderReadSummary(summary);
    };
  });
  if ($("readEasierBtn")) $("readEasierBtn").onclick = async () => {
    await setReadLevel(easier);
    renderRead();
  };
}

/* =========================================
   10. EVALUACIÓN TRAS LA LECTURA
   -----------------------------------------
   De cada palabra pre_known se pregunta la lectura y el significado.
   Las dos bien -> mastered; algún fallo -> learning.
   ========================================= */

const EVAL_SIZE = 8; // palabras por evaluación; el resto sigue en pre_known

let evaluation = null; // { queue: [{ word, entry, steps }], index, step, results, summary }

function startEvaluation(candidates, summary) {
  const queue = candidates.slice(0, EVAL_SIZE).map((word) => ({
    word,
    entry: words.get(word.id),
    // Una palabra en kana ya se sabe leer: solo se pregunta el significado
    steps: /\p{Script=Han}/u.test(word.lemma) ? ["reading", "meaning"] : ["meaning"]
  }));
  evaluation = { queue, index: 0, step: 0, results: new Map(), summary };
  renderEvaluationIntro();
}

function renderEvaluationIntro() {
  $("readArea").innerHTML = `
    <div class="empty-state">
      ${darumiHTML("curious")}
      <h3>${t("Lectura terminada. ¿Las conocías de verdad?")}</h3>
      <p>${t("Hay {n} sin confirmar. Una comprobación rápida dice cuáles dominas ya.", {
        n: plural(evaluation.queue.length, "palabra", "palabras") })}</p>
      <div class="row-actions">
        <button id="evalSkipBtn" class="button button-quiet" type="button">${t("Ahora no")}</button>
        <button id="evalStartBtn" class="button button-primary" type="button">${t("Comprobar las palabras")}</button>
      </div>
    </div>`;
  $("evalStartBtn").onclick = () => { evaluation.started = true; renderEvaluation(); };
  $("evalSkipBtn").onclick = () => {
    const { summary } = evaluation;
    evaluation = null;
    renderReadSummary(summary);
  };
}

const entryGloss = (entry) =>
  (lang === "es" && entry.meaningsEs?.length ? entry.meaningsEs : entry.meanings).slice(0, 2).join(", ");

function renderEvaluation() {
  if (!evaluation.started) return renderEvaluationIntro();
  const { queue, index, step } = evaluation;
  const { word, entry, steps } = queue[index];
  const kind = steps[step];
  const label = kind === "reading" ? (e) => e.reading : entryGloss;

  // Respuestas falsas: otras palabras del diccionario con respuesta distinta, primero las
  // que se parecen (comparten un kanji, mismo nivel o largo: pickDistractors, learning-core.js).
  // Al azar del todo se descartaban solas y acertar no decía nada.
  const shape = (own) => ({ id: own.id, w: own.lemma, kanji: kanjiOf(own.lemma), level: BANK.words.get(own.id)?.level || null, own });
  const pool = [...words.values()].filter((other) => kind !== "reading" || /\p{Script=Han}/u.test(other.lemma)).map(shape);
  const wrong = pickDistractors(shape(entry), pool, { count: 3, label: (item) => label(item.own) }).map((item) => item.own);
  const options = shuffle([entry, ...wrong]);

  $("readArea").innerHTML = `
    <div class="card">
      <div class="card-top">
        <span class="pill">${t("Comprobar palabras")}</span>
        <span class="card-progress">${index + 1} / ${queue.length}</span>
      </div>
      <div class="meter" aria-hidden="true">
        <div style="width:${(index / queue.length) * 100}%"></div>
      </div>
      <div class="card-symbol word" lang="ja">${escapeHTML(word.lemma)}</div>
      <p class="helper">${kind === "reading" ? t("¿Cómo se lee?") : t("¿Qué significa?")}</p>
      <div class="choices">
        ${options.map((option, i) => `
          <button class="button button-outline choice" type="button" data-choice="${i}"
            ${kind === "reading" ? 'lang="ja"' : ""}>${escapeHTML(label(option))}</button>`).join("")}
        <button class="button button-quiet choice" type="button" data-choice="-1">${t("No lo sé")}</button>
      </div>
    </div>`;

  const current = evaluation;
  $("readArea").querySelectorAll("[data-choice]").forEach((button) => {
    button.onclick = () => {
      const correct = options[Number(button.dataset.choice)] === entry;
      $("readArea").querySelectorAll("[data-choice]").forEach((b) => {
        b.disabled = true;
        if (options[Number(b.dataset.choice)] === entry) b.classList.add("choice-right");
      });
      if (!correct) button.classList.add("choice-wrong");

      const result = current.results.get(word.id) || {};
      result[kind] = correct;
      current.results.set(word.id, result);

      setTimeout(() => {
        if (evaluation !== current) return;
        if (++current.step >= steps.length) { current.step = 0; current.index++; }
        if (current.index < queue.length) renderEvaluation();
        else finishEvaluation();
      }, correct ? 450 : 1100);
    };
  });
}

async function finishEvaluation() {
  const { queue, results, summary } = evaluation;
  let mastered = 0;

  for (const { word } of queue) {
    const result = results.get(word.id);
    const reading = result.reading ?? true; // en kana no se pregunta
    const passed = reading && result.meaning;
    Object.assign(word, {
      status: passed ? "mastered" : "learning",
      canReadKanji: reading,
      knowsMeaning: result.meaning
    });
    if (passed) {
      word.evalCorrect++;
      mastered++;
      // Acaba de leerla: acertarla ahora no dice si la sabrá la semana que viene. Con
      // tarjeta vuelve a salir; sin ella quedaba «dominada» y no se repasaba nunca.
      giveCheckedCard(word, STUDY_CONFIG.checkedIntervalDays.evaluation, new Date(), { kana: true });
    } else word.evalWrong++;
    word.updatedAt = Date.now();
  }
  await putRecords("userWords", queue.map(({ word }) => word));

  summary.record.evaluation = Object.fromEntries(results);
  await putRecords("sessions", [summary.record]);
  scheduleSync();

  evaluation = null;
  renderReadSummary({ ...summary, mastered, learning: queue.length - mastered });
}

async function setReadLevel(level) {
  meta.reading.level = level;
  meta.reading.updatedAt = Date.now();
  await saveMeta();
  scheduleSync();
  $("readLevel").textContent = level;
  $("readLevelSelect").value = level;
}

/* ---------- Vista ---------- */

function renderRead() {
  $("readLevel").textContent = meta.reading.level || "";
  $("readLevel").classList.toggle("hidden", !meta.reading.placedAt);
  if (meta.reading.level) $("readLevelSelect").value = meta.reading.level;
  if (placement) return renderPlacement();
  if (evaluation && meta.reading.placedAt) return renderEvaluation();
  if (!meta.reading.placedAt) return renderOnboarding();
  if (reader) return renderReader();
  // Una sola vez al abrir la app: la lectura que quedó a medias al recargar
  if (!restoreTried) {
    restoreTried = true;
    return restoreReader().then((restored) => { if (!restored) renderReadHome(); });
  }
  renderReadHome();
}
let restoreTried = false;

function bindReader() {
  const area = $("readArea");
  area.addEventListener("click", (event) => {
    if (!reader) return;
    const pick = (selector) => event.target.closest(selector);
    const token = pick(".tok"), translate = pick("[data-translate]");
    if (token) {
      const panel = { kind: "word", s: Number(token.dataset.s), t: Number(token.dataset.t) };
      const same = reader.panel?.kind === "word" && reader.panel.s === panel.s && reader.panel.t === panel.t;
      return showPanel(same ? null : panel); // tocar otra vez la misma palabra cierra el panel
    }
    if (translate) {
      const s = Number(translate.dataset.translate);
      const same = reader.panel?.kind === "sentence" && reader.panel.s === s;
      return showPanel(same ? null : { kind: "sentence", s });
    }
    if (pick("[data-panel-close]")) return showPanel(null);
    if (pick("[data-panel-speak]")) return speak(pick("[data-panel-speak]").dataset.panelSpeak);
    if (pick("[data-class]")) return classifyWord(pick("[data-class]").dataset.class);
    if (pick("[data-furigana]")) {
      prefs.furigana = $("furiganaSelect").value = pick("[data-furigana]").dataset.furigana;
      saveLocal("kanji-prefs", prefs);
      refreshReader();
    }
  });
  area.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".tok")) {
      event.preventDefault();
      event.target.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && reader?.panel) showPanel(null);
  });

  $("reportForm").addEventListener("submit", submitReport);
  $("reportCancelBtn").addEventListener("click", () => $("reportDialog").close());

  // Ajustes de lectura
  $("furiganaSelect").value = prefs.furigana;
  $("furiganaSelect").addEventListener("change", () => {
    prefs.furigana = $("furiganaSelect").value;
    saveLocal("kanji-prefs", prefs);
  });
  $("readLevelSelect").value = meta.reading.level || "N5";
  $("readLevelSelect").addEventListener("change", () => setReadLevel($("readLevelSelect").value));
  $("placementRedoBtn").addEventListener("click", () => {
    reader = evaluation = null;
    meta.reading = {};
    switchView("read");
  });
}

/* =========================================
   13. LIMPIEZA DE LAS PALABRAS GUARDADAS (una sola vez)
   -----------------------------------------
   Antes, al leer se guardaba a veces lo que salía en el texto tal cual
   (来ました, のは, い, 下手|したて). La regla de lo que se guarda ahora es
   savedWord (story-core.js, sección 6); aquí se aplica una vez a lo ya
   guardado. Primero se enseña la lista entera y se descarga una copia;
   solo se aplica si el usuario lo acepta. Con sesión, después de sincronizar,
   para partir de lo último de los demás dispositivos. Lo borrado se queda
   como marca (deletedWords) y se sube con deleted_at.
   prefs.wordCleanup: 1 cuando ya está hecha (o no había nada que limpiar).
   ========================================= */

let wordCleanup = null; // { plan, backup } mientras el diálogo está abierto

const CLEANUP_REASONS = {
  "vacía": "vacía", "kana suelta": "una kana suelta", "partícula o auxiliar": "partícula o auxiliar, no es una palabra",
  "trozo probable": "trozo de otra palabra, sin entrada en el diccionario", "lectura inventada": "esa lectura no existe",
  "sin significado": "sin significado en ningún diccionario", "sin lectura": "sin lectura",
  "conjugada": "forma conjugada", "forma": "otra forma del verbo o adjetivo", "grafía": "escritura antigua",
  "kana": "casi siempre se escribe en kana"
};

async function offerWordCleanup() {
  if (prefs.wordCleanup === 1 || prefs.wordCleanupLater === today()) return;
  if (sync.user) {
    // Lo que otro dispositivo ya limpió llega antes: así no se une dos veces
    for (let i = 0; sync.running && i < 60; i++) await new Promise((done) => setTimeout(done, 500));
    await syncNow();
    if (sync.user && !sync.config.lastSync) return; // sin conexión: otro día
  }
  if (!userWords.size) { prefs.wordCleanup = 1; return saveLocal("kanji-prefs", prefs); }
  const tools = await readingWordTools();
  if (!tools.tokens) return; // sin kuromoji no se puede decidir bien: otro día
  const plan = planWordCleanup([...userWords.values()], tools);
  if (!plan.remove.length && !plan.save.length) { prefs.wordCleanup = 1; return saveLocal("kanji-prefs", prefs); }
  wordCleanup = { plan };
  renderWordCleanup();
  $("cleanupDialog").showModal();
}

function renderWordCleanup() {
  const { plan } = wordCleanup;
  const word = (id) => {
    const [lemma, reading] = id.split("|");
    return `<span lang="ja">${escapeHTML(lemma)}</span>${reading && reading !== lemma
      ? ` <span class="helper" lang="ja">${escapeHTML(reading)}</span>` : ""}`;
  };
  const state = (rec) => escapeHTML(t(WORD_STATUS_ONE[rec.status] || rec.status)) +
    (rec.repetitions ? ` · ${plural(rec.repetitions, "repaso", "repasos")}` : "");
  const merged = new Set(plan.save.map((rec) => rec.id));
  const existing = (id) => userWords.has(id);
  $("cleanupList").innerHTML = `
    <h4>${t("Se borran")} (${plan.drops.length})</h4>
    <ul class="cleanup-list">${plan.drops.map(({ id, reason, rec }) => `<li>${word(id)}
      <span class="cleanup-why">${state(rec)} — ${escapeHTML(t(CLEANUP_REASONS[reason] || reason))}</span></li>`).join("")}</ul>
    <h4>${t("Pasan a su forma de diccionario")} (${plan.moves.length})</h4>
    <ul class="cleanup-list">${plan.moves.map(({ from, to, why, rec }) => `<li>${word(from)} → ${word(to)}
      <span class="cleanup-why">${state(rec)} — ${escapeHTML(t(CLEANUP_REASONS[why] || why))}${
        existing(to) && merged.has(to) ? ` · ${t("se une a la que ya tenías")}` : ""}</span></li>`).join("")}</ul>`;
  $("cleanupMessage").textContent = "";
}

/* La copia de antes de limpiar: todo el progreso por palabra y lo que lo nombra.
   tools/word-cleanup.mjs la lee para volver a calcular la lista. */
function downloadWordBackup() {
  const affected = new Set([...wordCleanup.plan.remove, ...wordCleanup.plan.save.map((rec) => rec.id)]);
  const backup = {
    app: "yomipop", kind: "word-cleanup-backup", createdAt: new Date().toISOString(),
    userWords: [...userWords.values()],
    words: [...affected].map((id) => words.get(id)).filter(Boolean),
    queue: meta.queue || null, roadmap: meta.roadmap || null,
    captured: [...userSentences.values()].filter((sentence) => sentence.source === "web" && affected.has(sentence.word))
  };
  const json = JSON.stringify(backup);
  try { localStorage.setItem("kanji-words-backup", json); } catch { /* sin sitio: queda el archivo */ }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  link.download = `yomipop-palabras-antes-de-limpiar-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function applyWordCleanup() {
  const { plan } = wordCleanup;
  $("cleanupApplyBtn").disabled = true;
  try {
    downloadWordBackup();
    const now = Date.now();
    // A dónde va cada clave: la nueva, o "" si se borra
    const target = new Map([...plan.drops.map(({ id }) => [id, ""]), ...plan.moves.map(({ from, to }) => [from, to])]);
    // Se guarda primero; solo después cambia lo que tiene la app en memoria
    const gone = plan.remove.map((id) => ({ id, lemma: userWords.get(id)?.lemma || "", reading: userWords.get(id)?.reading || "",
      deletedAt: now, updatedAt: now }));
    await putRecords("userWords", [...gone, ...plan.save]);
    for (const mark of gone) { userWords.delete(mark.id); deletedWords.set(mark.id, mark); }
    for (const rec of plan.save) userWords.set(rec.id, rec);
    await putRecords("words", plan.moves.map(({ from, to }) => lemmaEntry(savedWordFromId(to), words.get(from))).filter(Boolean));

    // Lo que nombra las palabras por su clave: la lista importada, la hoja de ruta y las frases de la web
    const rename = (ids) => [...new Set((ids || []).map((id) => target.has(id) ? target.get(id) : id).filter(Boolean))];
    if (meta.queue?.ids) meta.queue.ids = rename(meta.queue.ids);
    if (meta.roadmap?.words) meta.roadmap.words = rename(meta.roadmap.words);
    await saveMeta();
    const captured = [...userSentences.values()].filter((sentence) => sentence.source === "web" && target.get(sentence.word));
    for (const sentence of captured) Object.assign(sentence, { word: target.get(sentence.word), updatedAt: now });
    if (captured.length) { await putRecords("sentences", captured); forgetSentenceIndex(); }

    prefs.wordCleanup = 1;
    saveLocal("kanji-prefs", prefs);
    $("cleanupMessage").textContent = t("Hecho: {gone} palabras borradas y {moved} pasadas a su forma de diccionario. La copia se ha descargado.",
      { gone: plan.drops.length, moved: plan.moves.length });
    $("cleanupApplyBtn").classList.add("hidden");
    $("cleanupLaterBtn").textContent = t("Cerrar");
    wordCleanup = null;
    scheduleSync();
    updateCounts();
    renderAll();
  } catch (error) {
    console.error("No se pudo limpiar las palabras:", error);
    $("cleanupMessage").textContent = t("No se pudo aplicar. Inténtalo otra vez; la copia descargada tiene tus palabras de antes.");
    $("cleanupApplyBtn").disabled = false;
  }
}

const savedWordFromId = (id) => { const [lemma, reading] = id.split("|"); return { id, lemma, reading }; };

function bindWordCleanup() {
  $("cleanupApplyBtn").addEventListener("click", applyWordCleanup);
  $("cleanupLaterBtn").addEventListener("click", () => {
    if (wordCleanup) { prefs.wordCleanupLater = today(); saveLocal("kanji-prefs", prefs); } // se vuelve a proponer mañana
    wordCleanup = null;
    $("cleanupDialog").close();
  });
}
