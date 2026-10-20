/* El banco de la app (bank/*.js) cargado en Node. Los archivos son scripts de
   navegador que llaman a BANK.add(…): se ejecutan en un contexto aparte. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "../..");
let bank = null;

function loadBank() {
  if (bank) return bank;
  const context = vm.createContext({});
  const run = (file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  run("bank/bank.js");
  run("bank/frequency.js");
  if (fs.existsSync(path.join(ROOT, "bank/aliases.js"))) run("bank/aliases.js");
  bank = vm.runInContext("BANK", context);
  for (const level of bank.LEVELS) run(`bank/${level.toLowerCase()}.js`);
  return bank;
}

module.exports = { loadBank, ROOT };
