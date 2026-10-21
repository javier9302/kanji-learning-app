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
| **Escribir** | Trazos de kanjis (KanjiVG), nivel a nivel, con una prueba para saltarse un nivel. |
| **Diccionario** | Búsqueda por kanji, kana, rōmaji o significado (español o inglés). |
| **Mis palabras** | Agregar palabras a mano, progreso y estadísticas. |
| **Cuenta** (opcional) | Sincronización con Supabase, plan gratuito (10 textos de IA al día) o premium (30). |
| **admin.html** | Aprobar textos de la comunidad, revisar palabras, traducciones y frases compartidas, cambiar planes. |

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
  fallada al traducir > vista en una lectura > proporción de kanjis conocidos > frecuencia.
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
  kana frecuentes que ha visto poco.

### 7. Traducir (`translate.js` + `translate-core.js`)

Frases de 4 a 40 caracteres con traducción y como mucho 2 palabras desconocidas. Si la respuesta
casi coincide con la traducción de referencia se acepta sin llamar a la IA.

### 8. Escribir (`learning-core.js`)

Nivel a nivel: no sale ningún kanji de N4 hasta escribir todos los de N5 o aprobar su prueba
(8 kanjis, 7 bien escritos sin ayuda). Cada 5 kanjis sale uno ya escrito, el que hace más que no
se escribe. Primero los kanjis de palabras que el usuario ya conoce.

## Dónde cambiar cada número

Casi todo lo ajustable está en `study-config.js`: palabras nuevas por sesión, pesos del orden,
días de dominio, reglas de Escribir y de Traducir. Lo que no:

- 90 % de cobertura de los textos: `COVERAGE_TARGET` en `reading.js`.
- Tamaño y aprobado de la evaluación inicial: `PLACEMENT_SIZE` y `PLACEMENT_PASS` en `reading.js`.
- Textos de IA al día: variables `DAILY_TEXTS` y `PREMIUM_DAILY_TEXTS` de la función `generate-text` en Supabase.
- Frases de IA al día: `SENTENCE_DAILY_WORDS` y `SENTENCE_DAILY_CALLS` de la función `generate-sentences`.
  Palabras por llamada y días sin volver a pedir una palabra: `SENTENCE_BATCH` y `SENTENCE_RETRY_DAYS`
  en `sentences.js`. Frases compartidas por usuario y día: 200, en `schema.sql`.
