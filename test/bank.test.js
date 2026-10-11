const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBank } = require("../tools/lib/bank.js");

test("el banco se carga entero en Node", () => {
  const BANK = loadBank();
  assert.ok(BANK.words.size > 6000);
  assert.equal(BANK.words.get("角|かど").r, "かど");
  assert.ok(BANK.byWriting.get("角").length > 1); // homógrafos como entradas distintas
  assert.ok(BANK.frequency["日|ひ"] > 0);
});
