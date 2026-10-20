/* El prompt de los textos vive en reading.js (renderPromptSeg y SEGMENTED_VERSION).
   La función generate-text necesita una copia, porque se despliega sola desde el
   editor de Supabase. Este script la copia:   node tools/sync-prompt.mjs
   Después hay que volver a desplegar generate-text. La prueba
   test/prompt.test.js falla si las dos versiones no coinciden. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "reading.js");
const FUNCTION = path.join(ROOT, "supabase/functions/generate-text/index.ts");

/* La función renderPromptSeg entera y la constante de versión de un archivo */
export function promptParts(source) {
  const start = source.indexOf("function renderPromptSeg(");
  const end = source.indexOf("\n}\n", start) + 3;
  const version = /const SEGMENTED_VERSION = "([^"]+)";/.exec(source);
  if (start < 0 || end < 3 || !version) throw new Error("No se encontró renderPromptSeg o SEGMENTED_VERSION");
  return { start, end, body: source.slice(start, end), version: version[1] };
}
/* Sin los tipos de TypeScript, para comparar */
export const plain = (body) => body.replace("prefer = [] }: any)", "prefer = [] })");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = promptParts(fs.readFileSync(CLIENT, "utf8"));
  let target = fs.readFileSync(FUNCTION, "utf8");
  const current = promptParts(target);
  const typed = client.body.replace("prefer = [] })", "prefer = [] }: any)");
  target = target.slice(0, current.start) + typed + target.slice(current.end);
  target = target.replace(/const SEGMENTED_VERSION = "[^"]+";/, `const SEGMENTED_VERSION = "${client.version}";`);
  fs.writeFileSync(FUNCTION, target);
  console.log(`Prompt copiado a generate-text (versión ${client.version}). Vuelve a desplegar la función.`);
}
