/* =========================================
   KANJI LEARNING APP - study-config.js
   Todo lo que se puede ajustar del repaso está aquí: cambia un número,
   recarga la página y listo. Se carga antes de study.js.
   ========================================= */

const STUDY_CONFIG = {
  /* Palabras NUEVAS como máximo en cada sesión (se puede cambiar en Ajustes).
     Los repasos pendientes salen siempre antes y no cuentan para este tope. */
  maxNewPerSession: 5,

  /* Qué palabra nueva sale primero. Cada criterio vale entre 0 y 1 y se
     multiplica por su peso; gana la suma más alta. Con pesos tan separados
     el orden es estricto: un criterio solo desempata al anterior.
       manual     la agregó el usuario a mano ("Quiero aprenderla" o, en el
                  diccionario, "Estudiar esta palabra")
       dictionary la buscó en el diccionario: es una palabra que no conoce
       lookup     hace poco que la buscó: vale 1 el día de la consulta y baja
                  hasta 0 en lookupDecayDays días
       meaningFail falló su significado en Traducir y aún no lo ha demostrado
       reading    apareció en una lectura del usuario
       roadmap    está en la hoja de ruta del estudiante premium (Análisis)
       kanji      proporción de sus kanjis que el usuario ya conoce
       frequency  puesto en la lista de frecuencia (1 = la más frecuente) */
  weights: { manual: 1000, dictionary: 300, lookup: 200, meaningFail: 150, reading: 100, roadmap: 50, kanji: 10, frequency: 1 },

  /* Días que tarda en apagarse la ventaja de una consulta reciente al diccionario */
  lookupDecayDays: 14,

  /* Puesto a partir del cual la frecuencia ya no suma nada */
  frequencyMaxRank: 6000,

  /* Qué palabras nuevas se proponen: lo decide el nivel de sus KANJIS, no el de
     la palabra (hay palabras de N5 con un kanji de N1, y de N3 hechas solo con
     kanjis de N5). Reglas en learning-core.js (kanjiGate):
       - todos sus kanjis son de tu nivel o inferior, o ya los conoces;
       - o tiene varios kanjis, conoces al menos knownNeeded de ellos y la
         palabra es de tu nivel o inferior (puede llevar algún kanji superior).
     No se aplica a las palabras que agregó el usuario ni a las que marcó
     "Conozco la palabra pero no el kanji". */
  newWordKanji: { knownNeeded: 1 },

  /* Escribir: se avanza nivel a nivel (no salen kanjis de N4 hasta escribir
     todos los de N5, o aprobar la prueba de N5).
       reviewEvery  cada cuántos kanjis sale uno ya escrito, para no olvidarlo
       test         prueba para saltar un nivel: size kanjis al azar; se aprueba
                    con pass bien escritos (sin "Mostrar", sin pistas y con
                    como mucho maxMistakes trazos fallados) */
  writing: { reviewEvery: 5, test: { size: 8, pass: 7, maxMistakes: 1 } },

  /* "Ya la domino": días hasta el primer repaso de una palabra agregada así */
  masteredIntervalDays: 60,

  /* A partir de este intervalo (días) una palabra se da por dominada */
  masteredAtDays: 21,

  /* Palabras solo en kana que se le piden a la IA como vocabulario preferente */
  kanaWordsInPrompt: 40,

  /* Mis palabras → Análisis (premium; reglas en progress-core.js).
       levelDone    proporción de una lista JLPT que hay que saber (dominada o
                    dada por sabida) para que su nivel cuente como completo
       recentTexts  cuántos textos recientes se miran para la lectura
       grammar      cuándo una estructura cuenta como entendida (cleanReads
                    frases leídas sin consultar nada) o dominada (traducciones
                    buenas en masteredDays días distintos); grammar-core.js */
  analysis: {
    levelDone: 0.8, recentTexts: 5, grammar: { cleanReads: 3, masteredDays: 2 },
    /* Hoja de ruta (progress-core.js, buildRoadmap): metas de cada semana
         weeklyWords, weeklyKanji, weeklyGrammar, weeklyTexts  cuánto se propone
         preview        cuántas palabras o kanjis siguientes se enseñan
         minCoverage    con menos % conocido en sus textos, se le proponen más fáciles
         maxLookups     …o si consulta más de estas palabras por cada 100
         minActiveDays  días con estudio en 30 por debajo de los que se avisa */
    roadmap: { weeklyWords: 35, weeklyKanji: 10, weeklyGrammar: 2, weeklyTexts: 3, preview: 8,
      minCoverage: 85, maxLookups: 8, minActiveDays: 12 }
  },
  /* Sección "Traducir": el estudiante escribe la traducción de una frase y una
     IA la corrige. Demuestra que entiende el SIGNIFICADO; no mueve el calendario
     de repaso de la lectura. */
  translate: {
    /* Frases que se pueden proponer: caracteres japoneses (sin contar la puntuación) */
    minChars: 4,
    maxChars: 40,
    /* Con más palabras desconocidas que estas la frase no se propone */
    maxUnknown: 2,
    /* La respuesta: máximo de caracteres (el servidor aplica el mismo límite) y
       mínimo de letras para que merezca la pena corregirla */
    answerMax: 100,
    answerMinLetters: 3,

    /* Ahorro de llamadas a la IA: si la respuesta coincide casi palabra por
       palabra con la traducción de referencia se da por buena sin preguntar.
       localMatch: parecido mínimo (0 a 1; 1 = idéntica salvo mayúsculas, acentos,
       puntuación y artículos). Súbelo a más de 1 para desactivarlo.
       localMinWords: con una referencia más corta que esto nunca se acepta sin IA. */
    localMatch: 0.9,
    localMinWords: 2,

    /* PROGRESO. Traducir demuestra que se entiende el significado; nunca cambia
       el calendario de repaso de la lectura.
       credit: cuánto suma una palabra entendida según quién lo dice:
         ai         la corrigió la IA
         local      coincidía con la traducción de referencia (sin IA)
         self       se corrigió el propio estudiante
         contested  el estudiante no estuvo de acuerdo con la IA
       Una palabra que tocó para ver su significado no suma nada.
       promoteAt: puntos seguidos (sin fallar entre medias, y cada frase cuenta
         una sola vez por palabra) para dar su significado por sabido. Con el
         crédito 1 de la IA son 2 frases distintas. Entonces una palabra "por
         confirmar" pasa a dominada. Un fallo pone la cuenta a cero.
       kanjiWords: palabras distintas con ese kanji cuyo significado se sabe así
         para dar por sabido el significado del kanji. Una sola no basta. */
    credit: { ai: 1, local: 0.5, self: 0.5, contested: 0.5 },
    promoteAt: 2,
    kanjiWords: 3,

    /* Qué frase sale primero: gana la suma más alta.
         known      proporción de sus palabras que el usuario conoce (0 a 1)
         unknown    puntos según cuántas NO conoce: [ninguna, una, dos]
         learning   por cada palabra en "aprendiendo" o "por confirmar"
         lookups    por cada palabra que ha consultado alguna vez
         failed     por cada palabra que ha fallado (evaluación, repaso o traducción)
         perWordMax tope de palabras que suman en cada uno de los tres anteriores
         recent     se RESTA si la frase salió hace poco: entera el mismo día,
                    hasta 0 pasados recentDays días
         sameText   se RESTA si es del mismo texto que la frase anterior */
    choose: {
      known: 10, unknown: [0, 4, 2], learning: 3, lookups: 2, failed: 3, perWordMax: 3,
      recent: 30, recentDays: 5, sameText: 4
    }
  },

  /* FSRS (https://github.com/open-spaced-repetition/ts-fsrs)
       request_retention  probabilidad de recordar que se busca (0.9 = 90 %);
                          más alta = repasos más seguidos
       maximum_interval   tope de días entre dos repasos
       learning_steps     pasos de una palabra nueva antes de pasar a días
       relearning_steps   pasos de una palabra fallada */
  fsrs: {
    request_retention: 0.9,
    maximum_interval: 365,
    enable_fuzz: false,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"]
  }
};
