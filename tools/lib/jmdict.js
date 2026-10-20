/* JMdict (EDRDG, CC BY-SA 4.0): leer sus entradas y convertirlas en las filas
   del diccionario general de la app: [escritura, lectura, inglés[], español[], uk].
   Sin archivos: solo texto, para poder probarlo. */

const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
/* Las entidades del DTD (&uk;, &v1;) quedan como texto: se guarda su nombre */
const entity = (text) => text.replace(/^&|;$/g, "");

/* Una <entry> de JMdict -> objeto */
function parseEntry(xml) {
  return {
    kebs: all(xml, "k_ele").map((block) => ({
      text: decode(all(block, "keb")[0] || ""), pri: all(block, "ke_pri"), inf: all(block, "ke_inf").map(entity)
    })),
    rebs: all(xml, "r_ele").map((block) => ({
      text: decode(all(block, "reb")[0] || ""), pri: all(block, "re_pri"), restr: all(block, "re_restr").map(decode),
      nokanji: block.includes("<re_nokanji"), inf: all(block, "re_inf").map(entity)
    })),
    senses: all(xml, "sense").map((block) => ({
      pos: all(block, "pos").map(entity), misc: all(block, "misc").map(entity),
      gloss: [...block.matchAll(/<gloss(?: xml:lang="([a-z]+)")?[^>]*>([\s\S]*?)<\/gloss>/g)]
        .map((m) => ({ lang: m[1] || "eng", text: decode(m[2]) }))
    }))
  };
}

/* Prioridad de una escritura o lectura: más alta = más común */
const COMMON = new Set(["news1", "ichi1", "spec1", "spec2", "gai1"]);
function priority(list) {
  let score = 0;
  for (const tag of list) {
    if (COMMON.has(tag)) score += tag === "spec2" ? 10 : 30;
    else if (/^(news2|ichi2|gai2)$/.test(tag)) score += 5;
    const nf = /^nf(\d\d)$/.exec(tag);
    if (nf) score += Math.max(0, 50 - Number(nf[1]));
  }
  return score;
}
const isCommon = (entry) => [...entry.kebs, ...entry.rebs].some((el) => el.pri.some((tag) => COMMON.has(tag)));

/* Hasta 3 significados de un idioma, empezando por el primer sentido */
function glosses(entry, lang, max = 3) {
  const list = [];
  for (const sense of entry.senses) {
    for (const gloss of sense.gloss) {
      if (gloss.lang === lang && !list.includes(gloss.text)) list.push(gloss.text);
      if (list.length >= max) return list;
    }
  }
  return list;
}

/* Palabras muy frecuentes que en un texto suelen ir en kana con el significado
   de esta escritura, aunque JMdict no las marque "casi siempre en kana" (o
   marque otra palabra que se escribe igual): もの es 物 "cosa", no la partícula. */
const KANA_PREFER = { もの: "物", ほう: "方", とき: "時", ため: "為", こと: "事", ところ: "所", うち: "内" };

/* Filas de una entrada común:
   - cada escritura con kanji que no sea rara ni antigua, con la lectura que le corresponde;
   - la forma en kana (escritura = lectura) si la palabra se escribe en kana: no tiene
     kanji, o su primer sentido lleva "uk" (casi siempre en kana: いる, する, なる).
   Cada fila lleva una puntuación para elegir entre entradas con la misma forma
   (いる es 居る "estar" antes que 要る "necesitar"). */
function rowsOf(entry) {
  if (!isCommon(entry) || !entry.rebs.length) return [];
  const en = glosses(entry, "eng"), es = glosses(entry, "spa");
  if (!en.length) return [];
  const uk = entry.senses[0]?.misc.includes("uk") || false;
  const rows = [];
  const rare = (el) => el.inf.some((tag) => ["rK", "iK", "oK", "sK", "ik", "ok", "sk"].includes(tag));
  for (const keb of entry.kebs.filter((el) => !rare(el))) {
    const reb = entry.rebs.find((r) => !r.nokanji && !rare(r) && (!r.restr.length || r.restr.includes(keb.text)));
    if (!reb) continue;
    rows.push({ row: [keb.text, reb.text, en, es, uk ? 1 : 0], score: priority([...keb.pri, ...reb.pri]) });
  }
  // Forma en kana preferida a mano: gana a cualquier otra palabra que se escriba igual
  for (const reb of entry.rebs) {
    const keb = KANA_PREFER[reb.text];
    if (keb && entry.kebs.some((el) => el.text === keb)) rows.push({ row: [reb.text, reb.text, en, es, uk ? 1 : 0], score: 1000 });
  }
  if (!entry.kebs.length || uk) {
    // Varias palabras pueden escribirse igual en kana (いる: 居る "estar" y 要る "necesitar").
    // Se elige con estas señales, por orden de peso:
    //   1. su forma normal ES la de kana: no tiene ninguna escritura con kanji que no sea rara (居る, 為る);
    //   2. el número de sentidos: las palabras básicas tienen muchos (成る "llegar a ser" frente a 生る "dar fruto");
    //   3. la prioridad de JMdict, poco fiable para esto, solo para desempatar.
    const kanaForm = !entry.kebs.some((el) => !rare(el));
    const senses = entry.senses.filter((sense) => sense.gloss.some((gloss) => gloss.lang === "eng")).length;
    for (const reb of entry.rebs.filter((r) => !rare(r))) {
      rows.push({ row: [reb.text, reb.text, en, es, uk ? 1 : 0],
        score: (kanaForm ? 100 : 50) + Math.min(senses, 10) * 4 + priority(reb.pri) / 10 });
    }
  }
  return rows;
}

/* Todas las filas, una por (escritura, lectura): si varias entradas coinciden, la mejor puntuada.
   skip(escritura, lectura): las que ya están en el banco de la app no hacen falta. */
function buildRows(entries, skip = () => false) {
  const best = new Map();
  for (const entry of entries) {
    for (const { row, score } of rowsOf(entry)) {
      if (skip(row[0], row[1])) continue;
      const key = `${row[0]}\u0000${row[1]}`;
      if (!best.has(key) || score > best.get(key).score) best.set(key, { row, score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((item) => item.row);
}

/* Otras escrituras de las palabras del banco: si una entrada de JMdict tiene la
   escritura y la lectura de una palabra del banco (終る おわる), sus demás
   escrituras normales (終わる) son la misma palabra.
     bankWords   [{ id, w, r }]  (r en hiragana)
     isBankWriting(escritura)  si ya es una escritura del banco (entonces no es alternativa)
   Devuelve { escritura: id }. Si una escritura sirve a dos palabras distintas, se descarta. */
function buildAliases(entries, bankWords, isBankWriting, toHiragana) {
  const byKey = new Map(bankWords.map((word) => [`${word.w}\u0000${word.r}`, word.id]));
  const rare = (el) => el.inf.some((tag) => ["rK", "iK", "oK", "sK", "ik", "ok", "sk"].includes(tag));
  const aliases = new Map(), clash = new Set();
  for (const entry of entries) {
    const kebs = entry.kebs.filter((el) => !rare(el)).map((el) => el.text);
    for (const keb of entry.kebs.map((el) => el.text)) {
      for (const reb of entry.rebs) {
        const id = byKey.get(`${keb}\u0000${toHiragana(reb.text)}`);
        if (!id) continue;
        for (const other of kebs) {
          if (other === keb || isBankWriting(other)) continue;
          if (aliases.has(other) && aliases.get(other) !== id) clash.add(other);
          else aliases.set(other, id);
        }
      }
    }
  }
  for (const writing of clash) aliases.delete(writing);
  return Object.fromEntries([...aliases].sort());
}

module.exports = { parseEntry, rowsOf, buildRows, buildAliases, priority, isCommon, glosses, KANA_PREFER };
