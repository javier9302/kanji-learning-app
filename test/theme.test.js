/* Tema oscuro: el del sistema y el elegido a mano (Ajustes → Apariencia) son
   dos bloques de style.css que tienen que llevar las mismas variables */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "../style.css"), "utf8");

const declarations = (block) => block.split("\n").map((line) => line.trim()).filter((line) => /^[-a-z]+:/.test(line));

test("el tema oscuro del sistema y el elegido llevan las mismas variables", () => {
  const system = CSS.match(/@media \(prefers-color-scheme: dark\) \{\n  :root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}\n\}/);
  const chosen = CSS.match(/\n:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/);
  assert.ok(system && chosen, "falta uno de los dos bloques");
  assert.deepEqual(declarations(chosen[1]), declarations(system[1]));
  assert.ok(declarations(system[1]).length > 20);
});
