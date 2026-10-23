# Cómo funciona la app

Referencia de qué listas usa la app y cómo decide qué enseñar a cada usuario. Se actualiza en el
mismo commit que cambie cualquiera de estas reglas. Los cambios, con fecha, están en
[CHANGELOG.md](../CHANGELOG.md).

## Secciones

| Sección | Qué hace |
|---|---|
| **Leer** | Textos en japonés (generados por IA, de la comunidad o pegados) con furigana según el nivel. Tocar una palabra enseña su lectura y su significado. Al terminar, una evaluación corta de las palabras del texto. |
| **Repasar** | Repaso espaciado (FSRS) de palabras y kanjis. Modo «Escribir la lectura» o «Tarjetas»; presentación «Palabra sola» o «En una frase». |
| **Traducir** | El usuario traduce frases de sus textos y lo corrige la IA (o él mismo con la traducción de referencia). Mide si entiende el significado; no mueve el calendario de repaso. |
| **Escribir** | Trazos de kanjis (KanjiVG) con repaso espaciado: primero los kanjis que ya has visto y los que toca repasar, y una prueba para saltarse un nivel. |
| **Diccionario** | Búsqueda por kanji, kana, rōmaji o significado (español o inglés). |
| **Mis palabras** | Agregar palabras a mano, progreso y estadísticas. **Análisis** (solo premium): lo demostrado por nivel JLPT, nivel estimado y evolución semanal. |
| **Cuenta** (opcional) | Sincronización con Supabase, plan gratuito (10 textos de IA al día) o premium (30). |
| **admin.html** | Aprobar textos de la comunidad, revisar palabras, traducciones y frases compartidas, cambiar planes y ver el progreso de cada estudiante (pestaña Progreso). |

## Listas y archivos de datos

| Archivo | Contenido | Origen | ¿Se edita a mano? |
|---|---|---|---|
| `bank/n5.js` … `bank/n1.js` | Palabras (escritura, lectura, significados en/es, otras lecturas válidas, ambigua, casi siempre en kana) y kanjis (carácter, significados, on, kun) de cada nivel JLPT | Listas JLPT de open-anki-jlpt-decks + JMdict y KANJIDIC2 | No |
| `bank/bank.js` | Carga los niveles y documenta el formato | — | Sí |
| `bank/frequency.js` | Puesto de frecuencia de cada palabra (1 = la más usada) y palabras en kana por frecuencia | Lista de frecuencia que no se publica | No |
| `bank/aliases.js` | Otras escrituras de una palabra del banco (終る = 終わる, 御飯 = ご飯) | `tools/build-dictionary.mjs` desde JMdict | No |
| `bank/readings.js` | Qué lectura de cada kanji ejercita cada palabra (学校 → 学がく, 校こう) | `tools/build-readings.mjs` desde JmdictFurigana | No |
| `bank/AMBIGUAS.md` | Notas sobre las palabras con varias lecturas y significados | — | Sí |
| `vendor/jmdict/common-<fecha>.json` | Diccionario general: palabras comunes que no están en el banco | `tools/build-dictionary.mjs` desde JMdict | No |
| `bank/sentences/<nivel>.json` | Frases comunes de ejemplo, con traducción | IA por tandas: `tools/generate-sentences.mjs` | No |
| Tabla `shared_sentences` (Supabase) | Frases compartidas por todos: las de historias que se usaron y las que escribió la IA para palabras sin frase | La app, al repasar «En una frase» | Se borran en admin.html → Frases |
| `grammar-core.js` (`GRAMMAR`) | Catálogo de gramática: 56 estructuras de N5 (partículas, です/ます y sus formas, forma て, 〜たい, 〜から…), cada una con su regla de detección y un ejemplo | Escrito a mano sobre el análisis de kuromoji | Sí: cada estructura nueva lleva su ejemplo en `test/grammar.test.js` |
| `kanji-data.js` | Modelo antiguo; ya no se carga, solo sirve para migrar datos viejos | — | No |

Tamaño del banco:

| Nivel | Palabras | Kanjis |
|---|---|---|
| N5 | 531 | 87 |
| N4 | 523 | 179 |
| N3 | 1.850 | 433 |
| N2 | 1.347 | 428 |
| N1 | 2.461 | 1.053 |

Las palabras marcadas «casi siempre en kana» (有る → ある) no se repasan como tarjeta: se aprenden
leyendo, y a la IA se le piden en kana.

### Datos del usuario

Se guardan en el dispositivo (IndexedDB) y, con cuenta, se sincronizan con Supabase.

- `userWords`: progreso por palabra (clave `escritura|lectura`). Estado: `unknown`,
  `learning`, `pre_known` o `mastered`; además, la tarjeta FSRS, aciertos y fallos.
- `userKanji`: progreso por kanji. Si conoce su significado, si sabe escribirlo y su tarjeta FSRS.
- `texts`, `words`, `sentences`, `translations`: textos, el diccionario propio, las frases
  sacadas de los textos y las traducciones respondidas.
- `meta`: historial diario, perfil de lectura (`reading.level`, `reading.assumed`),
  «Lecturas de kanji practicadas» (`practice`, solo en el dispositivo) y niveles de Escribir aprobados.
- Preferencias (localStorage, por dispositivo): modo, presentación, contenido y número de
  preguntas del repaso, furigana, idioma, palabras nuevas por sesión.

## Cómo se decide qué enseñar

### 1. Qué se da por conocido

La **evaluación inicial** hace 20 preguntas del nivel elegido (el 40 % del nivel anterior). Con un
70 % o más se aprueba. De ahí salen dos datos:

- **Nivel de lectura**: el de los textos que se proponen. Si no se aprueba, un nivel menos.
- **Nivel supuesto**: todo el vocabulario de ese nivel y de los anteriores se da por conocido.

Después manda lo que el usuario demuestra: una palabra fallada deja de contar como conocida
aunque sea de un nivel supuesto, y una acertada cuenta aunque sea de un nivel superior
(`knownLemmas`, `reading.js`).

### 2. Palabras nuevas en Repasar (`study.js` + `learning-core.js`)

- Lo que decide es el **nivel de sus kanjis**, no el de la palabra (`kanjiGate`). Una palabra sale si
  todos sus kanjis son del nivel del usuario o inferior, o ya los conoce.
- Excepción: una palabra de varios kanjis puede llevar uno de nivel superior si el usuario conoce
  al menos uno de los suyos y la palabra es de su nivel o inferior.
- Las agregadas a mano y las marcadas «Conozco la palabra pero no el kanji» no tienen límite.
- **Orden** (pesos en `study-config.js`; cada criterio solo desempata al anterior):
  agregada a mano > buscada en el diccionario > consultada hace poco (pierde peso en 14 días) >
  fallada al traducir > vista en una lectura > en la hoja de ruta (solo premium) > proporción de
  kanjis conocidos > frecuencia.
- Como mucho **5 nuevas por sesión** (se cambia en Ajustes). Los repasos pendientes salen antes y no cuentan.
- Con «Mostrar por qué sale cada palabra nueva» (Ajustes) se ve la puntuación de cada una.

### 3. Kanjis en Repasar

Los de nivel igual o inferior al del usuario que tengan significado. Primero los que aparecen en
palabras que ya conoce o está aprendiendo. En «Palabras y kanjis» se alternan uno y uno.

### 4. Cómo se pregunta en Repasar

- **Tarjetas**: palabra o kanji; el usuario ve la respuesta y se puntúa (Otra vez / Difícil / Bien / Fácil).
- **Escribir la lectura + Palabra sola**: la palabra; se escribe su lectura en hiragana. Solo palabras.
- **Escribir la lectura + En una frase**: la palabra resaltada dentro de una frase; se escribe la
  lectura de la parte resaltada (la de diccionario o la conjugada: 行きます → いきます / いく). Si el
  elemento es un kanji suelto, se resalta solo ese kanji dentro de una palabra y se escribe cómo
  suena allí (語 en 日本語 → ご). Sin frase disponible: la tarjeta de siempre con el aviso
  «Sin frase disponible».
- Las respuestas aceptan katakana (se convierte a hiragana), ignoran los espacios y el rōmaji se
  convierte a kana al escribir (WanaKana). Otra lectura válida de la misma palabra (にほん /
  にっぽん) avisa, pero no cuenta como fallo.
- Una palabra se da por **dominada** con 3 aciertos seguidos en días distintos o un intervalo de 21 días o más.

### 5. Frases de ejemplo (`sentences.js` + `sentences-core.js`)

- **Orden de búsqueda** (`findSentence`, `sentences.js`):
  1. **Comunes**: `bank/sentences/<nivel>.json` y las **compartidas** (tabla `shared_sentences`,
     copia local en el almacén `sharedSentences`; se descarga al empezar una sesión con frases,
     como mucho cada 10 minutos, también sin sesión).
  2. **Historias**: las frases de los textos guardados por el usuario, propios o de la comunidad
     (de 4 a 20 unidades con todas sus palabras reconocidas). La que se usa se copia a las
     compartidas para todos (con sesión). Nunca las de un texto pegado.
  3. **IA en segundo plano**: si no hay ninguna, la tarjeta sale sola con «Sin frase disponible» y
     la palabra se pide a la función `generate-sentences` (Gemini, con sesión). Para un kanji se pide
     su palabra de ejemplo. Al empezar la sesión se piden de una vez todas las que faltan, hasta 10
     palabras por llamada y una llamada por nivel. Una palabra pedida no se repite en 3 días.
     Límite por usuario: 40 palabras y 20 llamadas al día (secretos de la función).
- **Qué frase de la IA vale**: se analiza como un texto (`validateText`: kuromoji y diccionario) y se
  comprueba como las de las historias (`sentencesOfText` → `validateSentence`); además tiene que
  servir para preguntar una palabra pedida, leída como se pidió. Las que valen se comparten al
  momento; un administrador puede borrarlas en admin.html (pestaña Frases).
- Una frase solo vale para una palabra si kuromoji la lee igual que el banco.
- **Cuál se elige dentro de cada grupo** (`chooseSentence`): todo lo demás de la frase ya se conoce,
  o como mucho UNA palabra desconocida (sale con furigana y se puede tocar). Se evita repetir la
  última frase enseñada para esa palabra, y van primero las de textos, luego Tatoeba y luego las de IA.
- **Traducciones**: las escribe la misma IA que la frase (Gemini en los textos y en las frases que
  faltan; el chat que se use en las frases comunes). Nadie las comprueba. Los textos pegados no
  tienen traducción.

### 6. Textos para leer (`reading.js`)

- Se propone un texto no leído solo si el usuario conoce al menos el **90 %** de sus palabras.
- Al pedir uno nuevo, la IA (Gemini, función `generate-text`) recibe el nivel de lectura, las palabras
  conocidas, las que está aprendiendo (primero las buscadas en el diccionario) y 40 palabras en
  kana frecuentes que ha visto poco. Al alumno premium, además, las estructuras de gramática de su
  hoja de ruta, para que el texto las use al menos una vez.

### 7. Traducir (`translate.js` + `translate-core.js`)

Frases de 4 a 40 caracteres con traducción y como mucho 2 palabras desconocidas. Si la respuesta
casi coincide con la traducción de referencia se acepta sin llamar a la IA.

### 8. Escribir (`learning-core.js` + `study.js`)

Repaso espaciado con FSRS: cada kanji tiene su **tarjeta de escritura** (`writeFsrs`), aparte de la
de su significado. En el modo automático sale, por este orden (`nextWritingKanji`):

1. **Un repaso que toca**: su tarjeta ya venció, el más atrasado primero. Un kanji recién aprendido
   vuelve a los pocos minutos, en la misma sesión, y después a días, semanas o meses.
2. **Un kanji nuevo**, como mucho 10 al día. Primero los que el estudiante ya ha visto
   (`seenKanji`): en palabras que domina o acierta, o cuyo significado sabe (más cerca); en palabras
   que repasa o que se dan por sabidas por su nivel; en palabras que vio al leer o en Repasar (más
   lejos). Antes los de niveles más bajos, y como mucho un nivel por encima de su nivel de
   escritura. De cada 4 nuevos, uno que aún no ha visto de su nivel de escritura, para ir
   completándolo.
3. **Práctica extra**: si no queda nada de lo anterior, el ya escrito que vence antes. Bien hecha
   no cambia cuándo vuelve.

El **nivel de escritura** es el primero que no ha terminado (todos sus kanjis escritos alguna vez)
ni aprobado con la prueba (8 kanjis, 7 bien escritos sin ayuda; los bien escritos entran con un
intervalo largo).

**Cómo se valora** cada kanji (`writingRating`), una sola vez:

- limpio, o con **un solo fallo** (el primero no cuenta): *Bien*;
- con una **pista** (pedida, o la que sale sola tras tres fallos en un trazo) o con algún fallo de
  más: *Difícil*;
- con 4 o más fallos, si pulsa **Mostrar**, o si lo deja a medias y pasa al siguiente: *Otra vez*
  (vuelve en un minuto y deja de contar como «sabe escribirlo»).

Tras valorarlo se ve cómo fue y cuándo vuelve («Bien · vuelve en 3 d»). Pasar sin haber empezado
no lo valora. Eligiendo un nivel en el selector: primero lo que vence de ese nivel y, si no, uno al
azar, valorado igual. Un kanji que ya se sabía escribir antes de este cambio empieza como repaso a
7 días de la última vez que se escribió.

### 9. Análisis del progreso (`progress.js` + `progress-core.js` + `grammar-core.js`, solo premium)

Fases 1 a 4: vocabulario, kanjis, gramática, lectura y constancia; la hoja de ruta (qué estudiar
esta semana); un resumen de la semana escrito por la IA, y la vista del profesor.

- **Listas que se miden**: las palabras con kanji de cada nivel del banco (las que casi siempre van
  en kana no se estudian) y todos los kanjis de cada nivel.
- **Estado de cada palabra** (`wordState`): *dominada* (estado `mastered`), *aprendiendo* (en el
  repaso o en estado `learning`), *dada por sabida* (su nivel se aprobó en la evaluación inicial,
  o salió en una lectura sin consultarla: «por confirmar») y *sin estudiar*. Si el alumno marcó
  una palabra como desconocida, cuenta como sin estudiar aunque su nivel se diera por sabido.
- **Estado de cada kanji** (`kanjiState`): *dominado* si sabe su significado o escribirlo,
  *aprendiendo* si está en el repaso, *dado por sabido* si aparece en palabras dominadas o dadas
  por sabidas. Esto último es generoso: quien aprobó N5 en la evaluación ya tiene buena parte de
  los kanjis de N4 dados por sabidos.
- **Nivel estimado** (`estimateLevel`): el último nivel del que sabe (dominado + dado por sabido)
  al menos el 80 %, siempre que también sepa los anteriores, y cuánto lleva del siguiente.
  Se calcula aparte para vocabulario y kanjis; la lectura muestra el nivel de sus textos.
- **Gramática** (`grammar-core.js`): cada frase se analiza con kuromoji y `detectGrammar` dice
  qué estructuras del catálogo lleva. Se miran las frases de los textos leídos, las enseñadas en
  el repaso «En una frase» y las traducidas en Traducir. Estados (`grammarStates`):
  - *vista*: apareció en alguna de esas frases;
  - *entendida*: tradujo bien una frase con ella (Traducir: correcta o casi), o leyó 3 frases con
    ella sin consultar ninguna de sus palabras;
  - *dominada*: la tradujo bien en 2 días distintos;
  - si su última traducción fue mala (también «No lo sé») no cuenta como dominada ni, por las
    traducciones, como entendida.
  El nivel estimado de gramática cuenta dominadas y entendidas, con el mismo umbral del 80 %. Solo
  hay catálogo de N5 por ahora. El análisis descarga el analizador de japonés si hace falta (unos
  18 MB la primera vez); al sincronizar no se descarga, y la foto conserva la gramática de esa semana.
- **Lectura**: textos leídos (en total y en 30 días), qué % conoce hoy de sus 5 últimos textos y
  cuántas palabras consulta por cada 100 que lee. **Constancia**: días activos y aciertos en los
  repasos de los últimos 30 días.
- **Foto semanal** (`meta.snapshots`, tabla `progress_snapshots`): se guarda para todos los
  usuarios, premium o no, en cada sincronización y al abrir el análisis; la última de cada semana
  gana. Con ella se ven las diferencias con la semana anterior y la tabla de evolución (8 semanas).
- **Hoja de ruta** (`buildRoadmap`, al principio del análisis): reglas, no IA.
  - Cada dimensión sin completar (vocabulario, kanjis, gramática) tiene su meta de la semana en su
    propio nivel: 35 palabras nuevas, 10 kanjis o 2 estructuras, con cuántos le faltan para
    completar el nivel y los siguientes elementos concretos. Van primero las de nivel más bajo y,
    en el mismo nivel, la más floja; el «objetivo» es el nivel de la primera.
  - Palabras: las nuevas de ese nivel en el orden del repaso. Kanjis: los de ese nivel sin estudiar
    ni aparecer en palabras que conoce. Gramática: las no entendidas, primero las ya vistas.
  - Detrás, la lectura: si conoce menos del 85 % de sus últimos textos o consulta más de 8 palabras
    de cada 100, que lea textos más fáciles; si ha leído menos de 12 textos en 30 días, que lea 3
    esta semana. Y la constancia: si ha estudiado menos de 12 de los últimos 30 días, se le avisa.
  - Se guarda en `meta.roadmap` al abrir el análisis y tiene efecto: sus palabras de la semana
    suben en el orden del repaso (peso `roadmap`) y sus estructuras se piden en los textos de la IA.
    Solo para premium: sin premium no cambia nada.
- **Resumen de la semana** (función `summarize-progress`, Gemini): 3 a 5 frases sobre lo que fue
  bien, lo que toca ahora y una acción concreta, escritas **solo** con los números de la pantalla
  (niveles, cambios, lectura, constancia y metas; nunca texto libre). Uno por semana e idioma,
  guardado en `progress_summaries` y en `meta.summary`; volver a abrir el análisis no gasta otra
  llamada. El servidor comprueba que el alumno es premium. Como mucho 5 llamadas por usuario y día
  (`SUMMARY_DAILY_CALLS`); si falla, no se reintenta en 6 horas y no se enseña nada.
- **Vista del profesor** (`admin.html` → Progreso): la última foto semanal de cada estudiante, con
  su nivel estimado en vocabulario, kanjis y gramática (las mismas reglas de `progress-core.js`),
  lo que cambió desde la semana anterior, textos, días activos, aciertos y el foco de su hoja de
  ruta. Al desplegarlo: sus 12 últimas semanas y su último resumen.
- **Quién lo ve**: con sesión y plan premium sin caducar (`isPremium`). Sin premium se ve un aviso.

## Dónde cambiar cada número

Casi todo lo ajustable está en `study-config.js`: palabras nuevas por sesión, pesos del orden,
días de dominio, reglas de Escribir y de Traducir. Lo que no:

- 90 % de cobertura de los textos: `COVERAGE_TARGET` en `reading.js`.
- Escribir: kanjis nuevos al día (10), cada cuántos nuevos uno sin ver (4) y los fallos que
  perdona la valoración (1) o con los que cuenta como Otra vez (3 de más): `STUDY_CONFIG.writing`.
- Análisis: umbral para dar un nivel por completo (80 %), textos recientes que se miran (5) y
  cuándo una estructura cuenta como entendida (3 lecturas sin consultar) o dominada (2 días), y las
  metas y avisos de la hoja de ruta: `STUDY_CONFIG.analysis` en `study-config.js`. El peso de la
  hoja de ruta en el orden del repaso: `STUDY_CONFIG.weights.roadmap`.
- Tamaño y aprobado de la evaluación inicial: `PLACEMENT_SIZE` y `PLACEMENT_PASS` en `reading.js`.
- Textos de IA al día: variables `DAILY_TEXTS` y `PREMIUM_DAILY_TEXTS` de la función `generate-text` en Supabase.
- Frases de IA al día: `SENTENCE_DAILY_WORDS` y `SENTENCE_DAILY_CALLS` de la función `generate-sentences`.
  Palabras por llamada y días sin volver a pedir una palabra: `SENTENCE_BATCH` y `SENTENCE_RETRY_DAYS`
  en `sentences.js`. Frases compartidas por usuario y día: 200, en `schema.sql`.
