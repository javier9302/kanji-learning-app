# Cómo funciona la app

Referencia de qué listas usa la app y cómo decide qué enseñar a cada usuario. Se actualiza en el
mismo commit que cambie cualquiera de estas reglas. Los cambios, con fecha, están en
[CHANGELOG.md](../CHANGELOG.md).

## Secciones

| Sección | Qué hace |
|---|---|
| **Hoy** (pantalla de inicio) | La sesión del día en una lista: un texto con las palabras que tocan, Repasar, unos kanjis que escribir y unas frases que traducir. Cada paso abre su sección. |
| **Leer** | Textos en japonés (generados por IA, de la comunidad o pegados) con furigana según el nivel. Tocar una palabra enseña su lectura y su significado. Al terminar, una evaluación corta de las palabras del texto. |
| **Repasar** | Repaso espaciado (FSRS) de palabras y kanjis. Modo «Escribir la lectura» o «Tarjetas»; presentación «Palabra sola» o «En una frase». |
| **Traducir** | El usuario traduce frases de sus textos y lo corrige la IA (o él mismo con la traducción de referencia). Mide si entiende el significado; no mueve el calendario de repaso. |
| **Escribir** | Trazos de kanjis (KanjiVG) con repaso espaciado: primero los kanjis que ya has visto y los que toca repasar, y una prueba para saltarse un nivel. |
| **Diccionario** | Búsqueda por kanji, kana, rōmaji o significado (español o inglés). |
| **Mis palabras** | Agregar palabras a mano o desde la web (marcador «+ Kanji», «Compartir» de Android o un enlace `?add=`), progreso y estadísticas. **Análisis** (solo premium): lo demostrado por nivel JLPT, nivel estimado y evolución semanal. **Kanjis** (solo premium): tabla de kanjis dominados, parciales y sin conocer según las palabras que conoces. |
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
| `bank/kanji-info.js` | Por kanji: nivel JLPT, grado escolar, frecuencia en prensa, importancia y sus lecturas en las palabras del banco con cuántas palabras usa cada una (más los kanjis de uso común que no están en las listas JLPT). Por palabra: las lecturas de sus kanjis cuando `readings.js` las da mal (上手 → 上じょう, no しょう) | `tools/build-kanji.mjs` desde KANJIDIC2 y `bank/readings.js` | No |
| `bank/AMBIGUAS.md` | Notas sobre las palabras con varias lecturas y significados | — | Sí |
| `vendor/jmdict/common-<fecha>.json` | Diccionario general: palabras comunes que no están en el banco | `tools/build-dictionary.mjs` desde JMdict | No |
| `bank/sentences/<nivel>.json` | Frases comunes de ejemplo, con traducción: de Tatoeba (aprobadas por la IA, con su autor) y de IA | `tools/import-tatoeba.mjs` (Tatoeba, CC BY 2.0 FR) y `tools/generate-sentences.mjs` (IA por tandas) | No |
| Tabla `shared_sentences` (Supabase) | Frases compartidas por todos: las propias de un administrador, las de historias que se usaron y las que escribió la IA para palabras sin frase | La app: Ajustes → Frases propias y al repasar «En una frase» | Se borran en admin.html → Frases |
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
- `userKanji`: progreso por kanji. Si conoce su significado, si sabe escribirlo, su tarjeta FSRS y
  lo acertado y fallado de cada lectura al escribirla (`readings`: una casilla por kanji y las
  lecturas acertadas en frases; las de «Lecturas de kanji practicadas» de antes se copiaron aquí
  una vez por dispositivo).
- `texts`, `words`, `sentences`, `translations`: textos, el diccionario propio, las frases
  sacadas de los textos (y las guardadas de la web, con `source: "web"`, `word` y `url`) y las
  traducciones respondidas.
- `meta`: historial diario, perfil de lectura (`reading.level`, `reading.assumed`),
  «Lecturas de kanji practicadas» (`practice`, solo en el dispositivo) y niveles de Escribir aprobados.
- Preferencias (localStorage, por dispositivo): modo, presentación, contenido y número de
  preguntas del repaso, furigana, idioma, palabras nuevas por sesión.
- **Descargar mis datos** (Ajustes → Tus datos, para todos, sin premium): un JSON
  `progreso-japones-<fecha>.json` para analizarlo con una IA como Claude
  (`progressExport` en `progress.js`, `buildProgressExport` en `progress-core.js`). Lleva una guía
  de campos en inglés (`guide`), los totales por estado, el perfil del análisis (desglose por
  nivel JLPT, nivel estimado, lectura y constancia), el estado de cada estructura de gramática,
  la hoja de ruta, el historial diario, las fotos semanales, los textos leídos (fecha, nivel,
  consultas, cobertura de hoy), las traducciones (frase, respuesta, veredicto, nota), lo que sabe
  de cada kanji por sus palabras (estado de la tabla, lecturas vistas y que faltan, aciertos de
  cada lectura en su casilla), las 40 palabras empezadas más recientemente, las 100 siguientes
  palabras nuevas con cada componente del orden y su porqué, la lista importada si la hay, y una
  fila por cada palabra y kanji de `userWords` / `userKanji` (estado, aciertos, fallos, tarjeta
  FSRS resumida). Las palabras de los niveles dados por sabidos que nunca ha tocado solo cuentan en
  el perfil. Descarga el analizador de japonés si hace falta para incluir la gramática. La guía
  explica también cómo contestar con una lista para importarla. Formato completo en `README.md`.
- **Importar lista** (Ajustes → Tus datos): se pega (o se elige un archivo) una lista de palabras,
  en el formato de `README.md`, en JSON o una por línea. `parseQueueText` y `resolveQueue`
  (`ranking-core.js`) la comprueban contra el banco e informan de las que no están, las que
  tienen varias lecturas sin decir cuál, las que ya sabe o estudia, las que van en kana y las
  repetidas. Las válidas se guardan en `meta.queue` (solo en el dispositivo) y salen **primero**
  entre las palabras nuevas, en su orden y aunque lleven kanjis de un nivel superior, hasta que
  todas se han empezado a estudiar o se han dado por dominadas. «Quitar la lista» la borra.

## Cómo se decide qué enseñar

### 1. Qué se da por conocido

La **evaluación inicial** hace 20 preguntas del nivel elegido (el 40 % del nivel anterior). Con un
70 % o más se aprueba. De ahí salen dos datos:

- **Nivel de lectura**: el de los textos que se proponen. Si no se aprueba, un nivel menos.
- **Nivel supuesto**: todo el vocabulario de ese nivel y de los anteriores se da por conocido.

Después manda lo que el usuario demuestra: una palabra fallada deja de contar como conocida
aunque sea de un nivel supuesto, y una acertada cuenta aunque sea de un nivel superior
(`knownLemmas`, `reading.js`).

### 2. Palabras nuevas en Repasar (`study.js` + `learning-core.js` + `ranking-core.js`)

- Lo que decide es el **nivel de sus kanjis**, no el de la palabra (`kanjiGate`). Una palabra sale si
  todos sus kanjis son del nivel del usuario o inferior, o ya los conoce.
- Excepción: una palabra de varios kanjis puede llevar uno de nivel superior si el usuario conoce
  al menos uno de los suyos y la palabra es de su nivel o inferior.
- Las agregadas a mano y las marcadas «Conozco la palabra pero no el kanji» no tienen límite.
- **Orden** (pesos en `study-config.js`; cada criterio solo desempata al anterior): la lista
  importada (Ajustes → Tus datos), en su orden y sin límite de nivel > agregada a mano > buscada en el diccionario > consultada hace poco (pierde peso en 14 días) >
  fallada al traducir > vista en una lectura > en la hoja de ruta (solo premium) > el **orden por
  kanjis**, que decide entre todas las demás (peso `ranking`, siempre por debajo de la hoja de ruta).
- **Orden por kanjis** (`ranking-core.js`, números en `STUDY_CONFIG.ranking`), con lo que se sabe
  de cada kanji por las palabras conocidas (sección 10). Suma, cada uno de 0 a 1 por su peso:
  - *frecuencia* (×1): su puesto en la lista de frecuencia; sin puesto, 0.
  - *puente* (×1,5), i+1: lo mejor es **una** cosa nueva. Un kanji nuevo junto a otros conocidos, o
    una lectura nueva de un kanji conocido: 1. Un kanji nuevo y una lectura nueva (有名 para quien
    conoce 名前): 0,8. Varias lecturas nuevas: 0,6. Un kanji nuevo y varias lecturas: 0,4. Nada
    nuevo: 0,5. **Dos kanjis nuevos o más: −1.** Un kanji cuenta como conocido si sale en una
    palabra conocida o si sabes su significado.
  - *abre vocabulario* (×0,6): cuánto vocabulario frecuente sin conocer lleva su kanji nuevo
    (escala logarítmica, 1 = el que más).
  - *lecturas que faltan* (×0,8): le da a un kanji parcial una lectura relevante que no habías
    visto; 1 si es la última que le faltaba, 0,5 si quedan más.
  - *tema* (×0): aún no se calcula (fase D).
- **Variedad**: entre las 300 primeras sin razón propia, MMR (λ = 0,7) evita que salgan seguidas
  las que traen el mismo kanji nuevo o la misma lectura nueva (o, menos, las que comparten un kanji).
- **Por qué**: la primera vez que sale una palabra nueva, con la respuesta, una línea dice por qué
  («lectura nueva めい de 名 · kanji nuevo 有 · frecuencia n.º 900»). Va con la respuesta porque
  cuenta la lectura.
- Como mucho **5 nuevas por sesión** (se cambia en Ajustes). Los repasos pendientes salen antes y no cuentan.
- **Práctica extra**: si con los repasos pendientes y las nuevas no se llega al número de preguntas
  elegido, se completa con palabras ya estudiadas que aún no tocan, las que vuelven antes primero.
  Nunca las ya repasadas hoy, y las dominadas al final. Si la aciertas, FSRS la calcula como un
  repaso adelantado y se guarda solo si la deja para **más tarde** (un Fácil puede alejarla; repasar
  antes de tiempo nunca la acerca); si no, queda igual. Fallarla («Otra vez») la vuelve a poner en
  repaso, como siempre.
- Con «Mostrar por qué sale cada palabra nueva» (Ajustes) se ven las 100 primeras con cada
  componente del orden, su valor de MMR y su porqué, para ajustar los pesos.

### 3. Kanjis en Repasar

Los de nivel igual o inferior al del usuario que tengan significado. Primero los que aparecen en
palabras que ya conoce o está aprendiendo. En «Palabras y kanjis» se alternan uno y uno.

### 4. Cómo se pregunta en Repasar

- **Tarjetas**: palabra o kanji; el usuario ve la respuesta y se puntúa (Otra vez / Difícil / Bien / Fácil).
- Debajo de cada botón de valoración va su tecla (1 a 4) y cuándo volvería a salir con esa
  respuesta («3 · 57 d»); en la práctica extra, «sin cambios» si esa respuesta no la aleja.
- **Escribir la lectura + Palabra sola**: la palabra; se escribe su lectura en hiragana. Solo palabras.
  Si tiene más de un kanji, **una casilla por kanji** con el kana escrito entre ellas
  (前置き → [まえ][お]き); Enter pasa a la siguiente. La palabra está bien solo si lo están todas
  (si no, cuenta como Otra vez para su tarjeta), y cada casilla se anota aparte en la lectura de su
  kanji: aciertos, fallos y el último día (`userKanji[c].readings`, solo el primer intento). Debajo
  de cada casilla fallada sale su lectura. Cada casilla pide cómo suena el kanji en la palabra
  (学校: がっ, 上手: じょう) y cuenta para su lectura de diccionario (学 がく, 上 じょう). Los kanjis
  que se leen juntos (今日) van en una casilla que no cuenta para ninguno, y las palabras de un solo
  kanji o que no se pueden repartir, con una sola casilla. Se desactiva en Ajustes → Repaso.
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
  0. **La suya de la web**: si el usuario guardó una frase para esa palabra al agregarla desde la
     web (apartado 12), sale esa (`chooseCapturedSentence`), aunque tenga varias palabras que no
     conoce: llevan furigana salvo con «Furigana: siempre», que lo pone en todo. Con varias, la que
     hace más que no sale. Debajo, un enlace a su página. Con «Palabra sola» o «Tarjetas» sale con
     la respuesta.
  1. **Comunes**: `bank/sentences/<nivel>.json` (de Tatoeba y de IA) y las **compartidas** (tabla `shared_sentences`,
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
  última frase enseñada para esa palabra, y van primero las revisadas, las **propias** de un
  administrador y las de **Tatoeba** (`SOURCE_ORDER`), y luego las de IA y las de las historias
  (también escritas por la IA). Una revisada que ya se vio unas 3 veces más que otra cede el sitio.
  Vale cualquier frase en la que salga la palabra con su lectura, se escribiera para ella o no.
- **Frases de Tatoeba** (`tools/import-tatoeba.mjs`, reglas en `tools/lib/tatoeba.js`): de las
  japonesas con traducción al inglés y sin ninguna valoración negativa en Tatoeba, las de 5 a 12
  unidades con todas sus palabras reconocidas. Para cada palabra (las más frecuentes primero) se
  eligen hasta **3** de su mismo nivel; una frase cuenta para todas las palabras de su nivel que
  lleva. Van primero las ya aprobadas y las bien valoradas en Tatoeba. Cada elegida la revisa la
  IA (función `review-sentences`, o a mano con otra IA: `export` / `import`): si el japonés no es correcto y natural, o el contenido no es
  adecuado, se rechaza y se elige otra; si vale, corrige su traducción al inglés y escribe o
  corrige la española. El japonés no se cambia. Cada una enseña «Tatoeba #número · autor · CC BY
  2.0 FR» con enlaces al repasar, en el diccionario y en Traducir.
- **Frases propias** (Ajustes → Frases propias, solo administradores): la frase con sus dos
  traducciones se analiza como las demás y se comprueba con `validateSentence` (de 3 a 25 unidades,
  todas sus palabras reconocidas y alguna con kanji que preguntar). Al compartirla entra en
  `shared_sentences` con el origen `curated`.
- **Traducciones**: las escribe la misma IA que la frase (Gemini en los textos y en las frases que
  faltan; el chat que se use en las frases comunes). Nadie las comprueba. Los textos pegados no
  tienen traducción.

### 6. Textos para leer (`reading.js`)

- Se propone un texto no leído solo si el usuario conoce al menos el **90 %** de sus palabras; de
  esos, primero el que tiene **más palabras que le toca repasar** y, a igualdad, el más fácil.
- Al pedir uno nuevo, la IA (Gemini, función `generate-text`) recibe el nivel de lectura, las palabras
  conocidas, las que está aprendiendo (primero las buscadas en el diccionario) y 40 palabras en
  kana frecuentes que ha visto poco. Al alumno premium, además, las estructuras de gramática de su
  hoja de ruta, para que el texto las use al menos una vez.
- **Palabras que tocan** (`story-core.js`, `storyTargets`; números en `STUDY_CONFIG.stories`): hasta
  **8**, que la IA tiene que usar: primero las que toca repasar (la más atrasada antes), después las
  que tocarán en 2 días y, si queda sitio, una palabra conocida por cada kanji cuya tarjeta toca.
  Después se comprueba cuáles salen de verdad (`targetsFound`) y el lector lo dice («Salen 6 de las
  8 palabras que te tocaba repasar»). Leer el texto las repasa (más abajo).
- **Variedad**: 8 tipos de texto (historia, diálogo, diario, mensaje, descripción, noticia,
  instrucciones, opinión) y 13 temas; el formulario propone el tipo y el tema que hace más que no
  salen, y cada texto lleva 2 de los 8 personajes fijos del prompt (los menos usados últimamente;
  `nextVariety`). El prompt pide evitar las situaciones y frases gastadas (お腹が空きました,
  お弁当を食べました, 公園に行きました…).
- **No repetir**: antes de guardarlo, cada frase del texto nuevo se compara con las de los 10 últimos
  (trigramas de caracteres; se repite si coincide en un 70 %). Si repite 3 frases o una cuarta parte,
  se pide otro **una vez**, diciéndole a la IA qué frases no repetir (cuenta como otro texto del día).
- **Leer cuenta como repaso** (`learning-core.js`, `readingCredit`; números en
  `STUDY_CONFIG.readingReview`). Al terminar un texto, cada palabra suya que **tocaba repasar**
  (estudiada en Repasar y con la fecha de hoy o atrasada) cuenta como un repaso:
  - **sin tocarla**: como «Difícil», y su intervalo crece **como mucho 1,5 veces** (al menos 1 día):
    una que volvía a los 10 días y FSRS mandaría a 30 vuelve a los 15. Reconocerla en contexto es
    más fácil que recordarla en una tarjeta, por eso vale menos;
  - **tocada** para ver su lectura o significado (o marcada «Nueva»): «Otra vez», vuelve a repaso;
  - **«La conocía, solo comprobaba»**: ni suma ni resta;
  - **con furigana encima** no cuenta (la lectura estaba a la vista), ni dos veces el mismo día, y
    tras **2 seguidas leyendo** la siguiente tiene que ser una tarjeta en Repasar. Leer nunca la da
    por dominada y no suma al historial del día.
  - Las que vencen más tarde, los kanjis sueltos y la escritura no cambian.
  - El resumen de la lectura las lista; «La toqué sin querer» la da por acertada y «No la sabía»,
    por fallada. Se guarda en la sesión (`reviews`) y en la palabra (`readStreak`, `lastReadReview`).

### 7. Traducir (`translate.js` + `translate-core.js`)

Frases de 4 a 40 caracteres con traducción y como mucho 2 palabras desconocidas. Si la respuesta
casi coincide con la traducción de referencia se acepta sin llamar a la IA.

Qué frase sale (`chooseTranslationSentence`, pesos en `STUDY_CONFIG.translate.choose`): las que más
palabras conocidas tienen, con una desconocida mejor que ninguna, y suman **las palabras que le toca
repasar** (5 cada una, hasta 3), las que está aprendiendo (3), las consultadas (2) y las falladas (3).
Restan las que salieron hace poco (en 5 días) y las del mismo texto que la anterior. Traducir no
cambia la fecha de repaso de ninguna palabra.

### 8. Escribir (`learning-core.js` + `study.js`)

Repaso espaciado con FSRS: cada kanji tiene su **tarjeta de escritura** (`writeFsrs`), aparte de la
de su significado. En el modo automático sale, por este orden (`nextWritingKanji`):

1. **Un repaso que toca**: su tarjeta ya venció, el más atrasado primero. Un kanji recién aprendido
   vuelve a los pocos minutos, en la misma sesión, y después a días, semanas o meses.
2. **Un kanji nuevo**, como mucho 10 al día, **solo de los que el estudiante ya ha visto**
   (`seenKanji`), de cualquier nivel salvo los aprobados con la prueba. De simple a complejo:
   - primero los de palabras que mejor conoce: que domina o acierta, o cuyo significado sabe; después
     los de palabras que repasa o que se dan por sabidas por su nivel; al final, los de palabras que
     vio al leer o en Repasar;
   - después, por importancia en tramos (los 100 primeros, los 250, 500, 1000…: cuánto vocabulario
     frecuente abren, `bank/kanji-info.js`) y, en el mismo tramo, **los de menos trazos** (KANJIDIC2).
   Un kanji que no ha visto nunca no sale en automático (`writing.unseenEvery` = 0; con un número,
   cada tantos nuevos saldría uno sin ver de su nivel de escritura). Para practicar un nivel entero,
   se elige en el selector.
3. **Práctica extra**: si no queda nada de lo anterior, el ya escrito que vence antes. Bien hecha
   no cambia cuándo vuelve.

La cabecera dice cuántos de los kanjis que ha visto ha escrito («34 / 120»). El **nivel de
escritura**, para la prueba que lo salta, es el primero que no ha terminado (todos sus kanjis escritos alguna vez)
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

### 10. Tabla de kanjis (`kanji-table.js` + `kanji-core.js`, solo premium)

Mis palabras → Kanjis. Lo que se sabe de cada kanji sale de las **palabras** que conoces; no se
guarda aparte, se calcula al abrir la tabla.

- **Palabras que cuentan como conocidas**: las dominadas, las repasadas cuya lectura acertaste la
  última vez y las de los niveles que la evaluación dio por sabidos (salvo que luego dijeras que
  no la sabes o la estés aprendiendo). Las que solo viste al leer no cuentan.
- **Lecturas relevantes de un kanji**: las que usan al menos 2 palabras del banco, y siempre la
  más usada (名: めい ×21, な ×12, みょう ×2). Las demás salen como «poco usadas» y no hacen falta.
  Las lecturas especiales de una palabra (お兄さん にい, 真っ赤) no cuentan como lectura del kanji.
- **Estados**: *dominado* si sabes su significado y has visto todas sus lecturas relevantes en
  palabras conocidas; *parcial* si sale en alguna palabra conocida pero te falta una lectura o
  el significado; *sin conocer* si no sale en ninguna. El significado se sabe si lo marcaste o
  acertaste en Repasar («Kanjis»), si sabes escribirlo o si el kanji es una palabra que conoces (山).
- **Agrupación** (se recuerda en el dispositivo): por nivel JLPT, por grado escolar (1.º a 6.º de
  primaria y secundaria) o por importancia (los 100, 250, 500, 1000, 1500, 2000 y 2500 primeros).
  Lo que no entra va a «Otros». La importancia es cuánto vocabulario frecuente abre el kanji: la
  suma, por cada palabra de la lista de frecuencia que lo lleva, de 100 / (puesto + 99); sin
  palabras frecuentes, cuenta su frecuencia en prensa. Dentro de cada grupo van primero los más
  importantes.
- **Ficha de un kanji**: significados, cada lectura relevante (vista o que te falta, y cuántas veces
  la has acertado y fallado al escribirla), las palabras
  que conoces con él y, por cada lectura que falta, las 3 palabras más frecuentes que te la enseñan.

### 12. Palabras desde la web (`capture.js` + `capture-core.js`)

Tres formas de llegar, que abren la app con la palabra en Agregar palabra:

- **Enlace** `?add=<palabra>&sentence=<frase>&source=<página>`; es lo que construye el **marcador
  «+ Kanji»** (Ajustes → Añadir palabras desde la web): la selección, la oración que la rodea
  (`sentenceAround`: del fin de la anterior a su 。！？ o al salto de línea, 300 caracteres como
  mucho) y la dirección de la página. En el móvil el marcador se guarda copiando su código.
- **Compartir de Android** (`share_target` en `manifest.webmanifest`, solo con la app instalada):
  llega `?share_text=…` (y a veces `share_url`). Si el texto lleva una dirección, se separa.
- **Qué se acepta** (`readCapture`): texto sin caracteres de control; palabra de hasta 30
  caracteres y frase de hasta 300, con japonés; la página solo si es `http(s)`. Lo seleccionado
  que parece una frase (más de 15 caracteres, espacios o puntuación) pasa a ser la frase, y se
  elige la palabra dentro. Una frase que no contiene la palabra se descarta.

Después: la dirección se limpia (`history.replaceState`), la frase se analiza como un texto pegado
(kuromoji, banco y diccionario) y la palabra pasa a su forma de diccionario con la lectura que
tiene en esa frase (`findWordUnit`: la unidad que más se solapa con la selección). El formulario
sale relleno y la frase con la palabra resaltada; tocar otra palabra de la frase la cambia.
**Nada se guarda** hasta pulsar «Quiero aprenderla» o «Ya la domino»; si ya es de sus palabras,
«Guardar la frase como ejemplo». La frase se guarda en `sentences` con `source: "web"`, `word`
y `url` solo si la palabra está en ella y se lee igual. Se sincroniza con su cuenta (tabla
`user_sentences`), **nunca se comparte** con otros usuarios y no sale en Traducir (no tiene
traducción). Rehacer las frases de los textos no la borra. Lo recibido se escribe siempre como
texto, nunca como HTML. El service worker guarda una sola copia de la página para todas estas
direcciones, así que también se abre sin conexión (pero analizar la frase necesita el analizador
ya descargado).

### 11. Hoy (`today.js` + `learning-core.js`, `planToday`)

La pantalla con la que se abre la app (si quedó un texto a medias al recargar, se vuelve a él).
Junta lo del día en este orden, y el siguiente paso sin hacer va resaltado:

1. **Leer un texto**: el suyo a medias o el recomendado (el que tiene más palabras que tocan); sin
   ninguno y con cuenta, crear uno con IA, que llevará las palabras que tocan. Leerlo las repasa.
2. **Repasar**: las que siguen tocando después del texto y hasta las palabras nuevas por sesión.
   El botón empieza la sesión directamente.
3. **Escribir 4 kanjis** (de los que ya ha visto, de simple a complejo).
4. **Traducir 3 frases** (con las palabras que tocan).

No guarda nada propio: lo hecho se deduce de lo de hoy (un texto terminado hoy; nada que toque en
Repasar y alguna respuesta hoy; kanjis escritos hoy; traducciones de hoy). Un paso sin nada que
hacer (sin texto posible, sin kanjis o sin frases) no sale. Sin la evaluación inicial, solo sale
ella. Encima, cuántas respuestas lleva de su meta diaria.

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
- Hoy: kanjis que escribir (4) y frases que traducir (3) al día: `STUDY_CONFIG.today`.
- Textos con las palabras que tocan: cuántas (8), con cuántos días de adelanto (2), textos que se
  miran para variar y no repetir (10) y cuándo un texto se repite: `STUDY_CONFIG.stories`.
- Leer cuenta como repaso: valoración (Difícil), tope de crecimiento (×1,5), días mínimos (1) y
  tarjeta cada 2 lecturas: `STUDY_CONFIG.readingReview`.
- Orden de las palabras nuevas: pesos de frecuencia, puente, abre vocabulario, lecturas que faltan
  y tema, la tabla del puente, λ y tamaño de la variedad (MMR) y las filas de la depuración:
  `STUDY_CONFIG.ranking`. Cuánto pesa todo eso frente a las razones del estudiante: `weights.ranking`.
- Tabla de kanjis: palabras que tienen que usar una lectura para que haga falta conocerla (2):
  `STUDY_CONFIG.kanji.relevantMinWords`.
- Tamaño y aprobado de la evaluación inicial: `PLACEMENT_SIZE` y `PLACEMENT_PASS` en `reading.js`.
- Textos de IA al día: variables `DAILY_TEXTS` y `PREMIUM_DAILY_TEXTS` de la función `generate-text` en Supabase.
- Frases de IA al día: `SENTENCE_DAILY_WORDS` y `SENTENCE_DAILY_CALLS` de la función `generate-sentences`.
  Palabras por llamada y días sin volver a pedir una palabra: `SENTENCE_BATCH` y `SENTENCE_RETRY_DAYS`
  en `sentences.js`. Frases compartidas por usuario y día: 200, en `schema.sql`.
