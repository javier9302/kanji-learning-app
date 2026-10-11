/* Pasos de la prueba de humo de las funciones nuevas (diccionario y frases).
   Los llama tools/smoke.mjs después de los pasos básicos. */
export default async function extra({ page, step, check }) {
  await step("diccionario: buscar en romaji abre la vista con resultados", async () => {
    await page.type("#dictInput", "mizu");
    await page.waitForSelector(".dict-row", { timeout: 5000 });
    check(await page.evaluate(() => document.body.dataset.view === "dict"), "no se abrió la vista");
    check(await page.evaluate(() => dictState.results[0].id === "水|みず"), "水 no es el primer resultado");
  });
}
