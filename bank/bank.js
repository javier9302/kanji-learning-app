/* =========================================
   KANJI LEARNING APP - bank/bank.js
   Banco común de palabras y kanjis, igual para todos los estudiantes.
   Son dos entidades distintas:

   PALABRA  { id, w, r, en, es, alt, amb, kana, level, kanji }
     id     "escritura|lectura"  (la lectura en hiragana)       角|かど
     w, r   escritura y su ÚNICA lectura correcta
     en/es  significado en inglés / español
     alt    otras lecturas de la MISMA palabra (にほん / にっぽん): no son un fallo
     amb    true si la misma escritura tiene otra lectura con otro significado
            (角 かど "esquina" y 角 つの "cuerno"): se muestra con su significado
     kana   true si casi siempre se escribe en kana (有る -> ある). No se
            estudia su lectura ni se usa de ejemplo de sus kanjis, y a la IA
            se le pide en kana para que no escriba 有ります
     kanji  kanjis que la componen

   KANJI    { c, en, es, on, kun, level, words }
     c      el carácter;  en/es  su significado
     on/kun lecturas, solo informativas: a un kanji suelto nunca se le pide
            la lectura (eso se pregunta a las palabras)
     words  palabras del banco (ya cargadas) donde aparece

   Cada nivel va en su archivo (bank/n5.js … bank/n1.js) y se carga cuando
   hace falta con BANK.load("N5"). Fuentes: JMdict y KANJIDIC2 (EDRDG,
   CC BY-SA 4.0) y las listas JLPT de open-anki-jlpt-decks.
   ========================================= */

const BANK = {
  LEVELS: ["N5", "N4", "N3", "N2", "N1"],
  words: new Map(),      // id -> palabra
  byWriting: new Map(),  // escritura -> [palabras]
  kanji: new Map(),      // carácter -> kanji
  loading: {},           // nivel -> promesa de carga

  /* La misma clave que usa el progreso del usuario */
  id(writing, reading) {
    const kana = String(reading).normalize("NFKC")
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[.\-\s・~]/g, "");
    return `${String(writing).normalize("NFKC")}|${kana}`;
  },

  /* La llaman los archivos de cada nivel */
  add(level, data) {
    for (const [c, en, es, on, kun] of data.kanji) {
      this.kanji.set(c, { c, en, es, on, kun, level, words: [] });
    }
    const fresh = [];
    for (const [w, r, en, es, alt = [], amb = 0, kana = 0] of data.words) {
      const word = {
        id: this.id(w, r), w, r, en, es, alt, amb: !!amb, kana: !!kana, level,
        kanji: [...new Set([...w].filter((ch) => ch !== "々" && /\p{Script=Han}/u.test(ch)))]
      };
      this.words.set(word.id, word);
      if (!this.byWriting.has(w)) this.byWriting.set(w, []);
      this.byWriting.get(w).push(word);
      fresh.push(word);
    }
    this.link(fresh);
  },

  /* Relaciona cada kanji con las palabras donde aparece (también de otros niveles) */
  link(fresh) {
    for (const word of fresh) {
      if (word.kana) continue; // no sirve de ejemplo de un kanji que casi nunca lleva
      for (const c of word.kanji) this.kanji.get(c)?.words.push(word);
    }
    // Un kanji de un nivel recién cargado puede aparecer en palabras cargadas antes
    const known = new Set(fresh);
    for (const word of this.words.values()) {
      if (known.has(word) || word.kana) continue;
      for (const c of word.kanji) {
        const kanji = this.kanji.get(c);
        if (kanji && !kanji.words.includes(word)) kanji.words.push(word);
      }
    }
  },

  loaded(level) {
    return [...this.words.values()].some((word) => word.level === level);
  },

  /* Carga un nivel (una sola vez). Devuelve una promesa. */
  load(level) {
    if (!this.LEVELS.includes(level)) return Promise.reject(new Error(`Nivel desconocido: ${level}`));
    return this.loading[level] ??= new Promise((resolve, reject) => {
      if (this.loaded(level)) return resolve();
      const script = document.createElement("script");
      script.src = `bank/${level.toLowerCase()}.js`;
      script.onload = () => resolve();
      script.onerror = () => {
        delete this.loading[level];
        reject(new Error(`No se pudo cargar el banco ${level}`));
      };
      document.head.appendChild(script);
    });
  },

  /* Carga desde N5 hasta el nivel indicado */
  loadUpTo(level) {
    return Promise.all(this.LEVELS.slice(0, this.LEVELS.indexOf(level) + 1).map((l) => this.load(l)));
  },

  /* Significado en el idioma de la interfaz (si falta en español, en inglés) */
  meaning(entry, language) {
    return language === "es" && entry.es.length ? entry.es : entry.en;
  },

  /* ¿Hay que mostrar el significado junto a la palabra para saber cuál es? */
  isAmbiguous(word) {
    return word.amb && this.byWriting.get(word.w).length > 1;
  },

  /* ¿Este kanji es por sí solo una palabra? (人 sí; 強 no) */
  kanjiIsWord(c) {
    return this.byWriting.has(c);
  }
};
