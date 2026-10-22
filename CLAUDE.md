# Kanji Learning App

Web app para estudiar japonés (kanjis, vocabulario, lectura y traducción). HTML/CSS/JS sin
framework ni compilación: se publica tal cual en GitHub Pages. Interfaz en español e inglés.
Funciona sin cuenta (todo en IndexedDB); con cuenta sincroniza con Supabase.

## Comandos

- `npm test`: pruebas con `node --test` (carpeta `test/`). Deben pasar todas antes de un commit.
- `npm run smoke`: prueba de humo en Chrome sin ventana (`tools/smoke.mjs` + `tools/smoke-extra.mjs`).
  Con `SMOKE_SHOTS=<carpeta>` guarda capturas de escritorio y móvil para revisarlas.
- La integración continua (`.github/workflows/test.yml`) ejecuta las dos en cada push.
- Para probar a mano: servir la carpeta con cualquier servidor estático (`python3 -m http.server`).

## Arquitectura

Scripts clásicos (no módulos) que comparten variables globales. El orden de carga de
`index.html` importa:

`config.js` → `i18n.js` → `vendor/ts-fsrs` → `bank/*.js` → `study-config.js` → `learning-core.js`
→ `ja-core.js` → `sentences-core.js` → `translate-core.js` → `texts.js` → `reading.js`
→ `reading-stats.js` → `reading-sync.js` → `study.js` → `sentences.js` → `translate.js`
→ `progress.js` → `dictionary.js` → `app.js` (`progress-core.js` y `grammar-core.js` van justo
después de `learning-core.js`)

- **`*-core.js`**: reglas puras, sin DOM ni datos del usuario. Las usan el navegador y Node
  (`tools/`, `test/`) mediante `if (typeof module !== "undefined") module.exports = …`. La lógica
  nueva que se pueda probar va aquí, con su prueba en `test/`.
- **`app.js`**: IndexedDB (`DB_VERSION`), preferencias (`prefs`, en localStorage), navegación,
  Ajustes y sincronización general.
- **`study.js`**: Repasar (repaso espaciado con FSRS, modos «Escribir la lectura» / «Tarjetas»,
  presentación «Palabra sola» / «En una frase»), Escribir kanjis y Agregar palabra.
  Los números ajustables están en `study-config.js`.
- **`sentences.js` / `sentences-core.js`**: frases de ejemplo (de los textos del usuario y de
  `bank/sentences/<nivel>.json`). La única regla de validez es `validateSentence`; la elección
  de frase, `chooseSentence` / `chooseKanjiSentence`.
- **`texts.js`, `reading*.js`**: textos (IA, comunidad o pegados), lector, nivel de lectura y su sincronización.
- **`translate*.js`**: sección Traducir, corregida con IA (Edge Function `grade-translation`).
- **`dictionary.js`**: búsqueda por escritura, kana, rōmaji o significado.
- **`progress.js` / `progress-core.js`**: Mis palabras → Análisis (solo premium, `isPremium`): lo
  demostrado por nivel JLPT, nivel estimado y foto semanal (`meta.snapshots`, tabla
  `progress_snapshots`). Fases 1 a 3 hechas (la hoja de ruta, `buildRoadmap`, guarda `meta.roadmap`:
  sus palabras suben en el repaso con el peso `roadmap` y sus estructuras van al prompt de los
  textos); falta la fase 4 (vista del profesor y resumen con IA).
- **`grammar-core.js`**: catálogo de gramática (`GRAMMAR`, hoy solo N5), detector sobre las piezas
  de kuromoji de la frase entera (`detectGrammar`) y medición (`grammarStates`). Una estructura
  nueva lleva su regla, su ejemplo y, si se parece a otra, un caso en «no confunde» de
  `test/grammar.test.js`. Los ids se guardan en las fotos: no se cambian.
- **`bank/`**: banco de palabras y kanjis por nivel JLPT (N5–N1), frecuencias y
  `readings.js` (lectura de cada kanji por palabra, generado desde JmdictFurigana con
  `tools/build-readings.mjs`; no se edita a mano).
- **`supabase/`**: `schema.sql` (tablas y Row Level Security) y Edge Functions
  (`generate-text`, `generate-sentences`, `grade-translation`, `notify-admin`). No hay CLI de
  Supabase: el usuario ejecuta `schema.sql` y despliega las funciones desde el panel (pasos en
  `SETUP.md`). `admin.html` / `admin.js`: moderación.
- **Prompts con copia en una función**: la fuente de los textos es `reading.js` y la de las frases,
  `tools/lib/sentence-batches.js`. Tras cambiar uno, `node tools/sync-prompt.mjs` (una prueba falla
  si las copias no coinciden).
- **`vendor/`**: kuromoji (análisis del japonés) y ts-fsrs, con versión fija.
- **`sw.js`**: service worker; red primero para la app y caché permanente para `vendor/`.

Progreso del usuario: `userWords` (clave `"escritura|lectura"`) y `userKanji` (clave el carácter),
con la tarjeta FSRS en `record.fsrs`. `meta` guarda el historial diario, el perfil de lectura y
`meta.practice` («Lecturas de kanji practicadas»).

## Convenciones

- Código, comentarios, commits y documentación en **español**. Los comentarios explican el
  porqué, con ejemplos en japonés (学校 がっこう → 学|がく). Mantén la densidad y el tono del
  archivo que edites.
- Textos de la interfaz: se escriben en español y se traducen con `t("…")`. La clave es el texto
  en español y la traducción inglesa se añade a `EN` en `i18n.js`. El HTML fijo se traduce solo si
  su texto está en `EN`.
- Los colores se definen como variables en `:root` de `style.css`, con su versión para modo
  oscuro. Nada de fondos rellenos en el resaltado de frases: el usuario imprime en blanco y negro.
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
- `bank/sentences/<nivel>.json` se rehace con `node tools/generate-sentences.mjs ingest`; no se
  edita a mano. Las tandas de prompts y respuestas viven en `tools/cache/`, que no se sube.
- Rama de trabajo: `desarrollo`; `main` es la publicada. No hagas push sin que se pida.
