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
       reading    apareció en una lectura del usuario
       kanji      proporción de sus kanjis que el usuario ya conoce
       frequency  puesto en la lista de frecuencia (1 = la más frecuente) */
  weights: { manual: 1000, dictionary: 300, lookup: 200, reading: 100, kanji: 10, frequency: 1 },

  /* Días que tarda en apagarse la ventaja de una consulta reciente al diccionario */
  lookupDecayDays: 14,

  /* Puesto a partir del cual la frecuencia ya no suma nada */
  frequencyMaxRank: 6000,

  /* Una palabra básica con un kanji avanzado (N5-N4 con un kanji de N2-N1) no
     se presenta hasta que ese kanji haya salido en una lectura terminada.
     No se aplica a las palabras que agregó el usuario ni a las que marcó
     "Conozco la palabra pero no el kanji". */
  basicWordLevels: ["N5", "N4"],
  advancedKanjiLevels: ["N2", "N1"],

  /* "Ya la domino": días hasta el primer repaso de una palabra agregada así */
  masteredIntervalDays: 60,

  /* A partir de este intervalo (días) una palabra se da por dominada */
  masteredAtDays: 21,

  /* Palabras solo en kana que se le piden a la IA como vocabulario preferente */
  kanaWordsInPrompt: 40,

  /* Sección "Traducir": el estudiante escribe la traducción de una frase y una
     IA la corrige. Demuestra que entiende el SIGNIFICADO; no mueve el calendario
     de repaso de la lectura. */
  translate: {
    /* Frases que se pueden proponer: caracteres japoneses (sin contar la puntuación) */
    minChars: 4,
    maxChars: 40,
    /* Con más palabras desconocidas que estas la frase no se propone */
    maxUnknown: 2,

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
