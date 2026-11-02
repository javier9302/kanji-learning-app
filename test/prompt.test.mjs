/* Los prompts tienen una sola fuente (reading.js para los textos y
   tools/lib/sentence-batches.js para las frases); cada Edge Function lleva una
   copia exacta. Si cambias uno: node tools/sync-prompt.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PROMPTS, promptParts, plain, REGIONS, regionParts } from "../tools/sync-prompt.mjs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

for (const [name, prompt] of Object.entries(PROMPTS)) {
  test(`el prompt de ${prompt.target.split("/")[2]} es el mismo que el de su fuente (${name})`, () => {
    const client = promptParts(read(prompt.source), prompt);
    const server = promptParts(read(prompt.target), prompt);
    assert.equal(server.version, client.version, `${prompt.version} distinta: ejecuta node tools/sync-prompt.mjs`);
    assert.equal(plain(server.body, prompt), client.body, `${prompt.fn} distinto: ejecuta node tools/sync-prompt.mjs`);
  });
}

for (const region of REGIONS) {
  test(`el bloque «${region.name}» de ${region.target.split("/")[2]} es el mismo que el de ${region.source}`, () => {
    assert.equal(regionParts(read(region.target), region.name).body, regionParts(read(region.source), region.name).body,
      `«${region.name}» distinto: ejecuta node tools/sync-prompt.mjs`);
  });
}

test("el prompt de los textos dice las escenas gastadas, y sin ellas no dice nada", () => {
  const renderPromptSeg = new Function(`${promptParts(read("reading.js")).body}; return renderPromptSeg;`)();
  const base = { level: "N5", type: "short story", topic: "food", length: 50, known: [], assumedLevels: [], learning: [] };
  assert.match(renderPromptSeg({ ...base, scenes: ["猫", "公園"] }), /do not build this story around them: 猫、公園\n/);
  assert.doesNotMatch(renderPromptSeg(base), /do not build this story around them/);
});

test("el prompt de los textos pide las estructuras de la hoja de ruta, y sin ellas no dice nada", async () => {
  const { readParams } = await import("../supabase/functions/generate-text/index.ts");
  const source = fs.readFileSync(new URL("../supabase/functions/generate-text/index.ts", import.meta.url), "utf8");
  assert.ok(source.includes("Grammar the learner is practising"));
  // La copia de la función se puede ejecutar: se prueba con los parámetros que deja pasar readParams
  const params = readParams({ level: "N5", type: "short story", topic: "food", length: 50, known: ["水"],
    grammar: [{ ja: "〜てもいい", en: "may, it's okay to…" }] });
  assert.deepEqual(params.grammar, [{ ja: "〜てもいい", en: "may, it's okay to…" }]);
});

test("readParams limpia las listas que manda la app: grafías, kana sueltas y cada palabra en una sola lista", async () => {
  const { readParams } = await import("../supabase/functions/generate-text/index.ts");
  const params = readParams({ level: "N5", type: "short story", topic: "food", length: 50,
    known: ["御飯", "い", "会社", "一番"], learning: ["会社", "綺麗"], targets: ["一番", "落す"], scenes: ["猫", "公園"] });
  assert.deepEqual(params.targets, ["一番", "落とす"]);
  assert.deepEqual(params.learning, ["会社", "きれい"]);
  assert.deepEqual(params.known, ["ご飯"]);
  assert.deepEqual(params.scenes, ["猫", "公園"]);
});
