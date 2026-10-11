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
