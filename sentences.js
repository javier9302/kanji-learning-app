/* =========================================
   KANJI LEARNING APP - sentences.js
   Frases de ejemplo: las del usuario (salen de sus textos), las comunes de la
   app (bank/sentences/<nivel>.json) y su uso al repasar.
   Las reglas (qué frase vale, cuál se elige) están en sentences-core.js; aquí
   solo va lo que toca al navegador. Se carga después de study.js.

   Almacenes de IndexedDB:
     sentences      frases del usuario, con la forma de sentences-core.js más
                    { updatedAt, local }. local: su texto no se sube (texto
                    pegado), así que la frase tampoco.
     sentenceStats  { id, shown, lastShown, updatedAt }: veces que se ha enseñado
                    cada frase, sea del usuario o común.
   Las frases se pueden reconstruir siempre a partir de los textos.
   ========================================= */

let userSentences = new Map(); // id -> frase del usuario
let sentenceStats = new Map(); // id -> { id, shown, lastShown, updatedAt }

/* =========================================
   1. ALMACENAMIENTO
   ========================================= */

async function loadSentenceData() {
  userSentences = new Map((await getAll("sentences")).map((s) => [s.id, s]));
  sentenceStats = new Map((await getAll("sentenceStats")).map((s) => [s.id, s]));
}

/* Anota que una frase se ha enseñado en un repaso */
async function markSentenceShown(id) {
  const stat = sentenceStats.get(id) || { id, shown: 0, lastShown: 0 };
  stat.shown++;
  stat.lastShown = stat.updatedAt = Date.now();
  sentenceStats.set(id, stat);
  await putRecords("sentenceStats", [stat]);
  scheduleSync();
}

/* =========================================
   5. SINCRONIZACIÓN (tabla user_sentences de Supabase)
   -----------------------------------------
   Se suben las frases de los textos que también se suben y el contador de
   cada frase enseñada. Si la tabla aún no existe (falta volver a ejecutar
   supabase/schema.sql) no pasa nada: se queda todo en el dispositivo.
   ========================================= */

const sentencePrint = (id) => `${userSentences.get(id)?.updatedAt || 0}:${sentenceStats.get(id)?.shown || 0}`;
const tableMissing = (error) => ["PGRST205", "42P01"].includes(error?.code);

async function pullSentences(userId) {
  const cursors = sync.config.cursors, pushed = sync.pushed.sentences ??= {};
  let rows;
  try {
    rows = await fetchChanged("user_sentences", "id", userId, cursors.user_sentences);
  } catch (error) {
    if (tableMissing(error)) return;
    throw error;
  }
  const saved = [], removed = [], stats = [];
  for (const row of rows) {
    const mine = userSentences.get(row.id);
    if (row.deleted_at) {
      pushed[row.id] = "d";
      if (mine) { userSentences.delete(row.id); removed.push(row.id); }
      continue;
    }
    const stamp = Number(row.client_updated_at);
    if (row.data && (!mine || (mine.updatedAt || 0) < stamp)) {
      const sentence = { ...row.data, id: row.id, updatedAt: stamp };
      userSentences.set(row.id, sentence);
      saved.push(sentence);
    }
    // Del contador gana el mayor: cada dispositivo solo suma
    const stat = sentenceStats.get(row.id) || { id: row.id, shown: 0, lastShown: 0 };
    const lastShown = msOf(row.last_shown) || 0;
    if (row.shown > stat.shown || lastShown > stat.lastShown) {
      stat.shown = Math.max(stat.shown, row.shown);
      stat.lastShown = Math.max(stat.lastShown, lastShown);
      stat.updatedAt = Date.now();
      sentenceStats.set(row.id, stat);
      stats.push(stat);
    }
    pushed[row.id] = `${row.data ? stamp : 0}:${row.shown}`;
  }
  if (saved.length || removed.length) {
    await putRecords("sentences", saved, removed);
    forgetSentenceIndex();
  }
  if (stats.length) await putRecords("sentenceStats", stats);
  if (rows.length) cursors.user_sentences = rows[rows.length - 1].updated_at;
}

async function pushSentences(userId) {
  const pushed = sync.pushed.sentences ??= {};
  const ids = new Set([
    ...[...userSentences.values()].filter((sentence) => !sentence.local).map((sentence) => sentence.id),
    ...[...sentenceStats.keys()].filter((id) => !userSentences.get(id)?.local)
  ]);
  const changed = [...ids].filter((id) => pushed[id] !== sentencePrint(id));
  // Frases que ya no existen aquí porque se borró su texto
  const gone = Object.keys(pushed).filter((id) => pushed[id] !== "d" && !pushed[id].startsWith("0:") && !userSentences.has(id));
  try {
    await pushRows("user_sentences", "user_id,id", changed.map((id) => {
      const sentence = userSentences.get(id), stat = sentenceStats.get(id);
      const { updatedAt, local, ...data } = sentence || {};
      return {
        user_id: userId, id, text_id: sentence?.sourceId || null, data: sentence ? data : null,
        shown: whole(stat?.shown), last_shown: isoOf(stat?.lastShown),
        client_updated_at: Math.round(Math.max(updatedAt || 0, stat?.updatedAt || 0)), deleted_at: null
      };
    }), changed.map((id) => [id, sentencePrint(id)]), pushed);
    for (let i = 0; i < gone.length; i += 200) {
      const batch = gone.slice(i, i + 200);
      const { error } = await sb.from("user_sentences").update({ deleted_at: new Date().toISOString() })
        .eq("user_id", userId).in("id", batch);
      if (error) throw error;
      for (const id of batch) pushed[id] = "d";
    }
  } catch (error) {
    if (!tableMissing(error)) throw error;
    console.warn("Falta la tabla user_sentences: ejecuta supabase/schema.sql.");
  }
}

/* El índice palabra -> frases se rehace cuando cambian las frases (sección 3) */
function forgetSentenceIndex() {}
