/* Descargas y resultados intermedios de las herramientas: todo va a tools/cache/
   (fuera del repositorio). Lo ya descargado no se vuelve a pedir. */
const fs = require("node:fs");
const path = require("node:path");

const CACHE = path.join(__dirname, "../cache");

function cachePath(...parts) {
  const file = path.join(CACHE, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/* Descarga una dirección a tools/cache/<carpeta>/<nombre> (una sola vez) y devuelve la ruta */
async function download(url, folder, name) {
  const file = cachePath(folder, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  console.error(`Descargando ${url} …`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const partial = `${file}.part`;
  fs.writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(partial, file); // a medias no cuenta como descargado
  return file;
}

module.exports = { CACHE, cachePath, download };
