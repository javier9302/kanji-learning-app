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

  await step("«Palabra sola»: una casilla por kanji; cada lectura se anota en su kanji", async () => {
    await studyOne("前置き|まえおき");
    const shown = await page.evaluate(() => ({
      boxes: [...document.querySelectorAll(".reading-box .box-kanji")].map((el) => el.textContent),
      kana: [...document.querySelectorAll(".reading-boxes .box-kana")].map((el) => el.textContent)
    }));
    check(shown.boxes.join() === "前,置" && shown.kana.join() === "き", JSON.stringify(shown));
    await shot(page, "casillas");
    // Enter en la primera pasa a la segunda; la segunda, mal
    const moved = await page.evaluate(() => {
      const [first, second] = document.querySelectorAll(".box-input");
      first.value = "まえ";
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const focused = document.activeElement === second;
      second.value = "おく";
      $("checkBtn").click();
      return focused;
    });
    check(moved, "Enter no pasó a la siguiente casilla");
    await page.waitForSelector('[data-rate="next"]', { timeout: 5000 });
    await shot(page, "casillas-fallo");
    const wrong = await page.evaluate(() => ({
      marks: [...document.querySelectorAll(".reading-box")].map((el) => el.classList.contains("box-ok") ? "ok" : "ko"),
      shown: document.querySelectorAll(".reading-box .box-answer")[1].textContent,
      mae: userKanji.get("前")?.readings, oki: userKanji.get("置")?.readings, word: userWords.get("前置き|まえおき")?.incorrectCount
    }));
    check(wrong.marks.join() === "ok,ko" && wrong.shown === "お" && wrong.mae?.まえ?.ok === 1 && wrong.oki?.お?.ko === 1 && wrong.word === 1,
      JSON.stringify(wrong));
    // 上手: suena じょう y cuenta para la lectura じょう de 上 (no la しょう de bank/readings.js)
    await studyOne("上手|じょうず");
    await page.evaluate(() => {
      const [first, second] = document.querySelectorAll(".box-input");
      first.value = "じょう"; second.value = "ず";
      $("checkBtn").click();
    });
    await page.waitForSelector('[data-rate="good"]', { timeout: 5000 });
    check(await page.evaluate(() => $("feedback").classList.contains("correct") && userKanji.get("上")?.readings?.じょう?.ok === 1),
      "上手 no contó para 上 じょう");
    await page.evaluate(() => document.querySelector('[data-rate="good"]').click());
    // Sin casillas (Ajustes → Repaso): una sola, como antes
    await page.evaluate(() => { $("kanjiBoxesInput").checked = false; $("kanjiBoxesInput").dispatchEvent(new Event("change")); });
    await studyOne("前置き|まえおき");
    check(await page.evaluate(() => !!$("readingInput") && !document.querySelector(".reading-box")), "siguen las casillas");
    await page.evaluate(() => { $("kanjiBoxesInput").checked = true; $("kanjiBoxesInput").dispatchEvent(new Event("change")); });
  });

  await step("práctica extra: cada botón dice cuándo vuelve o «sin cambios», Fácil la aleja y no se repite el mismo día", async () => {
    // 上手: dominada hace 10 días, vuelve dentro de 20. Como práctica extra (aún no le toca)
    const shown = await page.evaluate(async () => {
      const rec = userWords.get("上手|じょうず") || blankUserWord("上手", "じょうず");
      applyCard(rec, masteredCard(30, new Date(Date.now() - 10 * DAY_MS)));
      Object.assign(rec, { status: "mastered", lastReviewed: new Date(Date.now() - 10 * DAY_MS).toISOString() });
      await saveUserWord(rec);
      window.extraBefore = rec.nextReview;
      const card = { kind: "word", id: rec.id, entry: BANK.words.get(rec.id), rec, group: "extra" };
      session = { queue: [card], total: 1, done: 0, firstTry: 0, missed: new Map(), mode: "flash", sentences: false };
      document.body.classList.add("studying");
      showCard();
      $("revealBtn").click();
      return Object.fromEntries([...document.querySelectorAll("[data-rate]")].map((b) => [b.dataset.rate, b.querySelector("small").textContent]));
    });
    await shot(page, "practica-extra");
    check(Object.values(shown).every((text) => text.includes("·")), JSON.stringify(shown));
    check(!/sin cambios|no change/.test(shown.easy), JSON.stringify(shown));
    // Repasada ahora mismo: repetirla ya no la aleja, y lo dice
    const same = await page.evaluate(() => {
      const rec = { ...userWords.get("上手|じょうず") };
      applyCard(rec, masteredCard(30));
      return extraOutcome({ group: "extra", rec }, "hard");
    });
    check(same?.keep === true, JSON.stringify(same));
    await page.evaluate(() => document.querySelector('[data-rate="easy"]').click());
    await page.waitForFunction(() => !session || !document.querySelector('[data-rate]'), { timeout: 5000 });
    const after = await page.evaluate(() => {
      const rec = userWords.get("上手|じょうず");
      const extra = studyCards().extra.map((card) => card.id);
      return { before: window.extraBefore, now: rec.nextReview, inExtra: extra.includes(rec.id) };
    });
    check(after.now > after.before, JSON.stringify(after));
    // Sigue entre las «extra» posibles, pero una sesión no la vuelve a poner hoy
    await page.evaluate(() => { $("studyMode").value = "flash"; $("studyCount").value = "0"; });
    await page.evaluate(() => startSession());
    const again = await page.evaluate(() => (session?.queue || []).some((card) => card.id === "上手|じょうず"));
    check(!again, "上手 vuelve a salir hoy como práctica extra");
    await page.evaluate(() => {
      session = null; document.body.classList.remove("studying");
      $("studyMode").value = "type"; $("studyCount").value = "10"; switchView("study");
    });
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

  await step("palabras nuevas: el orden por kanjis (puente, desbloqueo, lecturas), rápido, con su porqué y la depuración", async () => {
    const result = await page.evaluate(async () => {
      await ensureStudyBank();
      const savedWords = new Map(userWords), savedReading = meta.reading;
      try {
        // Solo conoce 名前: lo primero no debe traer dos kanjis nuevos si hay de una sola cosa nueva
        userWords = new Map();
        meta.reading = { ...meta.reading, level: "N5", assumed: "" };
        const rec = blankUserWord("名前", "なまえ");
        Object.assign(rec, { status: "mastered", studied: true, canReadKanji: true });
        userWords.set(rec.id, rec);
        newWordCandidates(); // la primera vez prepara las lecturas de cada palabra
        const started = performance.now();
        const { list } = newWordCandidates();
        const ms = performance.now() - started;
        const top = list.slice(0, 20);
        const yuumei = list.find((card) => card.id === "有名|ゆうめい");
        return {
          ms, twoNew: top.filter((card) => card.info.ranked?.novelty.newKanji.length >= 2).map((card) => card.id),
          yuumei: yuumei && { bridge: yuumei.info.ranked.parts.bridge, why: whyText(yuumei.info) },
          parts: Object.keys(top[0].info.ranked.parts).join()
        };
      } finally {
        userWords = savedWords;
        meta.reading = savedReading;
      }
    });
    check(result.ms < 200, `el orden tarda ${Math.round(result.ms)} ms`);
    check(!result.twoNew.length, `con dos kanjis nuevos entre las 20 primeras: ${result.twoNew.join(" ")}`);
    check(result.yuumei?.bridge === 0.8 && result.yuumei.why.includes("めい") && result.yuumei.why.includes("有"), JSON.stringify(result.yuumei));
    check(result.parts === "frequency,bridge,unlock,coverage,topic", result.parts);
    // Depuración: las 100 primeras con cada componente
    const debug = await page.evaluate(async () => {
      prefs.debugStudy = true;
      session = null;
      switchView("study");
      await renderStudyHome();
      const rows = document.querySelectorAll(".ranking-table")[0]?.querySelectorAll("tbody tr").length;
      prefs.debugStudy = false;
      return { rows, cols: document.querySelector(".ranking-table thead tr")?.children.length };
    });
    check(debug.rows === 100 && debug.cols === 10, JSON.stringify(debug));
    await shot(page, "depuracion-orden");
    // Una palabra nueva dice por qué sale, con la respuesta (antes contaría la lectura)
    const why = await page.evaluate(() => {
      const card = newWordCandidates().list[0];
      session = { queue: [card], total: 1, done: 0, firstTry: 0, missed: new Map(), mode: "type", sentences: false };
      document.body.classList.add("studying");
      showCard();
      const before = !!document.querySelector(".why-line");
      $("unknownBtn").click();
      return { before, card: card.id };
    });
    await page.waitForSelector(".why-line", { timeout: 5000 });
    check(!why.before, "el porqué se ve antes de responder");
    await shot(page, "porque");
    await page.evaluate(() => { session = null; document.body.classList.remove("studying"); switchView("study"); });
  });

  await step("escritura: repaso espaciado; primero lo ya visto, el primer fallo no cuenta y Mostrar es Otra vez", async () => {
    const result = await page.evaluate(async () => {
      await BANK.loadUpTo("N1");
      $("drawLevel").value = "auto";
      const savedKanji = new Map(userKanji), savedWords = new Map(userWords), savedMeta = meta.writing, savedReading = meta.reading;
      userKanji = new Map(); meta.writing = {}; meta.reading = { ...meta.reading, assumed: "" };
      // Conoce 学校: sus kanjis salen antes que el primero de la lista de N5
      userWords = new Map([["学校|がっこう", { ...blankUserWord("学校", "がっこう"), status: "mastered" }]]);
      try {
        const first = pickDrawKanji();
        // Bien escrito: vuelve a los pocos minutos (paso de aprendizaje), no ahora
        const card = await gradeWriting(first.kanji.c, "good", "new");
        const second = pickDrawKanji();
        // Cuando vence, sale como repaso antes que cualquier nuevo
        userKanji.get(first.kanji.c).writeFsrs.due = new Date(Date.now() - 1000).toISOString();
        draw = null;
        const review = pickDrawKanji();
        // Con el tope de nuevos del día: práctica extra
        meta.writing.today = { day: today(), fresh: STUDY_CONFIG.writing.newPerDay };
        userKanji.get(first.kanji.c).writeFsrs.due = new Date(Date.now() + 86400000).toISOString();
        const extra = pickDrawKanji();
        meta.writing.today = { day: today(), fresh: 0 };
        // Un kanji que ya sabía escribir de antes, escrito hace un mes: le toca repaso
        userKanji.set("日", { ...blankUserKanji("日"), canWrite: true, lastWrittenAt: Date.now() - 30 * 86400000 });
        const legacy = pickDrawKanji();
        return {
          first: [first.kanji.c, first.kind], minutes: Math.round((new Date(card.due) - Date.now()) / 60000),
          second: [second.kanji.c, second.kind], review: [review.kanji.c, review.kind], extra: extra.kind, legacy: [legacy.kanji.c, legacy.kind],
          rating: ["good", "hard", "again"].map((r) => r) && [
            writingRating({ mistakes: 1 }, STUDY_CONFIG.writing.rating), writingRating({ mistakes: 0, hinted: true }, STUDY_CONFIG.writing.rating),
            writingRating({ shown: true }, STUDY_CONFIG.writing.rating)]
        };
      } finally {
        userKanji = savedKanji; userWords = savedWords; meta.writing = savedMeta; meta.reading = savedReading;
      }
    });
    check(["学", "校"].includes(result.first[0]) && result.first[1] === "new" && result.minutes > 0 && result.minutes < 60, JSON.stringify(result));
    check(result.second[1] === "new" && result.second[0] !== result.first[0], JSON.stringify(result));
    check(result.review[0] === result.first[0] && result.review[1] === "review" && result.extra === "extra", JSON.stringify(result));
    check(result.legacy[0] === "日" && result.legacy[1] === "review", JSON.stringify(result));
    check(result.rating.join() === "good,hard,again", JSON.stringify(result.rating));
  });

  await step("escritura: en pantalla, Mostrar cuenta como Otra vez y dice cuándo vuelve; la prueba salta un nivel", async () => {
    await page.evaluate(() => { switchView("draw"); });
    await page.waitForSelector("#drawShowBtn", { timeout: 30000 });
    const shown = await page.evaluate(async () => {
      const c = draw.kanji.c;
      $("drawShowBtn").click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rec = userKanji.get(c);
      const text = $("drawFeedback").textContent;
      $("drawNextBtn").click(); // ya valorado: pasar no lo vuelve a valorar
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { c, again: text.includes(t("Otra vez")) && text.includes(t("vuelve en {when}", { when: "" }).trim()),
        card: !!rec?.writeFsrs, canWrite: rec?.canWrite, lapsesOk: rec?.writeFsrs?.reps === 1 };
    });
    check(shown.again && shown.card && shown.canWrite === false && shown.lapsesOk, JSON.stringify(shown));
    const test = await page.evaluate(async () => {
      const savedKanji = new Map(userKanji), savedMeta = meta.writing;
      userKanji = new Map(); meta.writing = {};
      try {
        const n5 = kanjiByLevel().N5;
        await finishWritingTest({ level: "N5", queue: n5.slice(0, 8), results: n5.slice(0, 8).map((c) => ({ c, mistakes: 0, shown: false, hinted: false })) });
        const good = n5.slice(0, 8).map((c) => userKanji.get(c));
        return { skipped: meta.writing.skipped, level: writingProgress().level, status: $("drawStatus").textContent,
          long: good.every((rec) => rec.canWrite && new Date(rec.writeFsrs.due) - Date.now() > 30 * 86400000) };
      } finally { userKanji = savedKanji; meta.writing = savedMeta; draw = null; }
    });
    check(test.skipped.join() === "N5" && test.level === "N4" && test.long && /N4/.test(test.status), JSON.stringify(test));
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

  await step("análisis: sin premium, el aviso; con premium, cada nivel, la gramática, la hoja de ruta, la foto de la semana y su sincronización", async () => {
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
        // El resumen de la IA, imitado
        window.realInvokeSummary = window.invokeSummary;
        window.summaryCalls = [];
        window.invokeSummary = async (body) => { summaryCalls.push(body); return { data: { summary: "Buena semana: sigue así." }, error: null }; };
        meta.summary = {};
        try { localStorage.removeItem("kanji-summary-failed"); } catch { /* sin almacenamiento */ }
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
      // La hoja de ruta: se dibuja, se guarda, sus palabras salen antes en el repaso y sus estructuras van al prompt
      const roadmap = await page.evaluate(() => {
        const candidates = newWordCandidates().list;
        const planned = candidates.filter((card) => card.info.planned).map((card) => card.id);
        return {
          panel: !!document.querySelector("#analysisArea .roadmap-panel"),
          steps: document.querySelectorAll("#analysisArea .roadmap-steps li").length,
          level: meta.roadmap.level, words: meta.roadmap.words.length, grammar: meta.roadmap.grammar,
          planned: planned.length && planned.every((id) => meta.roadmap.words.includes(id)),
          first: meta.roadmap.words.includes(candidates[0]?.id),
          prompt: promptParams({ type: "short story", topic: "food", length: 50 }).grammar.map((point) => point.ja),
          rendered: buildPrompt({ type: "short story", topic: "food", length: 50 }).includes("Grammar the learner is practising")
        };
      });
      check(roadmap.panel && roadmap.steps > 0 && roadmap.level && roadmap.words > 0 && roadmap.planned && roadmap.first &&
        roadmap.prompt.length === roadmap.grammar.length && roadmap.rendered === roadmap.grammar.length > 0, JSON.stringify(roadmap));
      // El resumen de la semana: se pide una vez con los números de la pantalla y después se reutiliza
      await page.waitForFunction(() => $("analysisSummary")?.textContent.includes("Buena semana"), { timeout: 10000 });
      const summary = await page.evaluate(async () => {
        const first = summaryCalls[0];
        switchView("analysis");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { calls: summaryCalls.length, week: first.week === weekKey(), lang: first.lang === lang,
          facts: Object.keys(first.facts).sort().join(), text: $("analysisSummary").textContent.includes("Buena semana") };
      });
      check(summary.calls === 1 && summary.week && summary.lang && summary.text &&
        summary.facts === "delta,grammarNext,levels,practice,reading,roadmap", JSON.stringify(summary));
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
      // Premium caducado: vuelve el aviso, y la hoja de ruta ya no toca ni el repaso ni los textos
      const expired = await page.evaluate(() => {
        sync.config.plan = { plan: "premium", until: "2020-01-01T00:00:00Z" };
        switchView("analysis");
        return !document.querySelector("#analysisArea .stat-card") && !newWordCandidates().list.some((card) => card.info.planned) &&
          !promptParams({ type: "short story", topic: "food", length: 50 }).grammar.length;
      });
      check(expired, "con el premium caducado se ve el análisis o sigue la hoja de ruta");
    } finally {
      await page.evaluate(() => {
        if (window.realSchedule) window.scheduleSync = window.realSchedule;
        if (window.realInvokeSummary) window.invokeSummary = window.realInvokeSummary;
        sync.user = null;
        sync.config.plan = null;
        switchView("study");
      });
    }
  });

  await step("leer cuenta como repaso: la que toca y no se toca, bien (con tope); la tocada, otra vez; se puede deshacer", async () => {
    const setup = await page.evaluate(async () => {
      prefs.furigana = "none";
      const text = texts.find((x) => x.data.sentences.length && Object.keys(x.lemmas).filter((key) => /\p{Script=Han}/u.test(key)).length >= 3);
      text.readAt = null;
      const [tapKey, readKey, laterKey] = Object.keys(text.lemmas).filter((key) => /\p{Script=Han}/u.test(key));
      // Las dos primeras tocaba repasarlas ayer (con 10 días de intervalo); la tercera vence dentro de una semana
      const yesterday = new Date(Date.now() - DAY_MS);
      for (const [key, last] of [[tapKey, 11], [readKey, 11], [laterKey, 3]]) {
        const [lemma, reading] = key.split("|");
        const rec = userWords.get(key) || blankUserWord(lemma, reading);
        applyCard(rec, masteredCard(10, new Date(Date.now() - last * DAY_MS)));
        Object.assign(rec, { status: "learning", readStreak: 0, lastReadReview: "" });
        await saveUserWord(rec);
      }
      await openText(text.id);
      const index = text.data.sentences.findIndex((sentence) => sentence.tokens.some((token) => tokenKey(token) === tapKey));
      showPanel({ kind: "word", s: index, t: text.data.sentences[index].tokens.findIndex((token) => tokenKey(token) === tapKey) });
      return { tapKey, readKey, laterKey, before: userWords.get(readKey).nextReview, laterBefore: userWords.get(laterKey).nextReview };
    });
    await page.evaluate(() => $("readerFinishBtn").click());
    await page.waitForFunction(() => !reader, { timeout: 5000 });
    // Si sale la evaluación de palabras nuevas, se deja para luego
    await page.evaluate(() => { if (evaluation) { const summary = evaluation.summary; evaluation = null; renderReadSummary(summary); } });
    await page.waitForSelector(".read-reviews", { timeout: 5000 });
    await shot(page, "leer-repaso");
    const after = await page.evaluate(({ tapKey, readKey, laterKey }) => {
      const session = [...document.querySelectorAll(".read-review")].map((li) => li.className);
      const read = userWords.get(readKey), tap = userWords.get(tapKey), later = userWords.get(laterKey);
      return { session, readNext: read.nextReview, readInterval: read.interval, readStreak: read.readStreak, readStatus: read.status,
        tapInterval: tap.interval, tapIncorrect: tap.incorrectCount, laterNext: later.nextReview };
    }, setup);
    check(after.session.length === 2, JSON.stringify(after.session));
    // Acertada al leer: intervalo de 10 días como mucho 15, nunca dominada
    check(after.readNext > setup.before && after.readInterval <= 15 && after.readStreak === 1 && after.readStatus !== "mastered", JSON.stringify(after));
    check(after.tapInterval === 0 && after.tapIncorrect >= 1, `tocada: ${JSON.stringify(after)}`);
    check(after.laterNext === setup.laterBefore, "la que aún no tocaba cambió de fecha");
    // «La toqué sin querer»: pasa a acertada
    await page.evaluate(() => document.querySelector(".read-again [data-flip]").click());
    await page.waitForFunction((key) => userWords.get(key).interval > 0, { timeout: 5000 }, setup.tapKey);
    const flipped = await page.evaluate(async (key) => {
      const sessions = await getAll("sessions");
      const last = sessions.sort((a, b) => b.finishedAt - a.finishedAt)[0];
      return { review: last.reviews?.[key], rows: document.querySelectorAll(".read-review.read-good").length };
    }, setup.tapKey);
    check(flipped.review === "good" && flipped.rows === 2, JSON.stringify(flipped));
    await page.evaluate(() => { prefs.furigana = "unknown"; });
  });

  await step("textos: el prompt pide las que tocan, rota tipo, tema y personajes, y detecta un texto repetido", async () => {
    const result = await page.evaluate(async () => {
      // 学校 toca hoy: tiene que ir en el prompt como palabra que repasar
      const rec = userWords.get("学校|がっこう") || blankUserWord("学校", "がっこう");
      applyCard(rec, masteredCard(5, new Date(Date.now() - 6 * DAY_MS)));
      await saveUserWord(rec);
      const params = promptParams({ type: "dialogue", topic: "food", length: 50 });
      const prompt = buildPrompt({ type: "dialogue", topic: "food", length: 50 });
      // Una respuesta que copia las frases del último texto leído se detecta como repetida
      const last = texts.find((text) => text.readAt) || texts[0];
      const copy = JSON.stringify({ sentences: last.data.sentences.map((sentence) => ({ ja: sentence.tokens.map((token) => token.surface).join("|") })) });
      const similar = textSimilarity(answerSentences(copy), recentSentences(), STUDY_CONFIG.stories.similarity);
      const fresh = textSimilarity(["駅の近くで新しい傘を買いました。", "先生は図書館で静かに本を読んでいます。", "明日は早く起きて山へ行きます。"],
        recentSentences(), STUDY_CONFIG.stories.similarity);
      // El lector dice cuántas de las pedidas salen
      const readAt = last.readAt;
      last.targets = { asked: ["学校|がっこう", "名前|なまえ"], found: ["学校|がっこう"] };
      last.readAt = null;
      await openText(last.id);
      const line = document.querySelector(".reader-head").textContent;
      $("readerCloseBtn").click();
      delete last.targets;
      last.readAt = readAt;
      return { targets: params.targets, ids: params.targetIds, cast: params.cast, inPrompt: prompt.includes("Words due for review") && prompt.includes("学校"),
        characters: prompt.includes("Characters"), similar: similar.tooSimilar, fresh: fresh.tooSimilar, line,
        variety: currentVariety(), types: TEXT_TYPES.length };
    });
    check(result.ids.includes("学校|がっこう") && result.inPrompt && result.characters && result.cast.length === 2, JSON.stringify(result));
    check(result.similar && !result.fresh, `parecido: ${result.similar} / ${result.fresh}`);
    check(/1/.test(result.line) && /2/.test(result.line), result.line);
    check(result.types === 8 && result.variety.type && result.variety.topic, JSON.stringify(result.variety));
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

  await step("Ajustes → Tus datos: el archivo lleva el perfil, las palabras y la guía", async () => {
    await page.evaluate(() => switchView("data"));
    await shot(page, "tus-datos");
    const data = await page.evaluate(async () => JSON.parse(JSON.stringify(await progressExport())));
    check(data.guide?.states && data.profile?.vocab?.N5, "faltan la guía o el perfil");
    check(data.words.some((word) => word.studied && word.fsrs), `palabras: ${data.words.length}`);
    check(data.readingSessions.length >= 1, `lecturas: ${data.readingSessions.length}`);
    check(!("kanjiStates" in data.profile), "el perfil lleva un Map que no se puede guardar");
  });

  await step("Tus datos: importar una lista (informe, va primero hasta acabarse) y el archivo v2 con el orden y los kanjis", async () => {
    try {
      await page.evaluate(async () => {
        await ensureStudyBank();
        switchView("data");
        $("queueOpenBtn").click();
        $("queueText").value = "1. 教室\n2. 有名|ゆうめい\n3. 角\n4. 存在しない\n5. 教室";
        $("queueImportBtn").click();
      });
      await page.waitForFunction(() => $("queueReport").textContent.includes("存在しない"), { timeout: 10000 });
      await shot(page, "importar-lista");
      const imported = await page.evaluate(() => ({
        queue: meta.queue.ids, report: $("queueReport").textContent, status: $("queueStatus").textContent,
        first: newWordCandidates().list.slice(0, 2).map((card) => card.id), why: whyText(newWordCandidates().list[0].info)
      }));
      check(imported.queue.join() === "教室|きょうしつ,有名|ゆうめい", JSON.stringify(imported.queue));
      check(imported.report.includes("角") && imported.report.includes("存在しない"), imported.report);
      check(imported.first.join() === imported.queue.join() && imported.why.length > 0, JSON.stringify(imported));
      check(/2/.test(imported.status), imported.status);
      // El archivo, versión 2: los kanjis por sus palabras, las 100 siguientes y cómo contestar con una lista
      const data = await page.evaluate(async () => {
        $("queueDialog").close();
        const file = JSON.parse(JSON.stringify(await progressExport()));
        return { version: file.version, next: file.nextWords.length, first: file.nextWords[0], kanji: file.kanjiReadings.length,
          queue: file.queue?.remaining, curate: file.guide.howToCurate.includes("kanji-app-queue"), recent: Array.isArray(file.recentWords) };
      });
      check(data.version === 2 && data.next === 100 && data.first.queued && data.first.parts && data.curate && data.recent, JSON.stringify(data).slice(0, 300));
      check(data.queue?.length === 2, JSON.stringify(data.queue));
      // Al estudiarla sale de la lista; «Quitar la lista» la borra
      const after = await page.evaluate(async () => {
        const rec = userWords.get("教室|きょうしつ") || blankUserWord("教室", "きょうしつ");
        rec.studied = true;
        await saveUserWord(rec);
        const left = queueRemaining();
        window.realConfirm = window.confirm;
        window.confirm = () => true;
        $("queueClearBtn").click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        window.confirm = window.realConfirm;
        return { left, cleared: !meta.queue.ids, hidden: $("queueClearBtn").classList.contains("hidden") };
      });
      check(after.left.join() === "有名|ゆうめい" && after.cleared && after.hidden, JSON.stringify(after));
    } finally {
      await page.evaluate(() => { if ($("queueDialog").open) $("queueDialog").close(); meta.queue = {}; });
    }
  });

  await step("kanjis: sin premium, el aviso; con premium, la tabla por nivel, la ficha y el cambio de agrupación", async () => {
    const locked = await page.evaluate(() => {
      switchView("kanji");
      return $("kanjiArea").textContent.includes(t("La tabla de kanjis es parte del plan premium"));
    });
    check(locked, "sin premium no se ve el aviso");
    try {
      await page.evaluate(async () => {
        window.realSchedule = window.scheduleSync;
        window.scheduleSync = () => {};
        sync.user = { id: "smoke" };
        sync.config.plan = { plan: "premium", until: null };
        // Conoce 名前: 名 queda parcial (le falta めい) y 前 también (le falta ぜん)
        const rec = blankUserWord("名前", "なまえ");
        Object.assign(rec, { status: "mastered", studied: true, canReadKanji: true });
        await saveUserWord(rec);
        switchView("kanji");
      });
      await page.waitForSelector("#kanjiArea .kanji-cell", { timeout: 30000 });
      await shot(page, "kanjis");
      const table = await page.evaluate(() => ({
        groups: [...document.querySelectorAll("#kanjiArea .kanji-group h3")].map((h) => h.firstChild.textContent.trim()),
        cells: document.querySelectorAll("#kanjiArea .kanji-cell").length, total: BANK.kanjiInfo.size,
        na: document.querySelector('[data-kanji="名"]')?.className
      }));
      check(table.groups.slice(0, 5).join() === "N5,N4,N3,N2,N1" && table.groups.length === 6, JSON.stringify(table.groups));
      check(table.cells === table.total && table.total > 2000, `celdas: ${table.cells} de ${table.total}`);
      check(/kanji-partial/.test(table.na), `名: ${table.na}`);
      await page.click('[data-kanji="名"]');
      await shot(page, "kanji-ficha");
      const detail = await page.evaluate(() => ({
        open: $("kanjiDialog").open,
        missing: [...document.querySelectorAll("#kanjiDetail .reading-missing span[lang=ja]")].map((el) => el.textContent),
        known: [...document.querySelectorAll("#kanjiDetail .reading-known span[lang=ja]")].map((el) => el.textContent),
        words: document.querySelector("#kanjiDetail .kanji-words")?.textContent || ""
      }));
      check(detail.open && detail.known.includes("な") && detail.missing.includes("めい") && detail.words.includes("名前"), JSON.stringify(detail));
      const grades = await page.evaluate(() => {
        $("kanjiDialog").close();
        $("kanjiGroupSelect").value = "grade";
        $("kanjiGroupSelect").dispatchEvent(new Event("change"));
        return new Promise((resolve) => setTimeout(() => {
          const names = [...document.querySelectorAll("#kanjiArea .kanji-group h3")].map((h) => h.firstChild.textContent.trim());
          resolve({ names, ok: names[0] === t("{n}.º de primaria", { n: 1 }) && names.includes(t("Secundaria")) });
        }, 500));
      });
      check(grades.ok, JSON.stringify(grades.names));
    } finally {
      await page.evaluate(() => {
        if (window.realSchedule) window.scheduleSync = window.realSchedule;
        sync.user = null;
        sync.config.plan = null;
        prefs.kanjiGroup = "jlpt";
        saveLocal("kanji-prefs", prefs);
        if ($("kanjiDialog").open) $("kanjiDialog").close();
        switchView("study");
      });
    }
  });

  await step("Hoy: es la pantalla de inicio, lista lo del día y cada paso abre su sección", async () => {
    await page.evaluate(() => { localStorage.removeItem("kanji-reader"); });
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.dataset.view === "today" && document.querySelector(".today-step"), { timeout: 30000 });
    await shot(page, "hoy");
    const plan = await page.evaluate(() => ({
      steps: [...document.querySelectorAll("[data-today]")].map((button) => button.dataset.today),
      next: document.querySelector(".today-next [data-today]")?.dataset.today,
      tab: document.querySelector('.subtab[data-view="today"]').classList.contains("active")
    }));
    check(plan.tab && plan.steps.includes("reviews") && plan.next, JSON.stringify(plan));
    // Repasa: empieza la sesión directamente
    await page.evaluate(() => document.querySelector('[data-today="reviews"]').click());
    await page.waitForFunction(() => document.body.dataset.view === "study" && (session || document.querySelector("#studyArea .empty-state")), { timeout: 15000 });
    await page.evaluate(() => { session = null; document.body.classList.remove("studying"); switchView("today"); });
  });
}
