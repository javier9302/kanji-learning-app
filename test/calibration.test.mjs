/* Los datos de la calibración son válidos para la función: así no se gasta
   ninguna llamada real en una petición que se iba a rechazar. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { readParams } from "../supabase/functions/grade-translation/index.ts";

const require = createRequire(import.meta.url);
const { tokensFor } = require("../tools/lib/analyse.js");
const sentences = JSON.parse(fs.readFileSync(new URL("../tools/calibration/sentences.json", import.meta.url), "utf8"));

test("calibración: 30 frases con 4 respuestas por idioma, todas aceptadas por la función", async () => {
  assert.equal(sentences.length, 30);
  for (const sentence of sentences) {
    const tokens = await tokensFor(sentence.ja);
    const units = tokens.map((token) => ({ surface: token.surface, lemma: token.lemma, reading: token.reading || "",
      content: !["particle", "auxiliary", "punctuation", "symbol", "number", "proper_noun"].includes(token.pos) && !!token.key }));
    assert.ok(units.filter((unit) => unit.content).length >= 2, `${sentence.id}: pocas palabras resueltas`);
    for (const lang of ["es", "en"]) {
      assert.equal(sentence.answers[lang].length, 4, sentence.id);
      for (const answer of sentence.answers[lang]) {
        const params = readParams({ sentenceId: sentence.id, ja: sentence.ja.split("|").join(""), units,
          reference: { en: sentence.en, es: sentence.es }, answer, lang });
        assert.ok(params, `${sentence.id} ${lang}: "${answer}"`);
      }
    }
  }
});
