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
