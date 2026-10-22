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

  /* Una sesión con una sola tarjeta, para preguntar justo esa palabra (o ese kanji) */
  const studyOne = (id, kind = "word") => page.evaluate(async (cardId, cardKind) => {
    if (cardKind === "kanji") await BANK.loadReadings();
    const entry = cardKind === "kanji" ? BANK.kanji.get(cardId) : BANK.words.get(cardId);
    const rec = (cardKind === "kanji" ? userKanji : userWords).get(cardId) || null;
    session = { queue: [{ kind: cardKind, id: cardId, entry, rec, group: "new" }], total: 1, done: 0, firstTry: 0,
      missed: new Map(), mode: "type", sentences: inSentences() };
    switchView("study");
    document.body.classList.add("studying");
    showCard();
  }, id, kind);
  const setSelect = (id, value) => page.evaluate((selectId, selected) => {
    $(selectId).value = selected;
    $(selectId).dispatchEvent(new Event("change"));
  }, id, value);
  const answer = async (typed) => {
    await page.evaluate((value) => { $("readingInput").value = value; $("checkBtn").click(); }, typed);
    await page.waitForSelector('[data-rate="good"], [data-rate="next"]', { timeout: 5000 });
  };

  await step("presentación «Palabra sola» (por defecto): la tarjeta es la de siempre", async () => {
    await page.evaluate(async () => { meta.reading.assumed = "N5"; await saveMeta(); }); // conoce el vocabulario de N5
    check(await page.evaluate(() => $("studyPresentation").value === "word" && !$("sentenceReviewInput")), "presentación inicial");
    await studyOne("学校|がっこう");
    check(await page.evaluate(() => !document.querySelector(".card-sentence") && !document.querySelector(".sent-missing") &&
      !!document.querySelector(".card-symbol")), "salió una frase");
  });

  await step("presentación: solo al escribir la lectura; con «Palabra sola» el contenido es solo palabras", async () => {
    await setSelect("studyMode", "flash");
    check(await page.evaluate(() => $("studyPresentation").closest(".field").classList.contains("hidden")), "se ve en Tarjetas");
    await setSelect("studyMode", "type");
    const state = await page.evaluate(() => ({
      shown: !$("studyPresentation").closest(".field").classList.contains("hidden"),
      kanji: $("studyType").querySelector('[value="kanji"]').disabled
    }));
    check(state.shown && state.kanji, JSON.stringify(state));
  });

  await step("presentación «En una frase»: la palabra dentro de una frase, corregida como siempre", async () => {
    await setSelect("studyPresentation", "sentence");
    check(await page.evaluate(() => prefs.studyPresentation === "sentence" &&
      !$("studyType").querySelector('[value="kanji"]').disabled), "el ajuste no se guardó");
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

  await step("en una frase: verbo conjugado, vale su lectura en la frase; un fallo sigue siendo fallo", async () => {
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
  });

  await step("en una frase: respuesta en katakana y con espacios", async () => {
    await studyOne("学校|がっこう");
    await answer("  ガッコウ ");
    check(await page.evaluate(() => $("feedback").classList.contains("correct")), "ガッコウ no se aceptó");
  });

  await step("en una frase: un kanji suelto se pregunta por cómo suena en su palabra", async () => {
    await studyOne("学", "kanji");
    const shown = await page.evaluate(() => ({
      target: document.querySelector(".sent-target")?.textContent,
      unit: document.querySelector(".sent-unit")?.textContent,
      ruby: !!document.querySelector(".sent-target rt"),
      input: !!$("readingInput")
    }));
    check(shown.target === "学" && shown.unit === "学校" && !shown.ruby && shown.input, JSON.stringify(shown));
    await page.evaluate(() => { $("readingInput").value = "がく"; $("checkBtn").click(); });
    check(await page.evaluate(() => !$("readingInput").disabled && $("feedback").textContent.length > 0 &&
      !$("feedback").classList.contains("incorrect")), "la lectura de diccionario contó como fallo");
    await answer("がっ");
    const after = await page.evaluate(() => ({
      ok: $("feedback").classList.contains("correct"),
      ruby: document.querySelector(".card-sentence.answered .sent-target rt")?.textContent,
      reading: document.querySelector("#answer .reading")?.textContent
    }));
    check(after.ok && after.ruby === "がっ" && after.reading.startsWith("がっ"), JSON.stringify(after));
    await shot(page, "frase-kanji");
    await page.evaluate(() => document.querySelector('[data-rate="good"]').click());
    await page.waitForFunction(() => userKanji.get("学")?.studied, { timeout: 5000 });
    const rec = await page.evaluate(() => ({ fsrs: !!userKanji.get("学").fsrs, meaning: userKanji.get("学").knowsMeaning,
      practice: meta.practice["学|がく"]?.n }));
    check(rec.fsrs && !rec.meaning && rec.practice === 3, JSON.stringify(rec));
  });

  await step("en una frase: sin frase, la palabra sola con aviso; el kanji, como tarjeta", async () => {
    const word = await page.evaluate(() => [...BANK.words.values()].find((w) => w.kanji.length && !w.kana && !sentencesFor(w.id).length).id);
    await studyOne(word);
    check(await page.evaluate(() => !!document.querySelector(".sent-missing") && !!document.querySelector(".card-symbol") &&
      !!$("readingInput")), "palabra sin frase");
    const kanji = await page.evaluate(() => [...BANK.kanji.values()].find((k) => meaningOf(k).length && !kanjiSentencesFor(k.c).length).c);
    await studyOne(kanji, "kanji");
    check(await page.evaluate(() => !!document.querySelector(".sent-missing") && !!$("revealBtn")), "kanji sin frase");
    // Se deja todo como estaba para los pasos siguientes
    await setSelect("studyPresentation", "word");
    await page.evaluate(async () => {
      session = null;
      document.body.classList.remove("studying");
      meta.reading.assumed = "";
      await saveMeta();
    });
    check(await page.evaluate(() => !Object.keys(meta.practice).some((tag) => tag.startsWith("友"))), "un fallo contó como practicado");
  });

  /* Con sesión imitada: la tabla shared_sentences y la función generate-sentences
     no se tocan de verdad, y no se sincroniza nada. restoreAccount lo deshace
     todo, también si el paso falla, para no arrastrar a los siguientes. */
  const fakeAccount = () => page.evaluate(async () => {
    window.realFrom = sb.from;
    window.realInvokeSentences = window.invokeSentences;
    window.realSchedule = window.scheduleSync;
    window.scheduleSync = () => {};
    window.sharedRows = [];
    window.invoked = [];
    window.invokeSentences = async (body) => { invoked.push(body); return { error: { message: "sin respuesta" } }; };
    sb.from = (table) => table === "shared_sentences"
      ? { upsert: async (rows) => { sharedRows.push(...rows); return { error: null }; } }
      : table === "dictionary" // el diccionario del servidor: sin sesión de verdad no se puede leer
        ? { select: () => ({ in: async () => ({ data: [], error: null }) }) }
        : realFrom.call(sb, table);
    sync.user = { id: "smoke" };
    meta.reading.assumed = "N5";
    try { localStorage.removeItem("kanji-sentence-asked"); } catch { /* sin almacenamiento */ }
  });
  const restoreAccount = () => page.evaluate(async () => {
    if (!window.realSchedule) return;
    sb.from = realFrom;
    window.invokeSentences = realInvokeSentences;
    window.scheduleSync = realSchedule;
    window.realSchedule = null;
    sync.user = null;
    sentenceWanted.clear();
    await putRecords("sharedSentences", [], [...sharedSentences.keys()]);
    sharedSentences.clear();
    forgetSentenceIndex();
    session = null;
    document.body.classList.remove("studying");
    meta.reading.assumed = "";
    await saveMeta();
  });

  await step("frases: primero las comunes; si no hay, la de una historia, que pasa a las compartidas", async () => {
    try {
      await fakeAccount();
      const state = await page.evaluate(async () => {
        const all = [...userSentences.values()];
        // Una palabra que solo sale en una historia (no en el texto pegado, que nunca se comparte)
        const inPasted = (id) => all.some((s) => s.source === "article" && s.targets.includes(id));
        const story = all.find((s) => s.source === "text" && s.targets.some((id) => BANK.words.get(id) && !inPasted(id)));
        const id = story.targets.find((target) => BANK.words.get(target) && !inPasted(target));
        const card = { kind: "word", id, entry: BANK.words.get(id) };
        const before = findSentence(card);
        const pick = sentenceForCard(card);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const after = findSentence(card);
        // Un texto pegado nunca se comparte
        shareSentence(all.find((s) => s.source === "article"));
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Una frase común gana a la de una historia
        const other = all.find((s) => s.source === "article" && s.targets.includes("学校|がっこう"));
        await uploadShared([{ ...other, id: "ai:prueba", source: "ai" }], true);
        const common = findSentence({ kind: "word", id: "学校|がっこう", entry: BANK.words.get("学校|がっこう") });
        return {
          id, story: story.id, before: [before.story, before.pick?.sentence.id], picked: pick?.sentence.id,
          after: [after.story, after.pick?.sentence.id], rows: sharedRows.map((row) => [row.id, row.source, row.words.includes(id)]),
          common: [common.story, common.pick?.sentence.id]
        };
      });
      check(state.before[0] === true && state.picked === state.story, JSON.stringify(state));
      check(state.rows.length === 2 && state.rows[0][0] === state.story && state.rows[0][1] === "text" && state.rows[0][2] &&
        state.rows[1][0] === "ai:prueba", JSON.stringify(state.rows));
      check(state.after[0] === false && state.after[1] === state.story, `después: ${JSON.stringify(state.after)}`);
      check(state.common[0] === false && state.common[1] === "ai:prueba", `común: ${JSON.stringify(state.common)}`);
    } finally {
      await restoreAccount();
    }
  });

  await step("frases: sin ninguna, se piden a la IA en segundo plano y las que valen se comparten", async () => {
    try {
      await fakeAccount();
      await setSelect("studyPresentation", "sentence");
      const word = await page.evaluate(() => ["山|やま", "川|かわ", "花|はな", "水|みず"].find((id) => !sentencesFor(id).length));
      await page.evaluate((id) => {
        const w = BANK.words.get(id).w;
        window.invokeSentences = async (body) => {
          invoked.push(body);
          return { error: null, data: { text: JSON.stringify({ batch: "app", sentences: [
            { targets: [id], ja: `私|は|${w}|を|見ました|。`, en: "I saw it.", es: "Lo vi." },
            { targets: [id], ja: `ABC|は|${w}|です|。`, en: "bad", es: "mala" },                        // letras latinas: no vale
            { targets: ["猫|ねこ"], ja: "私|は|猫|を|見ました|。", en: "I saw a cat.", es: "Vi un gato." } // no se pidió
          ] }) } };
        };
      }, word);
      await studyOne(word);
      check(await page.evaluate(() => !!document.querySelector(".sent-missing")), "sin aviso de que no hay frase");
      await page.waitForFunction(() => sharedRows.some((row) => row.source === "ai"), { timeout: 60000 });
      const state = await page.evaluate(() => ({
        calls: invoked.map((body) => [body.level, body.words.map((w) => `${w.w}|${w.r}`).join(), body.known.length > 0]),
        rows: sharedRows.map((row) => [row.words, row.data.tokens.map((t) => t.surface).join("")])
      }));
      check(state.calls.length === 1 && state.calls[0][1] === word && state.calls[0][2], JSON.stringify(state.calls));
      check(state.rows.length === 1 && state.rows[0][0].includes(word) && !state.rows[0][1].includes("ABC"), JSON.stringify(state.rows));
      // La siguiente vez sale en la frase, y no se vuelve a pedir
      await studyOne(word);
      check(await page.evaluate((id) => document.querySelector(".sent-target")?.textContent === BANK.words.get(id).w &&
        !document.querySelector(".sent-missing"), word), "no se usó la frase de la IA");
      await page.evaluate((id) => requestSentences([{ kind: "word", id, entry: BANK.words.get(id) }]), word);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      check(await page.evaluate(() => invoked.length === 1), "se volvió a pedir la misma palabra");
    } finally {
      await restoreAccount();
      await setSelect("studyPresentation", "word");
    }
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
        failed: $("failedList") ? null : null, score: scoreWord(BANK.words.get("飲む|のむ"), userWords.get("飲む|のむ"), new Set()) };
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

  await step("significados: las palabras en kana salen con su significado, también sin sesión", async () => {
    const meanings = await page.evaluate(async () => {
      const { text } = await validateText(JSON.stringify({ title: "かな", sentences: [{ p: 1, ja: "猫|が|います|。|この|ケーキ|は|とても|おいしく|なる|。", en: "x", es: "x" }] }));
      const dict = text.sentences[0].dictionary;
      return Object.fromEntries(["いる", "この", "ケーキ", "とても", "なる"].map((lemma) => [lemma, dict[lemma]?.meanings?.[0] || ""]));
    });
    check(/^to be/.test(meanings["いる"]) && meanings["この"] === "this" && meanings["ケーキ"] === "cake" &&
      meanings["とても"] === "very" && /^to become/.test(meanings["なる"]), JSON.stringify(meanings));
  });

  await step("homógrafos: cada aparición de una palabra con su propio sentido", async () => {
    const result = await page.evaluate(async () => {
      // Formato con tokens (el antiguo): la IA da la lectura de cada aparición
      const tok = (surface, lemma, reading, pos) => ({ surface, lemma, reading, pos });
      const { text } = await validateText(JSON.stringify({ title: "角", level: "N5", topic: "x", sentences: [{ id: 1, jp: "角の牛の角。", en: "x", es: "x",
        tokens: [tok("角", "角", "かど", "noun"), tok("の", "の", "の", "particle"), tok("牛", "牛", "うし", "noun"), tok("の", "の", "の", "particle"),
          tok("角", "角", "つの", "noun"), tok("。", "。", "。", "punctuation")] }] }));
      const s = text.sentences[0];
      const keys = s.tokens.filter((t) => t.surface === "角").map((t) => t.key);
      // El furigana de una palabra de una sola lectura lo pone el banco (kuromoji lee 雨 como う tras 一日中)
      const seg = await validateText(JSON.stringify({ title: "雨", sentences: [{ p: 1, ja: "一日中|雨|が|降っていた|。", en: "x", es: "x" }] }));
      const rain = seg.text.sentences[0].tokens.find((t) => t.surface === "雨");
      const counts = countLemmas(text);
      return { keys, meanings: keys.map((key) => s.entries[key].meanings[0]), rain: rain.reading, counted: Object.keys(counts.lemmas) };
    });
    check(JSON.stringify(result.keys) === '["角|かど","角|つの"]' && result.meanings[0] !== result.meanings[1], JSON.stringify(result));
    check(result.counted.includes("角|かど") && result.counted.includes("角|つの"), "cobertura: " + result.counted);
    check(result.rain === "あめ", `雨 se lee ${result.rain}`);
  });

  await step("significados: se reparan los guardados por una versión anterior", async () => {
    const result = await page.evaluate(async () => {
      // Un texto y una palabra como los dejaba la versión anterior: なる con el significado de 鳴る
      const wrong = BANK.words.get("鳴る|なる");
      const text = { id: "viejo-1", title: "viejo", titleEn: "", titleEs: "", topic: "x", level: "N5", source: "manual", status: "private",
        createdAt: 1, updatedAt: 1, readAt: null, lemmas: {}, total: 0,
        data: { sentences: [{ id: 1, jp: "なる", en: "", es: "", tokens: [{ surface: "なる", lemma: "なる", reading: "なる", pos: "verb" }],
          dictionary: { "なる": { reading: "なる", meanings: wrong.en, meanings_es: wrong.es, pos: "" } } }] } };
      texts.push(text);
      words.set("なる|なる", { id: "なる|なる", lemma: "なる", reading: "なる", meanings: wrong.en, meaningsEs: wrong.es, pos: "", source: "ai", updatedAt: 1 });
      prefs.kanaRepair = 0;
      await repairKanaMeanings();
      const after = { text: text.data.sentences[0].dictionary["なる"].meanings[0], word: words.get("なる|なる").meanings[0], flag: prefs.kanaRepair };
      texts = texts.filter((x) => x !== text);
      return after;
    });
    check(/^to become/.test(result.text) && /^to become/.test(result.word) && result.flag === 1, JSON.stringify(result));
  });

  await step("palabras nuevas: las decide el nivel de sus kanjis, no el de la palabra", async () => {
    const result = await page.evaluate(async () => {
      await BANK.loadUpTo("N1");
      const saved = meta.reading.level;
      meta.reading.level = "N5";
      const { list, excluded } = newWordCandidates();
      meta.reading.level = saved;
      const shown = new Set(list.map((card) => card.id));
      const levelOf = (c) => BANK.kanjiLevel(c);
      const known = knownKanji();
      // Ninguna propuesta lleva un kanji de un nivel superior que no conozca, salvo la excepción de varios kanjis
      const wrong = list.filter((card) => !card.info.manual && !card.rec?.knowsMeaning).filter((card) => {
        const above = card.entry.kanji.filter((c) => !known.has(c) && levelOf(c) !== "N5");
        if (!above.length) return false;
        return !(card.entry.kanji.length > 1 && card.entry.kanji.some((c) => known.has(c)) && card.entry.level === "N5");
      });
      const highWordEasyKanji = list.find((card) => card.entry.level !== "N5" && card.entry.kanji.every((c) => levelOf(c) === "N5"));
      return { total: list.length, waiting: excluded.length, wrong: wrong.map((card) => card.id).slice(0, 5), highWordEasyKanji: highWordEasyKanji?.id };
    });
    check(result.total > 0 && result.waiting > 0 && !result.wrong.length, JSON.stringify(result));
    check(!!result.highWordEasyKanji, "ninguna palabra de otro nivel con kanjis de N5");
  });

  await step("escritura: nivel a nivel, con repaso, y la prueba salta un nivel", async () => {
    const result = await page.evaluate(async () => {
      await BANK.loadUpTo("N1");
      $("drawLevel").value = "auto";
      const savedKanji = new Map(userKanji), savedMeta = meta.writing;
      userKanji = new Map(); meta.writing = {};
      drawTurn = 1;
      const first = pickDrawKanji();
      // La prueba de N5 aprobada: el siguiente kanji ya es de N4
      const n5 = kanjiByLevel().N5;
      const test = { level: "N5", queue: n5.slice(0, 8), results: n5.slice(0, 8).map((c) => ({ c, mistakes: 0, shown: false, hinted: false })) };
      switchView("draw");
      await finishWritingTest(test);
      const after = pickDrawKanji();
      const status = $("drawStatus").textContent;
      // Repaso: con kanjis ya escritos, cada reviewEvery sale uno de ellos
      drawTurn = STUDY_CONFIG.writing.reviewEvery;
      const review = pickDrawKanji();
      const out = { first: first.kanji.level, after: after.kanji.level, skipped: meta.writing.skipped, review: review.review, reviewLevel: review.kanji.level, status,
        written: [...userKanji.values()].filter((k) => k.canWrite).length };
      userKanji = savedKanji; meta.writing = savedMeta;
      return out;
    });
    check(result.first === "N5" && result.after === "N4" && result.skipped.join() === "N5", JSON.stringify(result));
    check(result.review === true && result.reviewLevel === "N5" && result.written === 8, JSON.stringify(result));
    check(/N4/.test(result.status), result.status);
  });

  await step("escritura: los trazos de un kanji llegan de KanjiVG (versión fija)", async () => {
    const strokes = await page.evaluate(async () => (await fetchStrokes("日")).length);
    check(strokes === 4, `日 tiene ${strokes} trazos`);
  });

  await step("diccionario: buscar en romaji abre la vista con resultados", async () => {
    await page.type("#dictInput", "mizu");
    await page.waitForSelector(".dict-row", { timeout: 5000 });
    check(await page.evaluate(() => document.body.dataset.view === "dict"), "no se abrió la vista");
    check(await page.evaluate(() => dictState.results[0].id === "水|みず"), "水 no es el primer resultado");
    // Como invitado tiene que decir claro que solo se busca en el banco
    await page.waitForFunction(() => dictState.remote === "guest" && $("dictNote").textContent.length > 20, { timeout: 30000 });
    check(await page.evaluate(() => BANK.loaded("N1")), "no se cargaron todos los niveles del banco");
    // Sin sesión también se busca en el diccionario general del dispositivo
    await page.evaluate(() => runDictSearch("ケーキ"));
    await page.waitForFunction(() => dictState.results.some((entry) => entry.w === "ケーキ") && dictState.local, { timeout: 30000 });
    await page.evaluate(() => runDictSearch("mizu"));
    await page.waitForFunction(() => dictState.remote === "guest", { timeout: 30000 });
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

  await step("sincronización: las frases de Traducir se suben, y sin la tabla no hay error", async () => {
    const result = await page.evaluate(async () => {
      const real = window.pushRows, sent = [];
      try {
        window.pushRows = async (table, conflict, rows, marks, pushed) => {
          if (rows.length) sent.push([table, rows.length, Object.keys(rows[0]).sort().join(",")]);
          for (const [k, v] of marks) pushed[k] = v;
        };
        sync.pushed.translations = {};
        await pushTranslations("u");
        const first = sent.length;
        await pushTranslations("u"); // ya subidas: no se repiten
        window.pushRows = async () => { throw { code: "PGRST205" }; };
        sync.pushed.translations = {};
        await pushTranslations("u"); // tabla que falta: no lanza
        return { first, again: sent.length, rows: sent[0] };
      } finally { window.pushRows = real; }
    });
    check(result.first === 1 && result.again === 1 && result.rows[0] === "user_translations" && result.rows[1] > 0, JSON.stringify(result));
    check(result.rows[2].includes("answer_key") && !result.rows[2].includes("email"), result.rows[2]);
  });

  await step("análisis: sin premium, el aviso; con premium, cada nivel, la gramática, la foto de la semana y su sincronización", async () => {
    const locked = await page.evaluate(() => {
      switchView("analysis");
      return { lock: $("analysisArea").textContent.includes(t("El análisis de tu progreso es parte del plan premium")),
        tiles: document.querySelectorAll("#analysisArea .stat-card").length };
    });
    check(locked.lock && !locked.tiles, JSON.stringify(locked));
    try {
      // Premium imitado: sin sincronizar de verdad
      await page.evaluate(() => {
        window.realSchedule = window.scheduleSync;
        window.scheduleSync = () => {};
        sync.user = { id: "smoke" };
        sync.config.plan = { plan: "premium", until: null };
        meta.snapshots = {};
        switchView("analysis");
      });
      await page.waitForSelector("#analysisArea .analysis-level", { timeout: 30000 });
      const state = await page.evaluate(() => {
        const panels = [...document.querySelectorAll("#analysisArea .chart-panel")];
        const words = [...BANK.words.values()].filter((w) => !w.kana && w.kanji.length);
        const legendTotal = (panel) => [...panel.querySelectorAll(".state-counts span")]
          .reduce((sum, span) => sum + Number(span.textContent.split(":").pop()), 0);
        return {
          levels: [...document.querySelectorAll("#analysisArea .analysis-level")].map((el) => el.textContent),
          rows: panels[0].querySelectorAll(".level-row").length,
          vocab: legendTotal(panels[0]) === words.length,
          kanji: legendTotal(panels[1]) === BANK.kanji.size,
          snapshot: Object.keys(meta.snapshots).join() === weekKey() && meta.snapshots[weekKey()].vocab.N5[3] > 0,
          tiles: document.querySelectorAll("#analysisArea .stat-card").length,
          // Gramática: lo traducido bien en Traducir (私は毎朝コーヒーを飲みます) cuenta como entendido
          grammar: meta.snapshots[weekKey()].grammar?.N5?.[3] === GRAMMAR.length,
          groups: document.querySelectorAll("#analysisArea .grammar-group").length,
          listed: document.querySelectorAll("#analysisArea .grammar-list li").length === GRAMMAR.length
        };
      });
      check(state.rows === 5 && state.vocab && state.kanji && state.snapshot && state.tiles === 10 &&
        state.grammar && state.groups >= 2 && state.listed &&
        state.levels.every((text) => text && text !== "undefined"), JSON.stringify(state));
      // La frase traducida (私は毎朝コーヒーを飲みます) acabó con «No lo sé»: sus estructuras quedan vistas.
      // Con una traducción buena después, pasan a entendidas.
      const grammar = await page.evaluate(async () => {
        const ids = ["wo", "masu", "wa"];
        const record = translationLog[translationLog.length - 1];
        const before = (await computeProfile({ grammar: true })).grammarStates;
        translationLog.push({ ...record, verdict: "correct", at: Date.now() });
        try {
          const after = (await computeProfile({ grammar: true })).grammarStates;
          return { last: record.verdict, before: ids.map((id) => before.get(id)), after: ids.map((id) => after.get(id)) };
        } finally { translationLog.pop(); }
      });
      check(grammar.last === "incorrect" && grammar.before.every((state) => state === "seen") &&
        grammar.after.every((state) => state === "understood"), JSON.stringify(grammar));
      await shot(page, "analisis");
      // La foto se sube con lo que espera progress_snapshots
      const sent = await page.evaluate(async () => {
        const real = window.pushRows, rows = [];
        window.pushRows = async (table, conflict, list, marks, pushed) => {
          rows.push([table, conflict, ...list.map((row) => Object.keys(row).sort().join())]);
          for (const [key, print] of marks) pushed[key] = print;
        };
        try { await pushSnapshots("smoke"); await pushSnapshots("smoke"); } finally { window.pushRows = real; }
        return rows;
      });
      check(sent.length === 2 && sent[0][0] === "progress_snapshots" && sent[0][2] === "client_updated_at,data,user_id,week" &&
        sent[1].length === 2, JSON.stringify(sent)); // la segunda vez ya no hay nada que subir
      // Premium caducado: vuelve el aviso
      const expired = await page.evaluate(() => {
        sync.config.plan = { plan: "premium", until: "2020-01-01T00:00:00Z" };
        switchView("analysis");
        return !document.querySelector("#analysisArea .stat-card");
      });
      check(expired, "con el premium caducado se ve el análisis");
    } finally {
      await page.evaluate(() => {
        if (window.realSchedule) window.scheduleSync = window.realSchedule;
        sync.user = null;
        sync.config.plan = null;
        switchView("study");
      });
    }
  });

  await step("lectura: al recargar en mitad de un texto se vuelve a él, con lo consultado", async () => {
    const before = await page.evaluate(async () => {
      const text = texts.find((x) => !x.readAt && !x.hiddenAt && x.data.sentences.length) || texts[0];
      if (text.readAt) text.readAt = null;
      await openText(text.id);
      const tok = document.querySelector("#readArea .tok");
      tok?.click();
      return { id: text.id, clicks: reader.clicks.size, toks: document.querySelectorAll("#readArea .tok").length, view: document.body.dataset.view };
    });
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForFunction(() => typeof reader !== "undefined" && reader, { timeout: 15000 });
    const after = await page.evaluate(() => ({ id: reader.text.id, clicks: reader.clicks.size }));
    check(after.id === before.id && after.clicks === before.clicks && before.clicks > 0, JSON.stringify({ before, after }));
    // "Salir" deja de volver a abrirlo solo
    await page.evaluate(() => $("readerCloseBtn").click());
    await page.reload({ waitUntil: "networkidle2" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check(await page.evaluate(() => !reader), "se volvió a abrir tras salir");
  });
}
