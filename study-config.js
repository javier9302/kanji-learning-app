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
       manual     la agregó el usuario a mano ("Quiero aprenderla")
       reading    apareció en una lectura del usuario
       kanji      proporción de sus kanjis que el usuario ya conoce
       frequency  puesto en la lista de frecuencia (1 = la más frecuente) */
  weights: { manual: 1000, reading: 100, kanji: 10, frequency: 1 },

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
