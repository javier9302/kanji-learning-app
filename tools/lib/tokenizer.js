/* kuromoji en Node, con el MISMO diccionario que usa la app (vendor/kuromoji/dict),
   para que las herramientas y el navegador analicen igual. */
const path = require("node:path");
const kuromoji = require("kuromoji");

let promise = null;

function loadTokenizer() {
  return promise ??= new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: path.join(__dirname, "../../vendor/kuromoji/dict") })
      .build((error, tokenizer) => error ? reject(error) : resolve(tokenizer));
  });
}

module.exports = { loadTokenizer };
