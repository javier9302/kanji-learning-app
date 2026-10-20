/* =========================================
   KANJI LEARNING APP - reading-sync.js
   Sincronización con Supabase de la lectura y del progreso por palabra y kanji.
   Después de reading-stats.js.
   ========================================= */

/* =========================================
   12. SINCRONIZACIÓN DE LA LECTURA (Supabase)
   -----------------------------------------
   Mismo método que los elementos de repaso (app.js): se descargan las
   filas cambiadas desde la última vez y se sube lo que el servidor no tiene.
   - texts: los propios y los aprobados de otros usuarios. Un texto subido
     queda "pending" hasta que un administrador lo aprueba.
   - text_states: leído / descartado / oculto, por usuario.
   - user_words, reading_sessions, profiles: solo del usuario.
   El diccionario (words) no se sube: se reconstruye de los textos.
   ========================================= */

const isoOf = (ms) => ms ? new Date(ms).toISOString() : null;
const msOf = (iso) => iso ? Date.parse(iso) : null;
const isOwnText = (text) => !text.owner || text.owner === sync.config.userId;
const statePrint = (text) => `${text.readAt || 0}:${text.discardedAt || 0}:${text.hiddenAt || 0}`;
const profilePrint = (profile) => `${profile.level}|${profile.assumed}|${profile.placedAt}`;

/* Una palabra del banco que llega solo como progreso: su significado sale del banco */
function ensureWordEntry(mine) {
  if (words.has(mine.id)) return null;
  const word = BANK.words.get(mine.id);
  // Fuera del banco solo se puede reconstruir lo que el usuario agregó a mano o
  // buscó en el diccionario: su significado viaja con el progreso
  if (!word && !["manual", "diccionario"].includes(mine.origin)) return null;
  if (!word && !mine.meaning) return null;
  const own = mine.meaning ? [mine.meaning] : [];
  const entry = { id: mine.id, lemma: mine.lemma, reading: mine.reading, meanings: word?.en || own,
    meaningsEs: word?.es || own, pos: "", source: word ? "jmdict" : "manual", updatedAt: Date.now() };
  words.set(entry.id, entry);
  return entry;
}

/* Campos de repaso espaciado, iguales en palabras y kanjis */
const srsToRow = (record) => ({
  studied: !!record.studied, repetitions: whole(record.repetitions), interval_days: whole(record.interval),
  ease: Number(record.ease) || 2.5,
  next_review: /^\d{4}-\d{2}-\d{2}$/.test(record.nextReview || "") ? record.nextReview : null,
  last_reviewed: record.lastReviewed ? isoOf(Date.parse(record.lastReviewed)) : null,
  correct_count: whole(record.correctCount), incorrect_count: whole(record.incorrectCount),
  streak_days: whole(record.streakDays), last_correct_day: record.lastCorrectDay || null,
  fsrs: record.fsrs || null,
  // Traducir: lo que se sabe del significado (aparte del repaso de la lectura)
  meaning_correct: Math.max(0, Number(record.meaningCorrect) || 0), meaning_wrong: whole(record.meaningWrong),
  last_meaning_at: isoOf(record.lastMeaningAt)
});
const srsFromRow = (row) => ({
  studied: !!row.studied, repetitions: row.repetitions || 0, interval: row.interval_days || 0,
  ease: row.ease || 2.5, nextReview: row.next_review || today(), lastReviewed: row.last_reviewed || null,
  correctCount: row.correct_count || 0, incorrectCount: row.incorrect_count || 0,
  streakDays: row.streak_days || 0, lastCorrectDay: row.last_correct_day || "",
  ...(row.fsrs ? { fsrs: row.fsrs } : {}),
  ...(row.meaning_correct ? { meaningCorrect: row.meaning_correct } : {}),
  ...(row.meaning_wrong ? { meaningWrong: row.meaning_wrong } : {}),
  ...(row.last_meaning_at ? { lastMeaningAt: msOf(row.last_meaning_at) } : {})
});

/* Sube el progreso. Si la base de datos aún no tiene las columnas de la fase 2
   (falta ejecutar supabase/schema.sql) se sube sin ellas y no se marca como
   subido, para volver a enviarlo completo cuando existan. */
const PHASE2_COLUMNS = ["fsrs", "origin", "meaning", "seen_at"];
/* Columnas de Traducir (significado). Si faltan solo se quitan estas: el resto
   del progreso, también el de la fase 2, se sigue subiendo. */
const MEANING_COLUMNS = ["meaning_correct", "meaning_wrong", "last_meaning_at"];
const NEWER_ORIGINS = ["diccionario", "traducir"]; // orígenes que una base de datos sin actualizar no admite
const without = (rows, columns) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key))));

async function pushProgress(table, rows, marks, pushed, level = 0) {
  try {
    await pushRows(table, "user_id,id", rows, marks, pushed);
  } catch (error) {
    // La base de datos aún no admite un origen nuevo (falta volver a ejecutar
    // supabase/schema.sql): esas palabras se suben como "lectura" y no se marcan
    // como subidas, para enviarlas bien cuando lo admita. El resto se sube normal.
    const searched = (row) => NEWER_ORIGINS.includes(row.origin);
    if (error?.code === "23514" && rows.some(searched)) {
      console.warn(`${table} no admite el origen "${rows.find(searched).origin}": ejecuta supabase/schema.sql.`);
      const keep = rows.map((row) => !searched(row));
      await pushProgress(table, rows.filter((_, i) => keep[i]), marks.filter((_, i) => keep[i]), pushed, level);
      return pushProgress(table, rows.filter(searched).map((row) => ({ ...row, origin: "lectura" })), [], pushed, level);
    }
    if (error?.code !== "PGRST204" || level >= 2) throw error;
    console.warn(`Faltan columnas en ${table}: ejecuta supabase/schema.sql.`);
    // Primero se prueba sin las columnas de Traducir; si aún faltan, también sin las de la fase 2.
    // Sin marcar nada como subido: se enviará completo cuando existan.
    const columns = level === 0 ? MEANING_COLUMNS : [...MEANING_COLUMNS, ...PHASE2_COLUMNS];
    await pushProgress(table, without(rows, columns), [], pushed, level + 1);
  }
}

async function pullReading(userId) {
  const cursors = sync.config.cursors;
  const last = (rows, name) => { if (rows.length) cursors[name] = rows[rows.length - 1].updated_at; };
  let changed = false;

  // Perfil
  let rows = await fetchChanged("profiles", "user_id", userId, cursors.profiles);
  for (const row of rows) {
    if (!row.placed_at) continue;
    const remote = { level: row.reading_level, assumed: row.assumed_level || "",
      placedAt: msOf(row.placed_at), updatedAt: Number(row.client_updated_at) };
    sync.pushed.profile = profilePrint(remote);
    if (!meta.reading.placedAt || remote.updatedAt > (meta.reading.updatedAt || 0)) {
      meta.reading = remote;
      await saveMeta();
      changed = true;
    }
  }
  last(rows, "profiles");

  // Textos: los propios y los aprobados de los demás
  rows = await fetchChanged("texts", "id", userId, cursors.texts, false);
  const saved = [], removed = [], freshWords = [];
  for (const row of rows) {
    const mine = texts.find((x) => x.id === row.id);
    if (row.deleted_at) {
      sync.pushed.texts[row.id] = "d";
      if (mine) { removed.push(row.id); texts = texts.filter((x) => x !== mine); }
      continue;
    }
    sync.pushed.texts[row.id] = "1";
    if (deletedTexts.some((x) => x.id === row.id)) continue; // borrado aquí: se subirá el borrado
    const record = {
      ...(mine || { readAt: null }),
      id: row.id, owner: row.user_id,
      title: row.title, titleEn: row.title_en, titleEs: row.title_es,
      topic: row.topic, level: row.level, source: row.source, status: row.status,
      createdAt: msOf(row.created_at), updatedAt: msOf(row.updated_at),
      lemmas: row.lemmas, total: row.total, data: row.data
    };
    if (mine) texts[texts.indexOf(mine)] = record; else texts.push(record);
    if (mine && reader?.text === mine) reader.text = record;
    saved.push(record);
  }
  if (saved.length || removed.length) {
    // Un texto subido por una versión anterior puede traer significados equivocados:
    // se reparan antes de guardarlo y de sacar sus palabras
    await repairTexts(saved);
    for (const text of saved) freshWords.push(...wordsFromText(text.data));
    await putRecords("texts", saved, removed);
    await putRecords("words", freshWords);
    for (const id of removed) await dropTextSentences(id);
    await indexTextsQuietly(saved.filter((text) => !text.hiddenAt));
    changed = true;
  }
  last(rows, "texts");

  // Estado de los textos para este usuario
  rows = await fetchChanged("text_states", "text_id", userId, cursors.text_states);
  const touched = [];
  for (const row of rows) {
    const text = texts.find((x) => x.id === row.text_id);
    if (!text) continue;
    const before = statePrint(text);
    text.readAt = Math.max(text.readAt || 0, msOf(row.read_at) || 0) || null;
    text.discardedAt = Math.max(text.discardedAt || 0, msOf(row.discarded_at) || 0) || null;
    text.hiddenAt = Math.max(text.hiddenAt || 0, msOf(row.hidden_at) || 0) || null;
    sync.pushed.states[text.id] = `${msOf(row.read_at) || 0}:${msOf(row.discarded_at) || 0}:${msOf(row.hidden_at) || 0}`;
    if (statePrint(text) !== before) touched.push(text);
  }
  if (touched.length) { await putRecords("texts", touched); changed = true; }
  last(rows, "text_states");

  // Progreso por palabra: gana la versión modificada más recientemente
  rows = await fetchChanged("user_words", "id", userId, cursors.user_words);
  const newer = [], entries = [];
  for (const row of rows) {
    const stamp = Number(row.client_updated_at);
    sync.pushed.words[row.id] = String(stamp);
    const mine = userWords.get(row.id);
    if (mine && mine.updatedAt >= stamp) continue;
    const record = {
      id: row.id, lemma: row.lemma, reading: row.reading, status: row.status,
      canReadKanji: row.can_read_kanji, knowsMeaning: row.knows_meaning, canWrite: row.can_write,
      seen: row.seen, lookups: row.lookups, evalCorrect: row.eval_correct, evalWrong: row.eval_wrong,
      firstSeen: msOf(row.first_seen), lastSeen: msOf(row.last_seen), updatedAt: stamp,
      ...(row.origin ? { origin: row.origin } : {}), ...(row.meaning ? { meaning: row.meaning } : {}),
      ...srsFromRow(row)
    };
    userWords.set(record.id, record);
    newer.push(record);
    const entry = ensureWordEntry(record);
    if (entry) entries.push(entry);
  }
  if (newer.length) {
    await putRecords("userWords", newer);
    await putRecords("words", entries);
    changed = true;
  }
  last(rows, "user_words");

  // Progreso por kanji
  rows = await fetchChanged("user_kanji", "id", userId, cursors.user_kanji);
  const newerKanji = [];
  for (const row of rows) {
    const stamp = Number(row.client_updated_at);
    sync.pushed.kanji[row.id] = String(stamp);
    const mine = userKanji.get(row.id);
    if (mine && mine.updatedAt >= stamp) continue;
    const record = {
      id: row.id, status: row.status, knowsMeaning: row.knows_meaning, canWrite: row.can_write,
      writes: row.writes || 0, firstSeen: msOf(row.first_seen), lastSeen: msOf(row.last_seen),
      updatedAt: stamp, ...(row.seen_at ? { seenAt: msOf(row.seen_at) } : {}), ...srsFromRow(row)
    };
    userKanji.set(record.id, record);
    newerKanji.push(record);
  }
  if (newerKanji.length) { await putRecords("userKanji", newerKanji); changed = true; }
  last(rows, "user_kanji");

  // Sesiones
  rows = await fetchChanged("reading_sessions", "id", userId, cursors.reading_sessions);
  if (rows.length) {
    const local = new Map((await getAll("sessions")).map((s) => [s.id, s]));
    const fresh = [];
    for (const row of rows) {
      sync.pushed.sessions[row.id] = row.evaluation ? "e" : "s";
      const mine = local.get(row.id);
      if (mine && (mine.evaluation || !row.evaluation)) continue;
      fresh.push({
        id: row.id, textId: row.text_id, startedAt: msOf(row.started_at), finishedAt: msOf(row.finished_at),
        discarded: row.discarded, clicks: row.clicks || {},
        ...(row.evaluation ? { evaluation: row.evaluation } : {})
      });
    }
    if (fresh.length) { await putRecords("sessions", fresh); changed = true; }
  }
  last(rows, "reading_sessions");

  if (changed) refreshReadingViews();
}

async function pushReading(userId) {
  const pushed = sync.pushed;

  // Perfil
  if (meta.reading.placedAt && pushed.profile !== profilePrint(meta.reading)) {
    const print = profilePrint(meta.reading);
    await pushRows("profiles", "user_id", [{
      user_id: userId, reading_level: meta.reading.level, assumed_level: meta.reading.assumed || null,
      placed_at: isoOf(meta.reading.placedAt), client_updated_at: Math.round(meta.reading.updatedAt || meta.reading.placedAt)
    }], [], {});
    pushed.profile = print;
  }

  // Textos propios aún no subidos: quedan pendientes de aprobación
  const mineToPush = texts.filter((text) => isOwnText(text) && !text.local && !pushed.texts[text.id]);
  for (const text of mineToPush) {
    text.owner = userId;
    if (text.status !== "approved") text.status = "pending";
  }
  if (mineToPush.length) {
    await putRecords("texts", mineToPush);
    await pushRows("texts", "id", mineToPush.map((text) => ({
      id: text.id, user_id: userId,
      title: text.title, title_en: text.titleEn, title_es: text.titleEs,
      topic: text.topic, level: text.level, source: text.source || "manual",
      data: text.data, lemmas: text.lemmas, total: text.total,
      created_at: isoOf(text.createdAt), deleted_at: null
    })), mineToPush.map((text) => [text.id, "1"]), pushed.texts, { ignoreDuplicates: true });
  }
  // Textos propios borrados
  for (const gone of deletedTexts) {
    if (pushed.texts[gone.id] === "d") continue;
    if (pushed.texts[gone.id]) {
      const { error } = await sb.from("texts").update({ deleted_at: isoOf(gone.deletedAt) }).eq("id", gone.id);
      if (error) throw error;
    }
    pushed.texts[gone.id] = "d";
  }

  // Estado de los textos
  const states = texts.filter((text) => !text.local &&
    (text.readAt || text.discardedAt || text.hiddenAt) && pushed.states[text.id] !== statePrint(text));
  await pushRows("text_states", "user_id,text_id", states.map((text) => ({
    user_id: userId, text_id: text.id,
    read_at: isoOf(text.readAt), discarded_at: isoOf(text.discardedAt), hidden_at: isoOf(text.hiddenAt)
  })), states.map((text) => [text.id, statePrint(text)]), pushed.states);

  // Progreso por palabra
  const changed = [...userWords.values()].filter((word) => pushed.words[word.id] !== String(word.updatedAt));
  await pushProgress("user_words", changed.map((word) => ({
    user_id: userId, id: word.id, lemma: word.lemma, reading: word.reading, status: word.status,
    can_read_kanji: !!word.canReadKanji, knows_meaning: !!word.knowsMeaning, can_write: !!word.canWrite,
    seen: whole(word.seen), lookups: whole(word.lookups),
    eval_correct: whole(word.evalCorrect), eval_wrong: whole(word.evalWrong),
    first_seen: isoOf(word.firstSeen), last_seen: isoOf(word.lastSeen),
    origin: word.origin || null, meaning: word.meaning || null,
    client_updated_at: Math.round(word.updatedAt), ...srsToRow(word)
  })), changed.map((word) => [word.id, String(word.updatedAt)]), pushed.words);

  // Progreso por kanji
  const kanjiChanged = [...userKanji.values()].filter((k) => pushed.kanji[k.id] !== String(k.updatedAt));
  await pushProgress("user_kanji", kanjiChanged.map((k) => ({
    user_id: userId, id: k.id, status: k.status || "unknown",
    knows_meaning: !!k.knowsMeaning, can_write: !!k.canWrite, writes: whole(k.writes),
    first_seen: isoOf(k.firstSeen), last_seen: isoOf(k.lastSeen), seen_at: isoOf(k.seenAt),
    client_updated_at: Math.round(k.updatedAt), ...srsToRow(k)
  })), kanjiChanged.map((k) => [k.id, String(k.updatedAt)]), pushed.kanji);

  // Sesiones
  const sessions = (await getAll("sessions")).filter((s) => pushed.sessions[s.id] !== (s.evaluation ? "e" : "s"));
  await pushRows("reading_sessions", "user_id,id", sessions.map((s) => ({
    user_id: userId, id: s.id, text_id: s.textId,
    started_at: isoOf(s.startedAt), finished_at: isoOf(s.finishedAt),
    discarded: !!s.discarded, clicks: s.clicks || {}, evaluation: s.evaluation || null
  })), sessions.map((s) => [s.id, s.evaluation ? "e" : "s"]), pushed.sessions);
}

/* Tras descargar cambios se actualiza lo que esté a la vista, sin cortar una lectura en curso */
function refreshReadingViews() {
  renderLibrary();
  renderAll();
  if (document.body.dataset.view === "read" && !reader && !placement && !evaluation) renderRead();
}
