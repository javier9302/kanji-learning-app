/* Huella de cada CSS y JS propio en index.html y admin.html: style.css?v=1a2b3c4d.
     node tools/stamp-assets.mjs
   GitHub Pages deja que el navegador guarde cada archivo 10 minutos y, al
   recargar, Chrome reutiliza la hoja de estilo que tiene en memoria sin
   preguntar a nadie (ni al service worker). Justo después de publicar se veía
   la página nueva con el style.css viejo: los dos logos y el tema elegido sin
   aplicar. Con la huella, un archivo que cambia cambia de dirección y nunca se
   mezcla una versión con otra. La huella son 8 caracteres del SHA-256 del
   archivo. La prueba test/stamp.test.mjs falla si alguna no está al día: tras
   cambiar un CSS o JS, ejecuta este script. Los que se cargan después desde JS
   (bank/<nivel>.js, kuromoji) no llevan huella: los pide el service worker sin
   caché HTTP (sw.js, fresh). */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PAGES = ["index.html", "admin.html"];

const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex").slice(0, 8);

/* El HTML con la huella de cada <script src> y <link href> propio de .js o .css */
export function stampHTML(html) {
  return html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#:]+\.(?:js|css))(?:\?v=[0-9a-f]*)?"/g,
    (match, before, file) => `${before}${file}?v=${hash(file)}"`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const page of PAGES) {
    const file = path.join(ROOT, page);
    const before = fs.readFileSync(file, "utf8"), after = stampHTML(before);
    if (after !== before) fs.writeFileSync(file, after);
    console.log(`${page}: ${after === before ? "al día" : "huellas actualizadas"}`);
  }
}
