/* study-config.js (un script de navegador) cargado en Node, para las pruebas */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadStudyConfig() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../study-config.js"), "utf8"), context);
  return JSON.parse(JSON.stringify(vm.runInContext("STUDY_CONFIG", context)));
}

module.exports = { loadStudyConfig };
