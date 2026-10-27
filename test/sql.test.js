/* supabase/schema.sql en un Postgres de verdad (PGlite, en memoria): se puede
   ejecutar dos veces y las funciones nuevas hacen lo que dicen.
   De Supabase solo se imita lo mínimo: los roles, auth.users, auth.uid() y auth.jwt(). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA = fs.readFileSync(path.join(__dirname, "../supabase/schema.sql"), "utf8");
const SUPABASE_STUB = `
  create role anon; create role authenticated;
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`;

let dbPromise = null;
const database = () => dbPromise ??= (async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUB);
  await db.exec(SCHEMA);
  return db;
})();

test("schema.sql se puede ejecutar otra vez sin errores", async () => {
  const db = await database();
  await db.exec(SCHEMA);
  await db.exec(SCHEMA);
});

test("search_dictionary: exacta, empieza por, lectura en katakana y significado", async () => {
  const db = await database();
  await db.exec(`
    delete from public.dictionary;
    insert into public.dictionary (lemma, reading, meanings, meanings_es) values
      ('挨拶', 'あいさつ', '["greeting"]', '["saludo"]'),
      ('挨拶状', 'あいさつじょう', '["greeting card"]', '[]'),
      ('アルファ', 'アルファ', '["alpha"]', '["alfa"]'),
      ('100%', 'ひゃくぱーせんと', '["one hundred percent"]', '[]'),
      ('犬小屋', 'いぬごや', '["kennel", "doghouse"]', '["caseta de perro"]');
  `);
  const search = async (q, kana = "", kata = "", meaning = "") =>
    (await db.query("select lemma from public.search_dictionary($1, $2, $3, $4)", [q, kana, kata, meaning])).rows.map((r) => r.lemma);

  assert.deepEqual(await search("挨拶"), ["挨拶", "挨拶状"]);
  assert.deepEqual(await search("", "あいさつ", "アイサツ"), ["挨拶", "挨拶状"]);
  assert.deepEqual(await search("", "あるふぁ", "アルファ"), ["アルファ"]);
  assert.deepEqual(await search("", "", "", "greeting"), ["挨拶", "挨拶状"]); // el significado entero antes que un trozo
  assert.deepEqual(await search("", "", "", "Saludo"), ["挨拶"]);
  assert.deepEqual(await search("", "", "", "x"), []);                       // una sola letra no busca
  assert.deepEqual(await search("%"), []);                                   // los comodines se buscan tal cual
  assert.deepEqual(await search("100%"), ["100%"]);
});

test("user_words admite el origen diccionario y sigue rechazando uno inventado", async () => {
  const db = await database();
  await db.exec(`insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing`);
  const insert = (id, origin) => db.query(
    "insert into public.user_words (user_id, id, lemma, reading, origin) values ('00000000-0000-0000-0000-000000000001', $1, '水', 'みず', $2)",
    [id, origin]);
  await insert("水|みず", "diccionario");
  await assert.rejects(insert("水|x", "inventado"), /user_words_origin_check/);
  // Una base de datos con la comprobación antigua la recibe al volver a ejecutar el archivo
  await db.exec(`
    delete from public.user_words;
    alter table public.user_words drop constraint user_words_origin_check;
    alter table public.user_words add constraint user_words_origin_check check (origin in ('manual', 'lectura', 'frecuencia'));`);
  await assert.rejects(insert("水|みず", "diccionario"), { code: "23514" });
  await db.exec(SCHEMA);
  await insert("水|みず", "diccionario");
});

test("Traducir: columnas del significado, origen traducir e historial del día", async () => {
  const db = await database();
  await db.exec(`insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
    delete from public.user_words;`);
  await db.exec(`
    insert into public.user_words (user_id, id, lemma, reading, origin, meaning_correct, meaning_wrong, last_meaning_at)
      values ('00000000-0000-0000-0000-000000000001', '学校|がっこう', '学校', 'がっこう', 'traducir', 1.5, 2, now());
    insert into public.user_kanji (user_id, id, meaning_correct) values ('00000000-0000-0000-0000-000000000001', '学', 3);
    insert into public.days (user_id, day, translations, translations_correct) values ('00000000-0000-0000-0000-000000000001', '2026-10-12', 4, 3);
    insert into public.translation_grades (user_id, request_id, ok, result, verdict, score) values ('00000000-0000-0000-0000-000000000001', 'r1', true, 'ok', 'correct', 95);`);
  const { rows } = await db.query("select meaning_correct, meaning_wrong from public.user_words");
  assert.deepEqual(rows, [{ meaning_correct: 1.5, meaning_wrong: 2 }]);
  // Las filas que ya existían reciben los valores por defecto
  const { rows: defaults } = await db.query("select reviews, translations from public.days");
  assert.deepEqual(defaults, [{ reviews: 0, translations: 4 }]);
});

test("límites: tamaño máximo y filas nuevas al día por usuario", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000009";
  await db.exec(`insert into auth.users (id) values ('${USER}') on conflict do nothing`);
  // Como un usuario normal con sesión
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"role":"authenticated"}'::jsonb $$;`);
  try {
    const text = (n, data = "{}") => db.query(
      "insert into public.texts (id, user_id, title, data) values ($1, $2, 't', $3::jsonb)", [`t-${n}`, USER, data]);
    await assert.rejects(text("grande", JSON.stringify({ x: "a".repeat(300001) })), /texts_size_check/);
    for (let n = 0; n < 50; n++) await text(n);
    await assert.rejects(text(50), /daily_limit/);
    // Un reporte con un comentario enorme tampoco
    await assert.rejects(db.query("insert into public.text_reports (kind, category, comment, user_id) values ('user', 'other', $1, $2)",
      ["x".repeat(2001), USER]), /text_reports_size_check/);
  } finally {
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;`);
  }
  // Sin el rol de usuario (Edge Functions, panel) no hay límite
  await db.query("insert into public.texts (id, user_id, title, data) values ('t-servicio', $1, 't', '{}')", [USER]);
  await db.exec(SCHEMA); // y el archivo se sigue pudiendo ejecutar otra vez
});

test("relojes: una fecha del dispositivo muy adelantada se limita a 5 minutos sobre el servidor", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000001";
  await db.exec(`insert into auth.users (id) values ('${USER}') on conflict do nothing; delete from public.user_kanji;`);
  const future = Date.now() + 365 * 86400000, ok = Date.now() - 1000;
  await db.query("insert into public.user_kanji (user_id, id, client_updated_at) values ($1, '日', $2), ($1, '月', $3)", [USER, future, ok]);
  const { rows } = await db.query("select id, client_updated_at::text as stamp from public.user_kanji order by id");
  const byId = Object.fromEntries(rows.map((row) => [row.id, Number(row.stamp)]));
  assert.ok(byId["日"] < Date.now() + 301000, "no se limitó");
  assert.equal(byId["月"], ok);
});

test("Traducir: frases respondidas, e índices de trigramas en el diccionario", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000001";
  await db.query("insert into public.user_translations (user_id, id, sentence_id, source, verdict, score, answer, result) values ($1, 'a1', 's1', 'ai', 'correct', 95, 'Bebo café', '{}')", [USER]);
  await assert.rejects(db.query("insert into public.user_translations (user_id, id, answer) values ($1, 'a2', $2)", [USER, "x".repeat(201)]), /user_translations_size_check/);
  const { rows } = await db.query("select indexname from pg_indexes where tablename = 'dictionary' and indexname like '%trgm%' order by 1");
  assert.deepEqual(rows.map((row) => row.indexname), ["dictionary_meanings_es_trgm_idx", "dictionary_meanings_trgm_idx"]);
});

test("planes: el usuario no puede cambiarse el plan; un administrador sí", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-00000000000a", ADMIN = "00000000-0000-0000-0000-00000000000b";
  await db.exec(`insert into auth.users (id, email) values ('${USER}', 'alumno@ejemplo.com'), ('${ADMIN}', 'admin@ejemplo.com') on conflict do nothing;
    insert into public.admins (user_id) values ('${ADMIN}') on conflict do nothing;`);
  const as = (id) => db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$ select '${id}'::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"role":"authenticated"}'::jsonb $$;`);
  const plan = async () => (await db.query("select plan from public.profiles where user_id = $1", [USER])).rows[0]?.plan;
  try {
    await as(USER);
    // Como usuario: crear o cambiar su fila no le da premium
    await db.query("insert into public.profiles (user_id, reading_level, plan) values ($1, 'N5', 'premium')", [USER]);
    assert.equal(await plan(), "free");
    await db.query("update public.profiles set plan = 'premium', reading_level = 'N4' where user_id = $1", [USER]);
    assert.equal(await plan(), "free");
    assert.equal((await db.query("select reading_level from public.profiles where user_id = $1", [USER])).rows[0].reading_level, "N4");
    // Ni con las funciones de administración
    await assert.rejects(db.query("select public.admin_set_plan($1, 'premium')", [USER]), /solo para administradores/);
    await assert.rejects(db.query("select * from public.admin_list_users()"), /solo para administradores/);
    // Como administrador
    await as(ADMIN);
    await db.query("select public.admin_set_plan($1, 'premium', '2027-01-01')", [USER]);
    assert.equal(await plan(), "premium");
    const users = (await db.query("select email, plan, texts_today from public.admin_list_users()")).rows;
    assert.deepEqual(users.find((row) => row.email === "alumno@ejemplo.com").plan, "premium");
    await assert.rejects(db.query("select public.admin_set_plan($1, 'oro')", [USER]), /plan desconocido/);
  } finally {
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;`);
  }
});

test("frases compartidas: tamaño máximo, filas nuevas al día y registro de la IA", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000008";
  await db.exec(`insert into auth.users (id) values ('${USER}') on conflict do nothing`);
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"role":"authenticated"}'::jsonb $$;`);
  try {
    const share = (id, data = "{}", source = "ai") => db.query(
      "insert into public.shared_sentences (id, source, words, data) values ($1, $2, '{水|みず}', $3::jsonb)", [id, source, data]);
    await assert.rejects(share("grande", JSON.stringify({ x: "a".repeat(20001) })), /shared_sentences_size_check/);
    await assert.rejects(share("otra", "{}", "inventada"), /shared_sentences_source_check/);
    for (let n = 0; n < 200; n++) await share(`ai:${n}`);
    await assert.rejects(share("ai:200"), /daily_limit/);
    const { rows } = await db.query("select user_id from public.shared_sentences where id = 'ai:0'");
    assert.equal(rows[0].user_id, USER); // el autor lo pone la base de datos
  } finally {
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;`);
  }
  await db.query("insert into public.sentence_generations (user_id, words, ok, result) values ($1, 3, true, 'ok')", [USER]);
  await db.exec(SCHEMA);
});

test("frases propias: solo un administrador comparte una frase con origen curated", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-00000000000c", ADMIN = "00000000-0000-0000-0000-00000000000d";
  await db.exec(`insert into auth.users (id) values ('${USER}'), ('${ADMIN}') on conflict do nothing;
    insert into public.admins (user_id) values ('${ADMIN}') on conflict do nothing;`);
  const as = (id) => db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$ select '${id}'::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"role":"authenticated"}'::jsonb $$;`);
  // Con el rol de la app, para que se apliquen las políticas (Row Level Security)
  const share = (id, source) => db.exec(`set role authenticated;
    insert into public.shared_sentences (id, source, words, data) values ('${id}', '${source}', '{水|みず}', '{}'::jsonb);
    reset role;`);
  try {
    await as(USER);
    await assert.rejects(share("curated:alumno", "curated"), /row-level security/);
    await db.exec("reset role");
    await share("ai:alumno", "ai");
    await as(ADMIN);
    await share("curated:admin", "curated");
    const { rows } = await db.query("select id from public.shared_sentences where id in ('curated:alumno', 'curated:admin')");
    assert.deepEqual(rows.map((row) => row.id), ["curated:admin"]);
  } finally {
    await db.exec(`reset role;
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;`);
  }
});

test("análisis: una foto por usuario y semana, con formato de semana y tamaño máximo", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000001";
  await db.exec(`insert into auth.users (id) values ('${USER}') on conflict do nothing`);
  const put = (week, data = "{}", stamp = 1) => db.query(
    `insert into public.progress_snapshots (user_id, week, data, client_updated_at) values ($1, $2, $3::jsonb, $4)
     on conflict (user_id, week) do update set data = excluded.data, client_updated_at = excluded.client_updated_at`, [USER, week, data, stamp]);
  await put("2026-W43", '{"vocab":{}}');
  await put("2026-W43", '{"vocab":{"N5":[1,0,0,10]}}', 2);
  const { rows } = await db.query("select count(*)::int as n, max(data::text) as data from public.progress_snapshots");
  assert.deepEqual(rows[0], { n: 1, data: '{"vocab": {"N5": [1, 0, 0, 10]}}' });
  await assert.rejects(put("semana 43"), /progress_snapshots_week_check/);
  await assert.rejects(put("2026-W44", JSON.stringify({ x: "a".repeat(20001) })), /progress_snapshots_size_check/);
  // Un reloj adelantado se limita, como en las demás tablas
  await put("2026-W45", "{}", Date.now() + 365 * 86400000);
  const { rows: clock } = await db.query("select client_updated_at::text as stamp from public.progress_snapshots where week = '2026-W45'");
  assert.ok(Number(clock[0].stamp) < Date.now() + 301000);
  await db.exec(SCHEMA);
});

test("resumen semanal: uno por usuario, semana e idioma", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000001";
  const put = (week, lang, summary = "Buena semana.") => db.query(
    "insert into public.progress_summaries (user_id, week, lang, summary) values ($1, $2, $3, $4)", [USER, week, lang, summary]);
  await put("2026-W43", "es");
  await put("2026-W43", "en");
  await assert.rejects(put("2026-W43", "es"), /duplicate key/);
  await assert.rejects(put("2026-W44", "fr"), /progress_summaries_lang_check/);
  await assert.rejects(put("2026-W44", "es", "x".repeat(1001)), /progress_summaries_summary_check/);
  await db.query("insert into public.summary_generations (user_id, ok, result) values ($1, true, 'ok')", [USER]);
  await db.exec(SCHEMA);
});

test("lecturas de cada kanji: kanji_readings en user_kanji, con tamaño máximo", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000001";
  await db.exec(`insert into auth.users (id) values ('${USER}') on conflict do nothing; delete from public.user_kanji;`);
  await db.query("insert into public.user_kanji (user_id, id, kanji_readings) values ($1, '名', $2::jsonb)",
    [USER, JSON.stringify({ めい: { ok: 3, ko: 1, last: "2026-10-26" } })]);
  const { rows } = await db.query("select kanji_readings from public.user_kanji where id = '名'");
  assert.deepEqual(rows[0].kanji_readings, { めい: { ok: 3, ko: 1, last: "2026-10-26" } });
  await assert.rejects(db.query("insert into public.user_kanji (user_id, id, kanji_readings) values ($1, '前', $2::jsonb)",
    [USER, JSON.stringify({ x: "a".repeat(4001) })]), /user_kanji_readings_size_check/);
});

test("leer cuenta como repaso: read_streak y last_read_review en user_words, reviews en reading_sessions", async () => {
  const db = await database();
  const USER = "00000000-0000-0000-0000-000000000001";
  await db.exec(`insert into auth.users (id) values ('${USER}') on conflict do nothing; delete from public.user_words; delete from public.reading_sessions;`);
  await db.query("insert into public.user_words (user_id, id, lemma, reading) values ($1, '名前|なまえ', '名前', 'なまえ')", [USER]);
  const { rows } = await db.query("select read_streak, last_read_review from public.user_words");
  assert.deepEqual(rows, [{ read_streak: 0, last_read_review: null }]); // las que ya existían, a 0
  await db.query("insert into public.reading_sessions (user_id, id, text_id, reviews) values ($1, 's1', 't1', $2::jsonb)",
    [USER, JSON.stringify({ "名前|なまえ": "good" })]);
  const { rows: sessions } = await db.query("select reviews from public.reading_sessions");
  assert.deepEqual(sessions[0].reviews, { "名前|なまえ": "good" });
});
