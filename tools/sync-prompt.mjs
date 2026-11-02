/* Los prompts tienen una sola fuente y las Edge Functions llevan una copia,
   porque se despliegan solas desde el editor de Supabase. Este script las copia:
     node tools/sync-prompt.mjs
   - Textos: reading.js (renderPromptPlain y PLAIN_VERSION, y el de reserva
     renderPromptSeg y SEGMENTED_VERSION) -> generate-text
   - Frases: tools/lib/sentence-batches.js (renderSentencePrompt y
     SENTENCE_PROMPT_VERSION) -> generate-sentences
   - Revisión de Tatoeba: tools/lib/tatoeba.js (renderReviewPrompt y
     REVIEW_PROMPT_VERSION) -> review-sentences
   - Limpieza de las listas de palabras: story-core.js (bloque «listas-limpias»)
     -> generate-text
   Después hay que volver a desplegar la función que haya cambiado. La prueba
   test/prompt.test.mjs falla si alguna copia no coincide. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Cada prompt: dónde está su fuente, dónde va la copia, la función y su
   constante de versión, y cómo se escribe su firma con los tipos de TypeScript */
export const PROMPTS = {
  text: {
    source: "reading.js", target: "supabase/functions/generate-text/index.ts",
    fn: "renderPromptSeg", version: "SEGMENTED_VERSION",
    untyped: "scenes = [] })", typed: "scenes = [] }: any)"
  },
  plain: {
    source: "reading.js", target: "supabase/functions/generate-text/index.ts",
    fn: "renderPromptPlain", version: "PLAIN_VERSION",
    untyped: "feedback = null })", typed: "feedback = null }: any)"
  },
  sentences: {
    source: "tools/lib/sentence-batches.js", target: "supabase/functions/generate-sentences/index.ts",
    fn: "renderSentencePrompt", version: "SENTENCE_PROMPT_VERSION",
    untyped: "units = [5, 12] })", typed: "units = [5, 12] }: any)"
  },
  review: {
    source: "tools/lib/tatoeba.js", target: "supabase/functions/review-sentences/index.ts",
    fn: "renderReviewPrompt", version: "REVIEW_PROMPT_VERSION",
    untyped: "{ batch, items })", typed: "{ batch, items }: any)"
  }
};

/* Bloques de código que una función lleva copiados tal cual, entre dos marcas
   «// <nombre>» y «// </nombre>» (la limpieza de las listas de palabras) */
export const REGIONS = [
  { name: "listas-limpias", source: "story-core.js", target: "supabase/functions/generate-text/index.ts" }
];

/* Lo que hay entre las marcas de un bloque (sin ellas) */
export function regionParts(source, name) {
  const open = `// <${name}>`, close = `// </${name}>`;
  const start = source.indexOf(open), end = source.indexOf(close);
  if (start < 0 || end < start) throw new Error(`No se encontraron las marcas ${open}`);
  const from = source.indexOf("\n", start) + 1;
  return { from, to: end, body: source.slice(from, end) };
}

/* La función entera y el valor de su constante de versión en un archivo */
export function promptParts(source, { fn, version } = PROMPTS.text) {
  const start = source.indexOf(`function ${fn}(`);
  const end = source.indexOf("\n}\n", start) + 3;
  const value = new RegExp(`const ${version} = "([^"]+)";`).exec(source);
  if (start < 0 || end < 3 || !value) throw new Error(`No se encontró ${fn} o ${version}`);
  return { start, end, body: source.slice(start, end), version: value[1] };
}
/* Sin los tipos de TypeScript, para comparar */
export const plain = (body, prompt = PROMPTS.text) => body.replace(prompt.typed, prompt.untyped);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const prompt of Object.values(PROMPTS)) {
    const client = promptParts(fs.readFileSync(path.join(ROOT, prompt.source), "utf8"), prompt);
    const file = path.join(ROOT, prompt.target);
    let target = fs.readFileSync(file, "utf8");
    const current = promptParts(target, prompt);
    target = target.slice(0, current.start) + client.body.replace(prompt.untyped, prompt.typed) + target.slice(current.end);
    target = target.replace(new RegExp(`const ${prompt.version} = "[^"]+";`), `const ${prompt.version} = "${client.version}";`);
    fs.writeFileSync(file, target);
    console.log(`${prompt.fn} copiado a ${prompt.target} (versión ${client.version}).`);
  }
  for (const region of REGIONS) {
    const body = regionParts(fs.readFileSync(path.join(ROOT, region.source), "utf8"), region.name).body;
    const file = path.join(ROOT, region.target);
    const target = fs.readFileSync(file, "utf8");
    const current = regionParts(target, region.name);
    fs.writeFileSync(file, target.slice(0, current.from) + body + target.slice(current.to));
    console.log(`«${region.name}» copiado a ${region.target}.`);
  }
  console.log("Vuelve a desplegar las funciones que hayan cambiado.");
}
