/* Pasos de la prueba de humo de las funciones nuevas (diccionario y frases).
   Los llama tools/smoke.mjs después de los pasos básicos. */
/* Con SMOKE_SHOTS=carpeta se guardan capturas para revisarlas a ojo */
async function shot(page, name) {
  const dir = process.env.SMOKE_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.setViewport({ width: 390, height: 800 });
  await page.screenshot({ path: `${dir}/${name}-movil.png` });
  await page.setViewport({ width: 800, height: 600 });
}

export default async function extra({ page, step, check }) {
  await step("sincronización: una base de datos sin migrar no bloquea las palabras buscadas", async () => {
    // Se imita a Supabase: rechaza el origen "diccionario" como haría la comprobación antigua
    const result = await page.evaluate(async () => {
      const real = window.pushRows, sent = [];
      window.pushRows = async (table, conflict, rows, marks, pushed) => {
        if (rows.some((row) => row.origin === "diccionario")) throw { code: "23514" };
        sent.push(...rows.map((row) => `${row.id}:${row.origin}`));
        for (const [key, print] of marks) pushed[key] = print;
      };
      const pushed = {};
      const rows = [{ id: "a", origin: "diccionario" }, { id: "b", origin: "manual" }, { id: "c", origin: null }];
      try {
        await pushProgress("user_words", rows, rows.map((row) => [row.id, "1"]), pushed);
      } finally { window.pushRows = real; }
      return { sent, pushed };
    });
    check(JSON.stringify(result.sent) === '["b:manual","c:null","a:lectura"]', JSON.stringify(result.sent));
    check(JSON.stringify(result.pushed) === '{"b":"1","c":"1"}', `marcadas: ${JSON.stringify(result.pushed)}`);
  });

  await step("sincronización: sin las columnas de Traducir se sigue subiendo el resto del progreso", async () => {
    const result = await page.evaluate(async () => {
      const real = window.pushRows, sent = [];
      // La base de datos no tiene meaning_*; la segunda vez tampoco tiene las de la fase 2
      const server = (missing) => async (table, conflict, rows, marks, pushed) => {
        if (rows.some((row) => missing.some((column) => column in row))) throw { code: "PGRST204" };
        sent.push(rows.map((row) => Object.keys(row).sort().join(",")));
        for (const [key, print] of marks) pushed[key] = print;
      };
      const rows = [{ id: "a", status: "learning", fsrs: { due: "x" }, origin: "lectura", meaning_correct: 1, meaning_wrong: 0, last_meaning_at: null }];
      const pushed = {};
      try {
        window.pushRows = server(["meaning_correct"]);
        await pushProgress("user_words", rows, [["a", "1"]], pushed);
        window.pushRows = server(["meaning_correct", "fsrs"]);
        await pushProgress("user_words", rows, [["a", "1"]], pushed);
        // Historial del día sin las columnas de traducciones
        const days = meta.days, pushedDays = sync.pushed.days;
        meta.days = { "2026-01-01": { r: 3, c: 2, n: 1 }, "2026-01-02": { r: 1, c: 1, n: 0, t: 2, tc: 1 } };
        sync.pushed.days = {};
        window.pushRows = server(["translations"]);
        await pushDays("u");
        const marks = { ...sync.pushed.days };
        meta.days = days; sync.pushed.days = pushedDays;
        return { sent, pushed, marks };
      } finally { window.pushRows = real; }
    });
    check(result.sent[0][0] === "fsrs,id,origin,status" && result.sent[1][0] === "id,status", JSON.stringify(result.sent));
    check(JSON.stringify(result.pushed) === "{}", "se marcó como subido sin estar completo");
    check(result.sent[2].every((keys) => !keys.includes("translations")), "se enviaron columnas que no existen");
    check(result.marks["2026-01-01"] === "3,2,1" && !result.marks["2026-01-02"], JSON.stringify(result.marks));
  });

  const STUDY_CONFIG_DAYS = await page.evaluate(() => STUDY_CONFIG.masteredIntervalDays);
  await step("frases: el texto guardado deja sus frases, con palabras que preguntar", async () => {
    await page.waitForFunction(() => userSentences.size > 0 && prefs.sentenceIndex === SENTENCE_INDEX_VERSION, { timeout: 60000 });
    const sentence = await page.evaluate(() => [...userSentences.values()][0]);
    check(sentence.ja === "私|は|毎朝|コーヒー|を|飲みます|。" && sentence.source === "text", JSON.stringify(sentence.ja));
    check(sentence.targets.includes("毎朝|まいあさ") && sentence.targets.includes("飲む|のむ"), `targets: ${sentence.targets}`);
    check(sentence.kanjiReadings.includes("飲|の") && sentence.level === "N5", `${sentence.kanjiReadings} ${sentence.level}`);
  });

  await step("texto pegado: se analiza sin IA, queda solo en el dispositivo y deja frases", async () => {
    await page.evaluate(() => switchView("library"));
    await page.evaluate((value) => { $("textInput").value = value; },
      "学校の一日\n私は毎朝七時に起きて、学校へ行きます。学校で友達と日本語を勉強します。\n「今日は楽しかったです。」と母に言いました。");
    await page.evaluate(() => $("addTextBtn").click());
    await page.waitForFunction(() => texts.some((text) => text.source === "paste"), { timeout: 120000 });
    const state = await page.evaluate(() => {
      const text = texts.find((x) => x.source === "paste");
      const mine = [...userSentences.values()].filter((s) => s.sourceId === text.id);
      return {
        title: text.title, local: text.local, n: text.data.sentences.length,
        jp: text.data.sentences.map((s) => s.jp), translated: text.data.sentences.some((s) => s.en || s.es),
        sentences: mine.map((s) => [s.ja, s.source, s.local, s.targets]),
        wouldUpload: texts.filter((x) => isOwnText(x) && !x.local).some((x) => x.id === text.id),
        pending: pendingOwnText()?.id === text.id
      };
    });
    check(state.title === "学校の一日" && state.local === true && state.n === 3, JSON.stringify(state));
    check(state.jp[2] === "「今日は楽しかったです。」と母に言いました。", state.jp[2]);
    check(!state.translated && !state.wouldUpload && !state.pending, "traducción, subida o pendiente indebidos");
    check(state.sentences.length >= 2 && state.sentences.every((s) => s[1] === "article" && s[2] === true), JSON.stringify(state.sentences));
    check(state.sentences.some((s) => s[3].includes("学校|がっこう")), "学校 no es target");
  });

  /* Una sesión con una sola tarjeta, para preguntar justo esa palabra */
  const studyOne = (id) => page.evaluate((wordId) => {
    const entry = BANK.words.get(wordId), rec = userWords.get(wordId) || null;
    session = { queue: [{ kind: "word", id: wordId, entry, rec, group: "new" }], total: 1, done: 0, firstTry: 0, missed: new Map(), mode: "type" };
    switchView("study");
    document.body.classList.add("studying");
    showCard();
  }, id);
  const answer = async (typed) => {
    await page.evaluate((value) => { $("readingInput").value = value; $("checkBtn").click(); }, typed);
    await page.waitForSelector('[data-rate="good"], [data-rate="next"]', { timeout: 5000 });
  };

  await step("repasar con frases: desactivado, la tarjeta es la de siempre", async () => {
    await page.evaluate(async () => { meta.reading.assumed = "N5"; await saveMeta(); }); // conoce el vocabulario de N5
    await studyOne("学校|がっこう");
    check(await page.evaluate(() => !document.querySelector(".card-sentence") && !!document.querySelector(".card-symbol")), "salió una frase");
  });

  await step("repasar con frases: la palabra dentro de una frase, corregida como siempre", async () => {
    await page.evaluate(() => { $("sentenceReviewInput").click(); });
    check(await page.evaluate(() => prefs.sentenceReview === true), "el ajuste no se guardó");
    await studyOne("学校|がっこう");
    const shown = await page.evaluate(() => ({
      target: document.querySelector(".sent-target")?.textContent,
      ruby: !!document.querySelector(".sent-target rt"),
      line: document.querySelector(".card-sentence")?.textContent
    }));
    check(shown.target === "学校" && !shown.ruby && shown.line.includes("学校"), JSON.stringify(shown));
    await shot(page, "frase-pregunta");
    await answer("がっこう");
    const after = await page.evaluate(() => ({
      ok: $("feedback").classList.contains("correct"),
      ruby: document.querySelector(".card-sentence.answered .sent-target rt")?.textContent,
      stats: [...sentenceStats.values()].map((s) => s.shown)
    }));
    check(after.ok && after.ruby === "がっこう" && after.stats.join() === "1", JSON.stringify(after));
    await shot(page, "frase-respuesta");
    await page.evaluate(() => document.querySelector('[data-rate="good"]').click());
    await page.waitForFunction(() => userWords.get("学校|がっこう")?.studied, { timeout: 5000 });
  });

  await step("repasar con frases: verbo conjugado, vale su lectura en la frase; un fallo sigue siendo fallo", async () => {
    await studyOne("行く|いく");
    check(await page.evaluate(() => document.querySelector(".sent-target")?.textContent === "行きます"), "no salió 行きます");
    await answer("いきます");
    check(await page.evaluate(() => $("feedback").classList.contains("correct")), "いきます no se aceptó");
    await page.evaluate(() => document.querySelector('[data-rate="good"]').click());
    await page.waitForFunction(() => !document.querySelector('[data-rate]') || !session, { timeout: 5000 });
    // Estadísticas: las lecturas de kanji acertadas en una frase (el fallo de abajo no cuenta)
    const practice = await page.evaluate(() => { switchView("progress"); return { meta: meta.practice, n: $("statKanjiReadings").textContent,
      list: $("kanjiReadingList").textContent }; });
    check(practice.meta["学|がく"]?.n === 1 && practice.meta["校|こう"]?.n === 1 && practice.meta["行|い"]?.n === 1, JSON.stringify(practice.meta));
    check(practice.n === "3" && practice.list.includes("がく"), `tarjeta: ${practice.n}`);
    await studyOne("友達|ともだち");
    check(await page.evaluate(() => document.querySelector(".sent-target")?.textContent === "友達"), "no salió 友達 en una frase");
    await answer("ともたち");
    check(await page.evaluate(() => $("feedback").classList.contains("incorrect") && userWords.get("友達|ともだち").incorrectCount === 1), "el fallo no se registró");
    // Se deja todo como estaba para los pasos siguientes
    await page.evaluate(async () => {
      session = null;
      document.body.classList.remove("studying");
      meta.reading.assumed = "";
      await saveMeta();
    });
    check(await page.evaluate(() => !Object.keys(meta.practice).some((tag) => tag.startsWith("友"))), "un fallo contó como practicado");
  });

  await step("traducir: se propone una frase con traducción, nunca una de un texto pegado", async () => {
    const state = await page.evaluate(() => ({
      all: userSentences.size, candidates: translationCandidates().map((s) => [s.ja, s.source]),
      next: nextTranslationSentence()?.ja
    }));
    check(state.candidates.length === 1 && state.candidates[0][1] === "text" && state.all > 1, JSON.stringify(state));
    check(state.next === "私|は|毎朝|コーヒー|を|飲みます|。", `siguiente: ${state.next}`);
  });

  const typeAnswer = (value) => page.evaluate((text) => {
    $("trInput").value = text;
    $("trInput").dispatchEvent(new Event("input"));
  }, value);

  await step("traducir: la frase, el contador y las respuestas que no se corrigen", async () => {
    await page.evaluate(() => switchView("translate"));
    await page.waitForSelector("#trInput", { timeout: 10000 });
    check(await page.evaluate(() => document.querySelector(".translate-card .card-sentence").textContent.includes("コーヒー")), "no salió la frase");
    check(await page.evaluate(() => $("trInput").maxLength === STUDY_CONFIG.translate.answerMax), "sin límite de caracteres");
    await page.evaluate(() => $("trCheckBtn").click());
    check(await page.evaluate(() => $("trFeedback").classList.contains("incorrect") && translating.phase === "answer"), "aceptó una respuesta vacía");
    await typeAnswer("  ¡¡ a !! ");
    await page.evaluate(() => $("trCheckBtn").click());
    check(await page.evaluate(() => translating.phase === "answer" && translationLog.length === 0), "aceptó una respuesta demasiado corta");
    await typeAnswer("Bebo café");
    check(await page.evaluate(() => $("trCount").textContent.startsWith("9 /")), "el contador no cuenta");
    await shot(page, "traducir-pregunta");
  });

  await step("traducir: tocar una palabra la anota como consultada", async () => {
    await page.evaluate(() => document.querySelector(".tr-tok").click());
    const state = await page.evaluate(() => ({ lookups: [...translating.lookups], gloss: $("trGloss").textContent, typed: $("trInput").value }));
    check(state.lookups.length === 1 && state.lookups[0] === "私|わたし" && state.gloss.includes("わたし"), JSON.stringify(state));
    check(state.typed === "Bebo café", "se perdió lo escrito");
  });

  await step("traducir: sin IA, el estudiante se corrige con la referencia; No lo sé y Saltar", async () => {
    await typeAnswer("Tomo   café\ncada mañana"); // una paráfrasis: no coincide con la referencia
    await page.keyboard.down("Control"); await page.focus("#trInput"); await page.keyboard.press("Enter"); await page.keyboard.up("Control");
    await page.waitForSelector('[data-tr-self="correct"]', { timeout: 5000 });
    check(await page.evaluate(() => translating.answer === "Tomo café cada mañana"), "la respuesta no se normalizó");
    await page.evaluate(() => document.querySelector('[data-tr-self="correct"]').click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    let last = await page.evaluate(() => translationLog[translationLog.length - 1]);
    check(last.source === "self" && last.verdict === "correct" && last.lookups.length === 1, JSON.stringify(last));
    await shot(page, "traducir-resultado");
    // Progreso: medio punto por corregirse uno mismo; la palabra consultada no suma; el día cuenta
    const progress = await page.evaluate(() => ({
      looked: userWords.get("私|わたし"), word: userWords.get("毎朝|まいあさ"), verb: userWords.get("飲む|のむ"), day: meta.days[today()]
    }));
    check(progress.word.meaningCorrect === 0.5 && !progress.word.knowsMeaning, JSON.stringify(progress.word));
    check(!progress.looked.meaningCorrect && progress.looked.lookups >= 1, JSON.stringify(progress.looked));
    check(progress.day.t === 1 && progress.day.tc === 1, JSON.stringify(progress.day));
    check(!progress.verb.studied && !progress.verb.fsrs, "se creó una tarjeta de repaso");
    await page.evaluate(() => $("trNextBtn").click());
    await page.waitForSelector("#trSkipBtn", { timeout: 5000 });
    await page.evaluate(() => $("trSkipBtn").click());
    await page.waitForFunction(() => translationLog.length === 2 && translationLog[1].source === "skip", { timeout: 5000 });
    check(await page.evaluate(() => meta.days[today()].t === 1), "saltar contó en el historial");
  });

  await step("traducir: igual que la referencia se acepta sin IA, y una respuesta repetida reutiliza su corrección", async () => {
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("i drink coffee every morning");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    let last = await page.evaluate(() => translationLog[translationLog.length - 1]);
    check(last.source === "local" && last.verdict === "correct" && last.result.words.every((w) => w.understood === true), JSON.stringify(last));
    check(await page.evaluate(() => $("trResult").textContent.includes(t("Coincide con la traducción de referencia."))), "falta el aviso");
    await page.evaluate(() => $("trNextBtn").click());
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("I drink COFFEE every morning!!");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    check(await page.evaluate(() => translating.result.cached === true && translationLog[translationLog.length - 1].result.cached === undefined), "no se reutilizó");
    await page.evaluate(() => $("trNextBtn").click());
  });

  await step("traducir: como invitado se explica por qué no corrige la IA", async () => {
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("Yo tomo un café por las mañanas");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector('[data-tr-self="partial"]', { timeout: 5000 });
    check(await page.evaluate(() => translating.notice === aiUnavailable() && translating.notice.length > 20 &&
      document.querySelector(".translate-card").textContent.includes(translating.notice)), "falta el aviso");
    await page.evaluate(() => document.querySelector('[data-tr-self="partial"]').click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    await page.evaluate(() => $("trNextBtn").click());
  });

  await step("traducir: con la IA (imitada), su corrección se enseña y se guarda; si falla, se corrige el estudiante", async () => {
    // La función de Supabase se imita: aquí no se llama a ninguna IA
    await page.evaluate(() => {
      window.realUnavailable = window.aiUnavailable;
      window.aiUnavailable = () => "";
      window.sentBodies = [];
      window.fakeGrade = { data: { requestId: "req-smoke-1", model: "falso", promptVersion: "v", result: {
        verdict: "mostly", score: 78, feedback: "Casi: te faltó «cada mañana».", better: "Bebo café todas las mañanas.", grammar_note: "",
        words: [{ i: 0, lemma: "私", understood: null, note: "" }, { i: 2, lemma: "毎朝", understood: false, note: "todas las mañanas" },
          { i: 3, lemma: "コーヒー", understood: true, note: "" }, { i: 5, lemma: "飲む", understood: true, note: "" }] } }, error: null };
      window.invokeGrade = async (body) => { sentBodies.push(["grade-translation", body]); return fakeGrade; };
    });
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("Bebo café");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    const state = await page.evaluate(() => ({ sent: sentBodies[0], last: translationLog[translationLog.length - 1], text: $("trResult").textContent }));
    check(state.sent[0] === "grade-translation" && state.sent[1].answer === "Bebo café" && state.sent[1].ja === "私は毎朝コーヒーを飲みます。", JSON.stringify(state.sent));
    check(JSON.stringify(Object.keys(state.sent[1]).sort()) === '["answer","ja","lang","reference","requestId","sentenceId","units"]', "campos de más en la petición");
    check(state.sent[1].units.filter((u) => u.content).length === 4, "palabras con contenido");
    check(state.last.source === "ai" && state.last.verdict === "mostly" && state.last.result.words[1].key === "毎朝|まいあさ" &&
      state.last.result.words[1].understood === false, JSON.stringify(state.last.result));
    check(state.text.includes("78") && state.text.includes("Casi: te faltó") && state.text.includes("Bebo café todas las mañanas."), state.text);
    await shot(page, "traducir-ia");

    // Fichas por palabra, con icono y texto; la nota sale al tocarla
    const chips = await page.evaluate(() => {
      document.querySelector(".tr-chip-no").click();
      return { n: document.querySelectorAll(".tr-chip").length, no: document.querySelector(".tr-chip-no").textContent,
        note: $("trChipNote").textContent, live: $("trResult").getAttribute("aria-live") };
    });
    check(chips.n === 4 && chips.no.includes("毎朝") && chips.note.includes("todas las mañanas") && chips.live === "polite", JSON.stringify(chips));
    let word = await page.evaluate(() => userWords.get("毎朝|まいあさ"));
    check(word.status === "learning" && word.meaningWrong === 1 && word.meaningCorrect === 0, `tras la IA: ${JSON.stringify(word)}`);
    const dayBefore = await page.evaluate(() => ({ ...meta.days[today()] }));

    // No estoy de acuerdo: se deshace el fallo y cuenta como entendida, con menos peso
    await page.evaluate(() => $("trContestBtn").click());
    await page.waitForFunction(() => translating?.result?.source === "contested" && !$("trContestBtn"), { timeout: 5000 });
    const contested = await page.evaluate(() => ({ word: userWords.get("毎朝|まいあさ"), last: translationLog[translationLog.length - 1],
      day: meta.days[today()], text: $("trResult").textContent }));
    check(contested.word.status !== "learning" && !contested.word.meaningWrong && contested.word.meaningCorrect === 0.5, JSON.stringify(contested.word));
    check(contested.last.contested === true && contested.last.source === "contested" && contested.last.result.original.verdict === "mostly", "registro");
    check(contested.day.t === dayBefore.t && contested.day.tc === dayBefore.tc, "el día contó dos veces");
    await page.evaluate(() => $("trNextBtn").click());

    // La corrección discutida no se reutiliza: la misma respuesta vuelve a la IA
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("Bebo café");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    check(await page.evaluate(() => sentBodies.length === 2 && !translating.result.cached), "reutilizó una corrección discutida");
    await page.evaluate(() => $("trNextBtn").click());

    // La función responde con un error de cuota: no se bloquea, se corrige él mismo
    await page.evaluate(() => { fakeGrade = { data: null, error: { context: { status: 503, json: async () => ({ error: "quota" }) } } }; });
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("Por la mañana tomo café");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector('[data-tr-self="correct"]', { timeout: 5000 });
    check(await page.evaluate(() => translating.notice === gradingMessage("quota")), "mensaje de cuota");
    // Sin desplegar (404): mensaje de "no configurada"
    await page.evaluate(() => document.querySelector('[data-tr-self="correct"]').click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    await page.evaluate(() => { $("trNextBtn").click(); fakeGrade = { data: null, error: { context: { status: 404, json: async () => ({}) } } }; });
    await page.waitForSelector("#trInput", { timeout: 5000 });
    await typeAnswer("Cada mañana me tomo un café");
    await page.evaluate(() => $("trCheckBtn").click());
    await page.waitForSelector('[data-tr-self="correct"]', { timeout: 5000 });
    check(await page.evaluate(() => translating.notice === gradingMessage("not_configured")), "mensaje de no configurada");
    await page.evaluate(() => document.querySelector('[data-tr-self="correct"]').click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    await page.evaluate(() => { window.aiUnavailable = window.realUnavailable; $("trNextBtn").click(); });
  });

  await step("traducir: No lo sé cuenta como fallo, no toca el repaso y la frase deja de proponerse", async () => {
    await page.waitForSelector("#trUnknownBtn", { timeout: 5000 });
    // Una palabra de la frase ya tiene su tarjeta de repaso: tiene que quedar igual
    const before = await page.evaluate(async () => {
      const rec = userWords.get("毎朝|まいあさ");
      applyCard(rec, masteredCard(30));
      await saveUserWord(rec);
      return JSON.stringify([rec.fsrs, rec.nextReview, rec.interval, rec.repetitions]);
    });
    await page.evaluate(() => $("trUnknownBtn").click());
    await page.waitForSelector("#trNextBtn", { timeout: 5000 });
    const state = await page.evaluate(() => {
      const rec = userWords.get("毎朝|まいあさ");
      return { last: translationLog[translationLog.length - 1], rec, cards: JSON.stringify([rec.fsrs, rec.nextReview, rec.interval, rec.repetitions]),
        failed: $("failedList") ? null : null, score: scoreWord(BANK.words.get("飲む|のむ"), userWords.get("飲む|のむ"), new Set(), new Set()) };
    });
    check(state.last.source === "unknown" && state.last.verdict === "incorrect", JSON.stringify(state.last));
    check(state.rec.status === "learning" && state.rec.meaningWrong >= 1 && state.rec.meaningCorrect === 0 && state.rec.knowsMeaning === false, JSON.stringify(state.rec));
    check(state.cards === before, "cambió la tarjeta de repaso");
    check(state.score.meaningFail === true, "sin prioridad entre las palabras nuevas");
    await page.evaluate(() => $("trNextBtn").click());
    // Demasiadas palabras sin conocer: no quedan frases y sale el resumen de la tanda
    await page.waitForSelector("#trAgainBtn", { timeout: 5000 });
    const summary = await page.evaluate(() => $("translateArea").textContent);
    check(/\d+ (frases|sentences)/.test(summary) && summary.includes("毎朝"), summary.slice(0, 200));
    await shot(page, "traducir-resumen");
    await page.evaluate(() => switchView("progress"));
    await page.waitForFunction(() => $("failedList").textContent.includes("毎朝"), { timeout: 5000 }); // "Las que más fallas"
    await page.evaluate(() => { translating = null; switchView("read"); });
  });

  await step("diccionario: buscar en romaji abre la vista con resultados", async () => {
    await page.type("#dictInput", "mizu");
    await page.waitForSelector(".dict-row", { timeout: 5000 });
    check(await page.evaluate(() => document.body.dataset.view === "dict"), "no se abrió la vista");
    check(await page.evaluate(() => dictState.results[0].id === "水|みず"), "水 no es el primer resultado");
    // Como invitado tiene que decir claro que solo se busca en el banco
    await page.waitForFunction(() => dictState.remote === "guest" && $("dictNote").textContent.length > 20, { timeout: 30000 });
    check(await page.evaluate(() => BANK.loaded("N1")), "no se cargaron todos los niveles del banco");
  });

  await step("diccionario: la ficha de un resultado", async () => {
    await page.click(".dict-row");
    await page.waitForSelector(".dict-card", { timeout: 5000 });
    const text = await page.evaluate(() => document.querySelector(".dict-card").textContent);
    check(text.includes("みず") && text.includes("N5"), "faltan la lectura o el nivel");
    await shot(page, "diccionario-ficha");
  });

  await step("diccionario: abrir la ficha anota la consulta sin dar la palabra por conocida", async () => {
    const state = await page.evaluate(() => {
      const rec = userWords.get("水|みず");
      const first = newWordCandidates().list[0];
      return { origin: rec?.origin, status: rec?.status, lookups: rec?.lookups, studied: !!rec?.studied,
        known: knownLemmas().has("水"), covered: isKnownKey("水|みず", knownLemmas()),
        first: first.id, info: first.info,
        prompt: promptParams({ type: "short story", topic: "food", length: 50 }) };
    });
    check(state.origin === "diccionario" && state.status === "unknown" && state.lookups === 1 && !state.studied,
      `registro: ${JSON.stringify(state)}`);
    check(!state.known && !state.covered, "cuenta como conocida");
    check(!state.prompt.known.includes("水") && state.prompt.learning[0] === "水", "prompt: " + JSON.stringify(state.prompt.learning));
    check(state.first === "水|みず" && state.info.dictionary && state.info.lookup > 0.99 && !state.info.reading,
      `no es la primera palabra nueva: ${state.first} ${JSON.stringify(state.info)}`);
  });

  await step("diccionario: Estudiar esta palabra y Ya la domino", async () => {
    await page.evaluate(() => document.querySelector('[data-dict-mark="learn"]').click());
    await page.waitForFunction(() => userWords.get("水|みず")?.origin === "manual", { timeout: 5000 });
    let rec = await page.evaluate(() => userWords.get("水|みず"));
    check(rec.status === "learning" && !rec.studied, `tras Estudiar: ${rec.status}`);
    check(await page.evaluate(() => newWordCandidates().list[0].info.manual), "no tiene la prioridad de a mano");
    await page.evaluate(() => document.querySelector('[data-dict-mark="mastered"]').click());
    await page.waitForFunction(() => userWords.get("水|みず")?.status === "mastered", { timeout: 5000 });
    rec = await page.evaluate(() => userWords.get("水|みず"));
    check(rec.studied && rec.interval === STUDY_CONFIG_DAYS, `tras Ya la domino: ${rec.interval}`);
  });
}
