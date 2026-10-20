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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`;

let dbPromise = null;
const database = () => dbPromise ??= (async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
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
