/* El prompt de los textos tiene una sola fuente (reading.js); generate-text
   lleva una copia exacta. Si cambias uno: node tools/sync-prompt.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { promptParts, plain } from "../tools/sync-prompt.mjs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("el prompt de generate-text es el mismo que el de la app", () => {
  const client = promptParts(read("reading.js"));
  const server = promptParts(read("supabase/functions/generate-text/index.ts"));
  assert.equal(server.version, client.version, "SEGMENTED_VERSION distinta: ejecuta node tools/sync-prompt.mjs");
  assert.equal(plain(server.body), client.body, "renderPromptSeg distinto: ejecuta node tools/sync-prompt.mjs");
});
