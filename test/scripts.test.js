/* Los scripts de la app se cargan tal cual en el navegador: un error de sintaxis
   en uno (i18n.js, por ejemplo) rompe la app entera aunque las demás pruebas pasen. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const scripts = [...fs.readFileSync(path.join(ROOT, "index.html"), "utf8").matchAll(/<script src="([^"]+\.js)"/g)]
  .map((match) => match[1]).filter((src) => !src.startsWith("http"));

test("index.html carga scripts que existen y se pueden analizar", () => {
  assert.ok(scripts.length > 20, scripts.join(" "));
  for (const src of [...scripts, "admin.js", "sw.js"]) {
    const code = fs.readFileSync(path.join(ROOT, src), "utf8");
    assert.doesNotThrow(() => new vm.Script(code, { filename: src }), `${src} no se puede analizar`);
  }
});
