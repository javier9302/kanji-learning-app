/* Cada CSS y JS propio de index.html y admin.html lleva la huella de su
   contenido (tools/stamp-assets.mjs): si un archivo cambia y la huella no, el
   navegador podría mezclar la página nueva con el archivo viejo. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stampHTML, ROOT, PAGES } from "../tools/stamp-assets.mjs";

for (const page of PAGES) {
  test(`${page}: las huellas de sus CSS y JS están al día (si no: node tools/stamp-assets.mjs)`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.equal(stampHTML(html), html);
    assert.match(html, /style\.css\?v=[0-9a-f]{8}"/);
  });
}
