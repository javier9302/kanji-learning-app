# Kanji Learning App (Yomipop)

Web app para estudiar japonés (kanjis, vocabulario, lectura y traducción). HTML/CSS/JS sin
framework ni compilación: se publica tal cual en GitHub Pages. Interfaz en español e inglés.
Funciona sin cuenta (todo en IndexedDB); con cuenta sincroniza con Supabase.

## Comandos

- `npm test`: pruebas con `node --test` (carpeta `test/`). Deben pasar todas antes de un commit.
- `npm run smoke`: prueba de humo en Chrome sin ventana (`tools/smoke.mjs` + `tools/smoke-extra.mjs`).
  Con `SMOKE_SHOTS=<carpeta>` guarda capturas de escritorio y móvil para revisarlas.
- `node tools/stamp-assets.mjs`: tras cambiar cualquier CSS o JS que carguen `index.html` o
  `admin.html`, actualiza su huella (`style.css?v=…`); si no, `npm test` falla. Sin huella, al
  publicar el navegador mezclaba la página nueva con el CSS viejo.
- La integración continua (`.github/workflows/test.yml`) ejecuta las dos en cada push.
- Para probar a mano: servir la carpeta con cualquier servidor estático (`python3 -m http.server`).

## Arquitectura

Scripts clásicos (no módulos) que comparten variables globales. El orden de carga de
`index.html` importa:

`darumi.js` → `config.js` → `i18n.js` → `vendor/ts-fsrs` → `bank/*.js` → `study-config.js` → `kana-core.js` → `learning-core.js`
→ `ja-core.js` → `sentences-core.js` → `capture-core.js` → `kanji-core.js` → `ranking-core.js` → `story-core.js` → `translate-core.js` → `texts.js` → `reading.js`
→ `reading-stats.js` → `reading-sync.js` → `study.js` → `sentences.js` → `translate.js`
→ `progress.js` → `kanji-table.js` → `proof.js` → `kana.js` → `today.js` → `dictionary.js` → `capture.js` → `notify.js` → `app.js` (`progress-core.js` y `grammar-core.js` van justo
después de `learning-core.js`)

- **`*-core.js`**: reglas puras, sin DOM ni datos del usuario. Las usan el navegador y Node
  (`tools/`, `test/`) mediante `if (typeof module !== "undefined") module.exports = …`. La lógica
  nueva que se pueda probar va aquí, con su prueba en `test/`.
- **`app.js`**: IndexedDB (`DB_VERSION`), preferencias (`prefs`, en localStorage), navegación,
  Ajustes y sincronización general.
- **`study.js`**: Repasar (repaso espaciado con FSRS, modos «Escribir la lectura» / «Tarjetas»,
  presentación «Palabra sola» / «En una frase»), Escribir kanjis (también con FSRS: tarjeta propia
  `writeFsrs` por kanji; qué sale y cómo se valora en `learning-core.js`) y Agregar palabra.
  Los números ajustables están en `study-config.js`. Al responder: veredicto con Darumi
  (`showVerdict` en `app.js`) y «También sale en», otras palabras de cada kanji (`kanjiAlsoIn`,
  sección 6 de `kanji-core.js`).
- **`sentences.js` / `sentences-core.js`**: frases de ejemplo (de los textos del usuario y de
  `bank/sentences/<nivel>.json`). La única regla de validez es `validateSentence`; la elección
  de frase, `chooseSentence` / `chooseKanjiSentence`.
- **`texts.js`, `reading*.js`**: textos (IA, comunidad o pegados), lector, nivel de lectura y su sincronización.
- **`translate*.js`**: sección Traducir, corregida con IA (Edge Function `grade-translation`).
- **`kana.js` / `kana-core.js`**: hiragana y katakana para quien empieza de cero (por filas, tarjeta
  FSRS por kana en `meta.kana`, solo en el dispositivo; sin pestaña, se abre desde Hoy).
- **Revisión del 2026-11-11** (auditoría con plan por etapas): hechas la 1 (lo acertado una vez
  recibe tarjeta, `pre_known` caduca con `knownRecord`, `pickDue`, registro de repasos en el almacén
  `reviews`), la 2 (significado en Repasar, `needsMeaningCheck`; palabras en kana con tarjeta,
  `ensureKanaEntries`; `pickDistractors`), la 3 (kana) y parte de la 4 (`enable_fuzz`, leer cuenta
  como Bien, `retentionFromLog`). Falta: ajustar los pesos de FSRS con el registro, sincronizar el
  registro y las kanas, y la etapa 5 (premium comprobado en el servidor, pagos, audio, gramática N4).
- **`dictionary.js`**: búsqueda por escritura, kana, rōmaji o significado.
- **`capture.js` / `capture-core.js`**: palabras desde la web (`?add=…`, marcador «+ Kanji»,
  `share_target` de Android). Abre Agregar palabra relleno y guarda la frase como frase del usuario
  (`source: "web"`), que manda en el repaso de su palabra (`chooseCapturedSentence`). Nunca se
  comparte.
- **`progress.js` / `progress-core.js`**: Mis palabras → Análisis (solo premium, `isPremium`): lo
  demostrado por nivel JLPT, nivel estimado y foto semanal (`meta.snapshots`, tabla
  `progress_snapshots`). Fases 1 a 3 hechas (la hoja de ruta, `buildRoadmap`, guarda `meta.roadmap`:
  sus palabras suben en el repaso con el peso `roadmap` y sus estructuras van al prompt de los
  textos). Fase 4: resumen semanal con IA (`summarize-progress`, solo con los números ya
  calculados) y vista del profesor (`admin.html` → Progreso, que carga `study-config.js` y
  `progress-core.js`). Propuesto en el chat del 2026-10-22 y sin hacer: pronóstico a 6 meses.
- **`kanji-table.js` / `kanji-core.js`**: Mis palabras → Kanjis (premium). El estado de cada kanji
  (dominado, parcial, sin conocer) se deduce de las palabras que conoce (`kanjiStates`), con sus
  lecturas relevantes de `bank/kanji-info.js` (generado con `tools/build-kanji.mjs` desde KANJIDIC2;
  no se edita a mano). Plan «progresión por palabras» del chat del 2026-10-26: hechas A (la tabla)
  y B (una casilla por kanji al escribir la lectura en Repasar, `readingBoxes` / `gradeBoxes`; lo
  acertado por lectura va a `userKanji[c].readings`, columna `kanji_readings`) y C (orden de las
  palabras nuevas en `ranking-core.js`: frecuencia, puente i+1, desbloqueo, lecturas que faltan y
  MMR; pesos en `STUDY_CONFIG.ranking`; `newWordCandidates` lo aplica debajo de las razones del
  estudiante) y E (exportar v2 con el orden y los kanjis; importar una lista, `parseQueueText` /
  `resolveQueue` en `ranking-core.js`, que se guarda en `meta.queue` y va primero; formatos en
  `README.md`); queda D (temas con embeddings: el componente `topic`, hoy con peso 0;
  `topicProfile` del archivo, hoy `null`).
- **Plan «Siguiente nivel»** (chat del 2026-10-27, el prompt con 8 etapas): etapa 1, aprender todo
  conectado. Hecho: 1.2, leer cuenta como repaso (`readingCredit` / `readingInterval` en
  `learning-core.js`, `applyReadingReview` en `study.js`, `reviewByReading` en `reading.js`), y
  1.1 + 4.2, textos con las palabras que tocan y más variados (`story-core.js`: `storyTargets`,
  `nextVariety`, `textSimilarity`; personajes en `CAST` dentro de `renderPromptSeg`), y 1.3,
  Escribir solo con lo visto y de simple a complejo (`nextWritingKanji`; trazos en
  `bank/kanji-info.js`), y 1.4, Traducir prefiere frases con las que tocan (peso `due` de
  `translate.choose`), y 1.5, la pantalla «Hoy» (`today.js`, `planToday`), que es la de inicio.
  Etapa 1 terminada. Después (chat del 2026-10-30): los pasos cortos esperan su hora en la sesión
  (`nextReadyCard`, `recordDue`), demostrar los kanjis de un nivel (`proof.js`, sección 5 de
  `kanji-core.js`, `userKanji[c].proofAt`) y avisos de repaso (`notify.js`, Web Push: tabla
  `push_subscriptions`, función `notify-due` llamada cada hora por pg_cron; sección 13 de
  `docs/COMO-FUNCIONA.md`).
  Orden acordado de las demás: 3 (añadir palabras desde la web), 2 (lo que falta de pegar textos),
  4.1, 5, 6, 7, 8.
- **`grammar-core.js`**: catálogo de gramática (`GRAMMAR`, hoy solo N5), detector sobre las piezas
  de kuromoji de la frase entera (`detectGrammar`) y medición (`grammarStates`). Una estructura
  nueva lleva su regla, su ejemplo y, si se parece a otra, un caso en «no confunde» de
  `test/grammar.test.js`. Los ids se guardan en las fotos: no se cambian.
- **`bank/`**: banco de palabras y kanjis por nivel JLPT (N5–N1), frecuencias y
  `readings.js` (lectura de cada kanji por palabra, generado desde JmdictFurigana con
  `tools/build-readings.mjs`; no se edita a mano).
- **`supabase/`**: `schema.sql` (tablas y Row Level Security) y Edge Functions
  (`generate-text`, `generate-sentences`, `grade-translation`, `summarize-progress`, `notify-admin`,
  `review-sentences`, `notify-due`). No hay CLI de
  Supabase: el usuario ejecuta `schema.sql` y despliega las funciones desde el panel (pasos en
  `SETUP.md`). `admin.html` / `admin.js`: moderación.
- **Listas del prompt de los textos**: `promptParams` (`reading.js`, asíncrona: espera a kuromoji)
  pasa las palabras por `cleanWordLists` (`story-core.js`, sección 4) y añade las escenas gastadas
  (`overusedScenes`, sección 5). El bloque «listas-limpias» de `story-core.js` va copiado en
  `generate-text` (lo copia `tools/sync-prompt.mjs`). Plan del chat del 2026-11-02 con 3 etapas:
  hechas la 1 (listas limpias) y la 2 (al leer se guarda el lema de kuromoji y nada de partículas,
  kana sueltas ni trozos sin entrada: `fromSegmented` / `validateText` en `texts.js` para los textos
  nuevos y `textKeyMap` en `reading.js` para los ya guardados; regla común `savedWord`, sección 6 de
  `story-core.js`; migración de una vez con lista previa y copia, `offerWordCleanup` en `reading.js`,
  `prefs.wordCleanup`; lo borrado se sube con `deleted_at` en `user_words`, `deletedWords`,
  `pushWordDeletions`; `tools/word-cleanup.mjs` calcula la lista sobre una copia). Falta la 3 (texto
  sin «|», segmentado por la app, con comprobación y un reintento).
- **Prompts con copia en una función**: la fuente de los textos es `reading.js`; la de las frases,
  `tools/lib/sentence-batches.js`, y la de la revisión de Tatoeba, `tools/lib/tatoeba.js`. Tras cambiar uno, `node tools/sync-prompt.mjs` (una prueba falla
  si las copias no coinciden).
- **`vendor/`**: kuromoji (análisis del japonés) y ts-fsrs, con versión fija.
- **`sw.js`**: service worker; red primero para la app (sin la caché HTTP del navegador, `fresh`)
  y caché permanente para `vendor/`.

Progreso del usuario: `userWords` (clave `"escritura|lectura"`) y `userKanji` (clave el carácter),
con la tarjeta FSRS en `record.fsrs` (y, en los kanjis, lo acertado de cada lectura en `record.readings`). `meta` guarda el historial diario, el perfil de lectura y
`meta.practice` («Lecturas de kanji practicadas»).

## Convenciones

- Código, comentarios, commits y documentación en **español**. Los comentarios explican el
  porqué, con ejemplos en japonés (学校 がっこう → 学|がく). Mantén la densidad y el tono del
  archivo que edites.
- Textos de la interfaz: se escriben en español y se traducen con `t("…")`. La clave es el texto
  en español y la traducción inglesa se añade a `EN` en `i18n.js`. El HTML fijo se traduce solo si
  su texto está en `EN`.
- Diseño: sistema **Yomipop** (artefacto de Claude; nombre de la app, logos y Darumi en
  `icons/brand/`, `<yomi-darumi>` en `darumi.js`, copia de su `bundle.js`; estados vacíos con
  `darumiHTML`). Los colores se definen como variables en `:root` de `style.css` con los nombres
  de sus tokens, con su versión para modo oscuro (dos bloques iguales: el del sistema y
  `data-theme="dark"`, el tema elegido en Ajustes → Apariencia, `prefs.theme`; una prueba los compara). Nada de fondos rellenos en el resaltado de frases: el usuario imprime en blanco y negro.
- Accesibilidad (revisión del 2026-11-02): texto de la interfaz ≥ 12 px, lo que se toca ≥ 44 px
  (bloque «Legibilidad» al final de `style.css`), resultados con `role="status"`/`"alert"`, rōmaji
  junto al kana con `romajiHTML` (se desactiva en Ajustes), y quien empieza de cero tiene que poder
  usar cada pantalla sin leer japonés.
- Escapa siempre con `escapeHTML` lo que se inserte en HTML.
- Preferencias nuevas: valor por defecto en `prefs` (`app.js`). Si sustituyen a otra, migra la
  antigua al cargar.
- Si cambia el análisis de las frases de los textos, sube `SENTENCE_INDEX_VERSION` (`sentences.js`).
- `SETUP.md` documenta la configuración y las funciones para el administrador: actualízalo si
  cambia algo de lo que describe.

## Mantener la documentación al día (obligatorio)

El usuario trabaja en varios proyectos a la vez y se apoya en estos archivos para saber qué ha
cambiado. En el mismo commit de cada cambio:

- **`CHANGELOG.md`**: añade una línea bajo la fecha del día (crea el apartado si no existe) con lo
  que cambia para quien usa la app, en lenguaje sencillo y con el hash corto del commit cuando lo
  haya. Los cambios internos sin efecto visible van agrupados en una línea.
- **`docs/COMO-FUNCIONA.md`**: si cambia una lista o archivo de datos, un filtro, un orden, un
  número ajustable o lo que enseña una sección, actualiza el apartado correspondiente para que
  describa cómo funciona **ahora** (no el historial).
- Al terminar, dile al usuario qué cambió en esos archivos.

## Restricciones del proyecto

- IA solo con Gemini (claves gratuitas, en los secretos de las Edge Functions). Las frases comunes
  se generan por tandas con `tools/generate-sentences.mjs` (copiar el prompt en un chat y pegar la
  respuesta); las que faltan al repasar las pide la app a `generate-sentences` y se comparten al
  momento, con revisión posterior en admin.html.
- `bank/sentences/<nivel>.json` se rehace con `node tools/generate-sentences.mjs ingest` (las de IA)
  y `node tools/import-tatoeba.mjs ingest` (las de Tatoeba, solo las que aprobó la IA con la función
  `review-sentences` o a mano con `export` / `import`); cada una conserva las de la otra. No se edita a mano. Las tandas de prompts y respuestas viven en `tools/cache/`, que no se sube.
- Rama de trabajo: `desarrollo`; `main` es la publicada. No hagas push sin que se pida.
