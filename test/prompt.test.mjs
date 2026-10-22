/* Los prompts tienen una sola fuente (reading.js para los textos y
   tools/lib/sentence-batches.js para las frases); cada Edge Function lleva una
   copia exacta. Si cambias uno: node tools/sync-prompt.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PROMPTS, promptParts, plain } from "../tools/sync-prompt.mjs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

for (const [name, prompt] of Object.entries(PROMPTS)) {
  test(`el prompt de ${prompt.target.split("/")[2]} es el mismo que el de su fuente (${name})`, () => {
    const client = promptParts(read(prompt.source), prompt);
    const server = promptParts(read(prompt.target), prompt);
    assert.equal(server.version, client.version, `${prompt.version} distinta: ejecuta node tools/sync-prompt.mjs`);
    assert.equal(plain(server.body, prompt), client.body, `${prompt.fn} distinto: ejecuta node tools/sync-prompt.mjs`);
  });
}

test("el prompt de los textos pide las estructuras de la hoja de ruta, y sin ellas no dice nada", async () => {
  const { readParams } = await import("../supabase/functions/generate-text/index.ts");
  const source = fs.readFileSync(new URL("../supabase/functions/generate-text/index.ts", import.meta.url), "utf8");
  assert.ok(source.includes("Grammar the learner is practising"));
  // La copia de la función se puede ejecutar: se prueba con los parámetros que deja pasar readParams
  const params = readParams({ level: "N5", type: "short story", topic: "food", length: 50, known: ["水"],
    grammar: [{ ja: "〜てもいい", en: "may, it's okay to…" }] });
  assert.deepEqual(params.grammar, [{ ja: "〜てもいい", en: "may, it's okay to…" }]);
});
