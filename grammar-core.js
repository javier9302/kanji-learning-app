/* =========================================
   KANJI LEARNING APP - grammar-core.js
   Gramática: el catálogo de estructuras por nivel JLPT, el detector que las
   encuentra en una frase y la medición de cuáles maneja el estudiante. Sin
   navegador ni datos del usuario alrededor, para poder probarlo con Node. Se
   carga después de progress-core.js; lo usa progress.js.

   El detector trabaja sobre las piezas de kuromoji de la frase entera (no
   sobre las unidades de la app): cada pieza trae su categoría, su forma
   conjugada y su forma de diccionario, y con eso cada estructura es una regla
   corta. 食べました -> 食べ(連用形) まし(ます, 連用形) た -> "mashita".
   Una frase puede tener varias estructuras y una estructura puede contener
   otra (〜ませんでした también es una negación cortés): se anotan todas.

   Para añadir una estructura: una entrada en GRAMMAR con su regla y una
   frase de ejemplo en test/grammar.test.js que la detecte. Niveles: N5 y N4.
   ========================================= */

/* Pieza de kuromoji en forma corta: s superficie, p categoría, d subcategoría,
   f forma conjugada, b forma de diccionario */
const gcPiece = (piece) => piece.s !== undefined ? piece : {
  s: piece.surface_form, p: piece.pos, d: piece.pos_detail_1, f: piece.conjugated_form,
  b: piece.basic_form && piece.basic_form !== "*" ? piece.basic_form : piece.surface_form
};

/* ¿La pieza cumple todo lo pedido? Cada valor puede ser uno o una lista */
const gcIs = (piece, spec) => !!piece && Object.entries(spec).every(([key, value]) =>
  Array.isArray(value) ? value.includes(piece[key]) : piece[key] === value);
/* Una secuencia de piezas seguidas a partir de i */
const gcSeq = (...specs) => (pieces, i) => specs.every((spec, k) => gcIs(pieces[i + k], spec));

const TE = { s: ["て", "で"], p: "助詞", d: "接続助詞" };
const VERB = { p: "動詞" };
const MASU = { b: "ます", p: "助動詞" };
const DESU = { b: "です", p: "助動詞" };
const TA = { b: "た", p: "助動詞" };
const NAI = { b: "ない", p: "助動詞" };
const N_ = { b: "ん", p: "助動詞" };
const END = (piece) => !piece || piece.p === "記号";

/* Las estructuras. id estable (se guarda en las fotos del progreso), nivel,
   cómo se escribe, qué significa (es / en), un ejemplo y la regla:
   match(piezas, i) -> ¿empieza aquí? */
const GRAMMAR = [
  // Partículas
  { id: "wa", level: "N5", ja: "は", es: "tema de la frase", en: "topic marker", example: "私は学生です。",
    match: gcSeq({ s: "は", p: "助詞", d: "係助詞" }) },
  { id: "ga", level: "N5", ja: "が", es: "sujeto", en: "subject marker", example: "猫がいます。",
    match: gcSeq({ s: "が", p: "助詞", d: "格助詞" }) },
  { id: "wo", level: "N5", ja: "を", es: "objeto directo", en: "direct object", example: "水を飲みます。",
    match: gcSeq({ s: "を", p: "助詞" }) },
  { id: "ni", level: "N5", ja: "に", es: "destino, momento, lugar donde está algo", en: "destination, time, location", example: "七時に起きます。",
    match: gcSeq({ s: "に", p: "助詞", d: "格助詞" }) },
  { id: "de", level: "N5", ja: "で", es: "lugar de la acción, medio", en: "place of action, means", example: "公園で遊びます。",
    match: gcSeq({ s: "で", p: "助詞", d: "格助詞" }) },
  { id: "he", level: "N5", ja: "へ", es: "dirección", en: "direction", example: "学校へ行きます。",
    match: gcSeq({ s: "へ", p: "助詞" }) },
  { id: "to", level: "N5", ja: "と", es: "con, y (lista completa)", en: "with, and", example: "友達と行きます。",
    match: gcSeq({ s: "と", p: "助詞", d: ["格助詞", "並立助詞"] }) },
  { id: "mo", level: "N5", ja: "も", es: "también", en: "also, too", example: "私も行きます。",
    match: gcSeq({ s: "も", p: "助詞", d: "係助詞" }) },
  { id: "no", level: "N5", ja: "の", es: "posesión, de", en: "possessive, of", example: "私の本です。",
    match: gcSeq({ s: "の", p: "助詞", d: "連体化" }) },
  { id: "ya", level: "N5", ja: "や", es: "y (lista incompleta)", en: "and (among others)", example: "ペンや本があります。",
    match: gcSeq({ s: "や", p: "助詞", d: "並立助詞" }) },
  { id: "ka", level: "N5", ja: "〜か", es: "pregunta", en: "question", example: "これは何ですか。",
    match: (pieces, i) => gcIs(pieces[i], { s: "か", p: "助詞" }) && END(pieces[i + 1]) },
  { id: "ne-yo", level: "N5", ja: "〜ね・〜よ", es: "buscar acuerdo, informar", en: "seeking agreement, asserting", example: "いいですね。",
    match: gcSeq({ s: ["ね", "よ"], p: "助詞", d: "終助詞" }) },
  { id: "kara-made", level: "N5", ja: "〜から〜まで", es: "desde… hasta…", en: "from… to…", example: "駅から家まで歩きます。",
    match: (pieces, i) => gcIs(pieces[i], { s: "まで", p: "助詞" }) ||
      gcIs(pieces[i], { s: "から", p: "助詞", d: "格助詞" }) && !gcIs(pieces[i - 1], TE) },
  { id: "dake", level: "N5", ja: "〜だけ", es: "solo", en: "only", example: "一つだけ買います。",
    match: gcSeq({ s: "だけ", p: "助詞" }) },
  { id: "gurai", level: "N5", ja: "〜ぐらい・〜くらい", es: "aproximadamente", en: "about, approximately", example: "一時間ぐらい歩きます。",
    match: gcSeq({ s: ["ぐらい", "くらい"], p: "助詞" }) },
  { id: "goro", level: "N5", ja: "〜ごろ", es: "hacia (una hora)", en: "around (a time)", example: "三時ごろ帰ります。",
    match: gcSeq({ b: ["ごろ", "頃"], p: "名詞", d: "接尾" }) },

  // Copula
  { id: "desu", level: "N5", ja: "〜です", es: "ser, estar (cortés)", en: "to be (polite)", example: "学生です。",
    match: gcSeq({ ...DESU, f: "基本形" }) },
  { id: "da", level: "N5", ja: "〜だ", es: "ser, estar (llano)", en: "to be (plain)", example: "雨だ。",
    match: gcSeq({ b: "だ", p: "助動詞", f: "基本形" }) },
  { id: "deshita", level: "N5", ja: "〜でした", es: "era, estaba (cortés)", en: "was (polite)", example: "学生でした。",
    match: (pieces, i) => gcSeq({ ...DESU, f: "連用形" }, TA)(pieces, i) && !gcIs(pieces[i - 1], N_) },
  { id: "ja-nai", level: "N5", ja: "〜じゃない・〜ではありません", es: "no es", en: "is not", example: "学生じゃありません。",
    match: (pieces, i) => {
      const start = gcIs(pieces[i], { s: "じゃ" }) ? 1 : gcSeq({ s: "で" }, { s: "は" })(pieces, i) ? 2
        : gcIs(pieces[i], { s: "では", p: "接続詞" }) ? 1 : 0;
      if (!start) return false;
      const next = pieces[i + start];
      return gcIs(next, NAI) || gcIs(next, { b: "ある" }) && gcIs(pieces[i + start + 1], MASU);
    } },
  { id: "deshou", level: "N5", ja: "〜でしょう", es: "probablemente", en: "probably", example: "明日は雨でしょう。",
    match: gcSeq({ ...DESU, f: "未然形" }, { b: "う", p: "助動詞" }) },

  // Verbos: forma cortés
  { id: "masu", level: "N5", ja: "〜ます", es: "presente cortés", en: "polite present", example: "毎日食べます。",
    match: gcSeq({ ...MASU, f: "基本形" }) },
  { id: "mashita", level: "N5", ja: "〜ました", es: "pasado cortés", en: "polite past", example: "昨日食べました。",
    match: gcSeq({ ...MASU, f: "連用形" }, TA) },
  { id: "masen", level: "N5", ja: "〜ません", es: "negación cortés", en: "polite negative", example: "肉を食べません。",
    match: (pieces, i) => gcSeq({ ...MASU, f: "未然形" }, N_)(pieces, i) && !gcIs(pieces[i + 2], DESU) },
  { id: "masen-deshita", level: "N5", ja: "〜ませんでした", es: "pasado negativo cortés", en: "polite past negative", example: "行きませんでした。",
    match: gcSeq({ ...MASU, f: "未然形" }, N_, DESU, TA) },
  { id: "mashou", level: "N5", ja: "〜ましょう", es: "propuesta: hagamos…", en: "let's…", example: "行きましょう。",
    match: (pieces, i) => gcSeq({ ...MASU, f: "未然ウ接続" }, { b: "う" })(pieces, i) && !gcIs(pieces[i + 2], { s: "か" }) },
  { id: "mashou-ka", level: "N5", ja: "〜ましょうか", es: "ofrecerse: ¿hago…?", en: "shall I / shall we…?", example: "窓を開けましょうか。",
    match: gcSeq({ ...MASU, f: "未然ウ接続" }, { b: "う" }, { s: "か" }) },
  { id: "masen-ka", level: "N5", ja: "〜ませんか", es: "invitación: ¿por qué no…?", en: "won't you…? (invitation)", example: "一緒に行きませんか。",
    match: gcSeq({ ...MASU, f: "未然形" }, N_, { s: "か", p: "助詞" }) },

  // Verbos: forma llana
  { id: "nai", level: "N5", ja: "〜ない", es: "negación llana", en: "plain negative", example: "肉を食べない。",
    match: (pieces, i) => gcIs(pieces[i], NAI) && gcIs(pieces[i - 1], VERB) },
  { id: "ta", level: "N5", ja: "〜た", es: "pasado llano", en: "plain past", example: "昨日食べた。",
    match: (pieces, i) => gcIs(pieces[i], TA) && gcIs(pieces[i - 1], VERB) },
  { id: "nakatta", level: "N5", ja: "〜なかった", es: "pasado negativo llano", en: "plain past negative", example: "食べなかった。",
    match: (pieces, i) => gcIs(pieces[i - 1], VERB) && gcSeq({ ...NAI, f: "連用タ接続" }, TA)(pieces, i) },
  { id: "te", level: "N5", ja: "〜て", es: "forma て: unir acciones", en: "te-form: linking actions", example: "起きて、顔を洗います。",
    match: (pieces, i) => gcIs(pieces[i], TE) && gcIs(pieces[i - 1], VERB) },
  { id: "te-iru", level: "N5", ja: "〜ている", es: "acción en curso o estado", en: "ongoing action or state", example: "本を読んでいます。",
    match: (pieces, i) => gcSeq(TE, { b: "いる", p: "動詞", d: "非自立" })(pieces, i) ||
      gcIs(pieces[i], { b: ["てる", "でる"], p: "動詞", d: "非自立" }) },
  { id: "te-kudasai", level: "N5", ja: "〜てください", es: "petición: por favor…", en: "please do…", example: "見てください。",
    match: gcSeq(TE, { b: "くださる" }) },
  { id: "naide-kudasai", level: "N5", ja: "〜ないでください", es: "petición: por favor, no…", en: "please don't…", example: "見ないでください。",
    match: gcSeq(NAI, { s: "で" }, { b: "くださる" }) },
  // なくてもいい y なくてはいけない son otra cosa (N4: no hace falta / tener que)
  { id: "te-mo-ii", level: "N5", ja: "〜てもいい", es: "permiso: se puede…", en: "may, it's okay to…", example: "見てもいいです。",
    match: (pieces, i) => gcSeq(TE, { s: "も" }, { b: ["いい", "よい", "良い"] })(pieces, i) && !gcIs(pieces[i - 1], NAI) },
  { id: "te-wa-ikenai", level: "N5", ja: "〜てはいけない", es: "prohibición: no se debe…", en: "must not…", example: "見てはいけません。",
    match: (pieces, i) => gcSeq(TE, { s: "は" }, { b: "いける" })(pieces, i) && !gcIs(pieces[i - 1], NAI) },
  { id: "te-kara", level: "N5", ja: "〜てから", es: "después de hacer…", en: "after doing…", example: "食べてから寝ます。",
    match: gcSeq(TE, { s: "から", p: "助詞" }) },
  { id: "tai", level: "N5", ja: "〜たい", es: "querer hacer…", en: "want to…", example: "水が飲みたい。",
    match: gcSeq({ b: "たい", p: "助動詞" }) },
  { id: "tari", level: "N5", ja: "〜たり〜たりする", es: "hacer cosas como… y…", en: "doing things like… and…", example: "読んだり書いたりします。",
    match: gcSeq({ s: ["たり", "だり"], p: "助詞" }) },
  { id: "mae-ni", level: "N5", ja: "〜前に", es: "antes de…", en: "before…", example: "寝る前に歯を磨きます。",
    match: (pieces, i) => gcSeq({ b: "前", p: "名詞" }, { s: "に" })(pieces, i) &&
      (gcIs(pieces[i - 1], { ...VERB, f: "基本形" }) || gcIs(pieces[i - 1], { s: "の", d: "連体化" })) },
  { id: "ato-de", level: "N5", ja: "〜後で", es: "después de…", en: "after…", example: "食べた後で寝ます。",
    match: (pieces, i) => gcSeq({ b: ["後", "あと"], p: "名詞" }, { s: "で" })(pieces, i) &&
      (gcIs(pieces[i - 1], TA) || gcIs(pieces[i - 1], { s: "の", d: "連体化" })) },
  { id: "toki", level: "N5", ja: "〜とき", es: "cuando…", en: "when…", example: "行くとき、傘を持ちます。",
    match: gcSeq({ b: ["とき", "時"], p: "名詞", d: "非自立" }) },
  { id: "ni-iku", level: "N5", ja: "〜に行く・〜に来る", es: "ir / venir a hacer…", en: "go / come to do…", example: "見に来ました。",
    match: (pieces, i) => gcSeq({ s: "に", p: "助詞" }, { b: ["行く", "来る", "帰る"], p: "動詞" })(pieces, i) &&
      (gcIs(pieces[i - 1], { ...VERB, f: "連用形" }) || gcIs(pieces[i - 1], { p: "名詞", d: "サ変接続" })) },
  { id: "aru-iru", level: "N5", ja: "〜があります・〜がいます", es: "hay, existir, estar", en: "there is, to exist", example: "猫がいます。",
    match: (pieces, i) => gcIs(pieces[i], { b: ["ある", "いる"], p: "動詞", d: "自立" }) && gcIs(pieces[i - 1], { s: ["が", "は", "も"], p: "助詞" }) },

  // Adjetivos
  { id: "na-adj", level: "N5", ja: "〜な＋名詞", es: "adjetivo な delante de un sustantivo", en: "な-adjective before a noun", example: "静かな部屋です。",
    match: gcSeq({ d: "形容動詞語幹" }, { b: "だ", f: "体言接続" }) },
  { id: "i-adj-past", level: "N5", ja: "〜かった", es: "pasado de un adjetivo い", en: "い-adjective past", example: "高かったです。",
    match: gcSeq({ p: "形容詞", f: "連用タ接続" }, TA) },
  { id: "i-adj-neg", level: "N5", ja: "〜くない", es: "negación de un adjetivo い", en: "い-adjective negative", example: "高くないです。",
    match: gcSeq({ p: "形容詞", f: "連用テ接続" }, NAI) },
  { id: "naru", level: "N5", ja: "〜くなる・〜になる", es: "llegar a ser, volverse", en: "to become", example: "高くなりました。",
    match: (pieces, i) => gcIs(pieces[i], { b: "なる", p: "動詞" }) &&
      (gcIs(pieces[i - 1], { p: "形容詞", f: "連用テ接続" }) || gcIs(pieces[i - 1], { s: "に", p: "助詞" })) },
  { id: "hoshii", level: "N5", ja: "〜がほしい", es: "querer (algo)", en: "to want (something)", example: "車がほしい。",
    match: gcSeq({ b: ["ほしい", "欲しい"], p: "形容詞", d: "自立" }) },
  { id: "suki", level: "N5", ja: "〜が好き・〜が上手", es: "gustar, saber hacer bien", en: "to like, to be good at", example: "テニスが好きです。",
    match: (pieces, i) => gcIs(pieces[i], { b: ["好き", "嫌い", "上手", "下手", "大好き"] }) && gcIs(pieces[i - 1], { s: "が", p: "助詞" }) },
  { id: "yori", level: "N5", ja: "〜より〜のほうが", es: "comparación: más… que…", en: "comparison: more… than…", example: "犬より猫のほうが好きです。",
    match: (pieces, i) => gcIs(pieces[i], { s: "より", p: "助詞", d: "格助詞" }) ||
      gcSeq({ b: ["ほう", "方"], p: "名詞", d: "非自立" }, { s: "が" })(pieces, i) },
  { id: "ichiban", level: "N5", ja: "〜が一番", es: "el más…", en: "the most…", example: "これが一番です。",
    match: gcSeq({ b: ["一番", "いちばん"] }) },

  // Unir frases
  { id: "kara", level: "N5", ja: "〜から", es: "porque", en: "because", example: "高いから買いません。",
    match: gcSeq({ s: "から", p: "助詞", d: "接続助詞" }) },
  { id: "ga-but", level: "N5", ja: "〜が", es: "pero", en: "but", example: "高いですが、おいしいです。",
    match: gcSeq({ s: "が", p: "助詞", d: "接続助詞" }) },
  { id: "kedo", level: "N5", ja: "〜けど", es: "pero (coloquial)", en: "but (casual)", example: "高いけど買います。",
    match: gcSeq({ s: ["けど", "けれど", "けれども"], p: "助詞" }) },
  // ===== N4 =====
  // Formas del verbo
  { id: "rareru", level: "N4", ja: "〜られる・〜れる", es: "pasiva, potencial o respeto", en: "passive, potential or honorific", example: "先生に褒められました。",
    match: (pieces, i) => gcIs(pieces[i], { p: "動詞", d: "接尾", b: ["られる", "れる"] }) && !gcIs(pieces[i - 1], { d: "接尾", b: ["させる", "せる"] }) },
  { id: "saseru", level: "N4", ja: "〜させる・〜せる", es: "causativa: hacer / dejar que…", en: "causative: make / let someone…", example: "母に野菜を食べさせました。",
    match: (pieces, i) => gcIs(pieces[i], { p: "動詞", d: "接尾", b: ["させる", "せる"] }) && !gcIs(pieces[i + 1], { d: "接尾", b: ["られる", "れる"] }) },
  { id: "saserareru", level: "N4", ja: "〜させられる", es: "causativa pasiva: obligar a…", en: "causative passive: be made to…", example: "野菜を食べさせられた。",
    match: gcSeq({ p: "動詞", d: "接尾", b: ["させる", "せる"] }, { p: "動詞", d: "接尾", b: ["られる", "れる"] }) },
  { id: "volitional", level: "N4", ja: "〜よう・〜おう", es: "forma volitiva: vamos a…, voy a…", en: "volitional: let's…, I'll…", example: "行こう。",
    match: gcSeq({ p: "動詞", f: "未然ウ接続" }, { b: ["う", "よう"], p: "助動詞" }) },
  { id: "you-to-omou", level: "N4", ja: "〜ようと思う", es: "pensar hacer…", en: "to intend / think of doing…", example: "毎日運動しようと思います。",
    match: gcSeq({ p: "動詞", f: "未然ウ接続" }, { b: ["う", "よう"], p: "助動詞" }, { s: "と" }, { b: "思う" }) },
  { id: "nasai", level: "N4", ja: "〜なさい", es: "orden: haz…", en: "command: do…", example: "早く食べなさい。",
    match: (pieces, i) => gcIs(pieces[i], { b: "なさる", d: "非自立" }) && gcIs(pieces[i - 1], { ...VERB, f: "連用形" }) },

  // Condicionales
  { id: "tara", level: "N4", ja: "〜たら", es: "si…, cuando…", en: "if…, when…", example: "雨が降ったら、行きません。",
    match: gcSeq({ ...TA, f: "仮定形" }) },
  { id: "ba", level: "N4", ja: "〜ば", es: "si… (condicional)", en: "if… (conditional)", example: "安ければ買います。",
    match: (pieces, i) => gcIs(pieces[i], { s: "ば", p: "助詞", d: "接続助詞" }) && gcIs(pieces[i - 1], { f: "仮定形" }) && !gcIs(pieces[i - 1], NAI) },
  { id: "to-cond", level: "N4", ja: "〜と", es: "condicional: siempre que…, al…", en: "whenever…, when…", example: "春になると暖かくなります。",
    match: (pieces, i) => gcIs(pieces[i], { s: "と", p: "助詞", d: "接続助詞" }) && gcIs(pieces[i - 1], { f: "基本形" }) },
  { id: "nara", level: "N4", ja: "〜なら", es: "si es así…, en cuanto a…", en: "if (it's the case that)…", example: "雨なら行きません。",
    match: gcSeq({ s: "なら", b: "だ", f: "仮定形" }) },
  { id: "temo", level: "N4", ja: "〜ても", es: "aunque…", en: "even if…", example: "寒くても行きます。",
    match: (pieces, i) => gcSeq(TE, { s: "も" })(pieces, i) && !gcIs(pieces[i + 2], { b: ["いい", "よい", "良い", "かまう", "構う"] }) },

  // Con la forma て
  { id: "te-shimau", level: "N4", ja: "〜てしまう・〜ちゃう", es: "acabar de hacer del todo, sin querer", en: "to finish completely, by accident", example: "宿題をしてしまいました。",
    match: (pieces, i) => gcSeq(TE, { b: "しまう", d: "非自立" })(pieces, i) || gcIs(pieces[i], { b: ["ちゃう", "じゃう"], d: "非自立" }) },
  { id: "te-miru", level: "N4", ja: "〜てみる", es: "probar a hacer…", en: "to try doing…", example: "ケーキを作ってみます。",
    match: gcSeq(TE, { b: "みる", d: "非自立" }) },
  { id: "te-oku", level: "N4", ja: "〜ておく", es: "hacer algo de antemano", en: "to do in advance", example: "切符を買っておきます。",
    match: (pieces, i) => gcSeq(TE, { b: "おく", d: "非自立" })(pieces, i) || gcIs(pieces[i], { b: ["とく", "どく"], d: "非自立" }) },
  { id: "te-aru", level: "N4", ja: "〜てある", es: "estado resultante (alguien lo hizo)", en: "resulting state (someone did it)", example: "窓が開けてあります。",
    match: gcSeq(TE, { b: "ある", d: "非自立" }) },
  { id: "te-morau", level: "N4", ja: "〜てあげる・〜てくれる・〜てもらう", es: "hacer un favor / recibirlo", en: "doing / receiving a favour", example: "教えてもらいました。",
    match: gcSeq(TE, { b: ["あげる", "くれる", "もらう", "いただく", "差し上げる", "やる"], d: "非自立" }) },
  { id: "te-hoshii", level: "N4", ja: "〜てほしい", es: "querer que alguien haga…", en: "to want someone to…", example: "明日来てほしい。",
    match: gcSeq(TE, { b: ["ほしい", "欲しい"] }) },
  { id: "nakute-mo-ii", level: "N4", ja: "〜なくてもいい", es: "no hace falta…", en: "don't have to…", example: "行かなくてもいいです。",
    match: gcSeq({ ...NAI, f: "連用テ接続" }, TE, { s: "も" }, { b: ["いい", "よい", "良い", "かまう", "構う"] }) },
  { id: "nakereba", level: "N4", ja: "〜なければならない・〜なくてはいけない", es: "tener que…", en: "must, have to…", example: "勉強しなければなりません。",
    match: (pieces, i) => gcSeq({ ...NAI, f: "仮定形" }, { s: "ば" }, { b: ["なる", "いける"] })(pieces, i) ||
      gcSeq({ ...NAI, f: "連用テ接続" }, TE, { s: "は" }, { b: ["なる", "いける"] })(pieces, i) },
  { id: "naide", level: "N4", ja: "〜ないで・〜ずに", es: "sin hacer…", en: "without doing…", example: "名前を書かずに出した。",
    match: (pieces, i) => gcSeq({ ...NAI, f: "連用デ接続" }, { s: "で" })(pieces, i) && !gcIs(pieces[i + 2], { b: "くださる" }) ||
      gcSeq({ b: "ぬ", f: "連用ニ接続" }, { s: "に" })(pieces, i) },

  // Experiencia, decisiones, cambios
  { id: "ta-koto-ga-aru", level: "N4", ja: "〜たことがある", es: "haber hecho alguna vez", en: "to have done before", example: "日本に行ったことがあります。",
    match: gcSeq(TA, { b: "こと", d: "非自立" }, { s: ["が", "は", "も"] }, { b: "ある" }) },
  { id: "koto-ga-dekiru", level: "N4", ja: "〜ことができる", es: "poder hacer…", en: "to be able to…", example: "漢字を書くことができます。",
    match: gcSeq({ b: "こと", d: "非自立" }, { s: ["が", "も", "は"] }, { b: "できる" }) },
  { id: "koto-ni-suru", level: "N4", ja: "〜ことにする", es: "decidir hacer…", en: "to decide to…", example: "毎朝走ることにしました。",
    match: gcSeq({ b: "こと", d: "非自立" }, { s: "に" }, { b: "する", p: "動詞" }) },
  { id: "koto-ni-naru", level: "N4", ja: "〜ことになる", es: "quedar decidido que…", en: "it has been decided that…", example: "来月結婚することになりました。",
    match: gcSeq({ b: "こと", d: "非自立" }, { s: "に" }, { b: "なる", p: "動詞" }) },
  { id: "you-ni-naru", level: "N4", ja: "〜ようになる", es: "llegar a (poder) hacer…", en: "to come to (be able to)…", example: "日本語が話せるようになりました。",
    match: gcSeq({ b: "よう", d: "非自立" }, { s: "に" }, { b: "なる" }) },
  { id: "you-ni", level: "N4", ja: "〜ように", es: "para que…", en: "so that…", example: "忘れないようにメモします。",
    match: (pieces, i) => gcSeq({ b: "よう", d: "非自立" }, { s: "に" })(pieces, i) && !gcIs(pieces[i + 2], { b: "なる" }) &&
      (gcIs(pieces[i - 1], { ...VERB, f: "基本形" }) || gcIs(pieces[i - 1], NAI)) },
  { id: "tame-ni", level: "N4", ja: "〜ために", es: "para…, por…", en: "in order to…, for…", example: "日本へ行くために、お金をためます。",
    match: (pieces, i) => gcSeq({ b: ["ため", "為"], p: "名詞" }, { s: "に" })(pieces, i) &&
      (gcIs(pieces[i - 1], { ...VERB, f: "基本形" }) || gcIs(pieces[i - 1], { s: "の", d: "連体化" })) },

  // Suposiciones y lo que se oye
  { id: "sou-looks", level: "N4", ja: "〜そう", es: "por su aspecto: parece que va a…, tiene pinta de…", en: "looks like…", example: "雨が降りそうです。",
    match: gcSeq({ b: "そう", p: "名詞", d: "接尾" }) },
  { id: "sou-hearsay", level: "N4", ja: "〜そうだ", es: "lo que se oye: dicen que…, he oído que…", en: "I hear that…", example: "明日は雨だそうです。",
    match: (pieces, i) => gcIs(pieces[i], { b: "そう", d: "特殊" }) && gcIs(pieces[i - 1], { f: "基本形" }) },
  { id: "you-da", level: "N4", ja: "〜ようだ・〜みたい", es: "parece, como…", en: "seems, like…", example: "風邪をひいたようです。",
    match: (pieces, i) => gcIs(pieces[i], { b: "みたい" }) ||
      gcIs(pieces[i], { b: "よう", d: "非自立" }) && (gcIs(pieces[i + 1], { b: ["だ", "です"] }) || gcIs(pieces[i + 1], { s: "な", f: "体言接続" })) },
  { id: "rashii", level: "N4", ja: "〜らしい", es: "parece ser, por lo visto", en: "apparently, it seems", example: "彼は学生らしい。",
    match: gcSeq({ b: "らしい", p: "助動詞" }) },
  { id: "kamoshirenai", level: "N4", ja: "〜かもしれない", es: "quizá, puede que…", en: "maybe, might…", example: "雨が降るかもしれません。",
    match: gcSeq({ s: "かも", p: "助詞" }, { b: "しれる" }) },
  { id: "hazu", level: "N4", ja: "〜はず", es: "debería, se supone que…", en: "should, is expected to…", example: "彼は来るはずです。",
    match: gcSeq({ b: "はず", d: "非自立" }) },
  { id: "tsumori", level: "N4", ja: "〜つもり", es: "tener intención de…", en: "to intend to…", example: "行くつもりです。",
    match: gcSeq({ b: "つもり", d: "非自立" }) },
  { id: "hou-ga-ii", level: "N4", ja: "〜たほうがいい", es: "es mejor que…, deberías…", en: "you had better…", example: "もう寝たほうがいい。",
    match: (pieces, i) => gcSeq({ b: ["ほう", "方"], d: "非自立" }, { s: "が" }, { b: ["いい", "よい", "良い"] })(pieces, i) &&
      (gcIs(pieces[i - 1], TA) || gcIs(pieces[i - 1], NAI) || gcIs(pieces[i - 1], { s: "だ", p: "助動詞" }) && gcIs(pieces[i - 2], { ...VERB, f: "連用タ接続" })) },

  // Unir y matizar
  { id: "nagara", level: "N4", ja: "〜ながら", es: "mientras…", en: "while…", example: "音楽を聞きながら勉強します。",
    match: gcSeq({ s: "ながら", p: "助詞" }) },
  { id: "noni", level: "N4", ja: "〜のに", es: "aunque…; para…", en: "even though…; in order to…", example: "雨が降っているのに出かけた。",
    match: (pieces, i) => gcIs(pieces[i], { s: "のに", p: "助詞" }) ||
      // 起きているのには慣れた: の + には es «el hecho de», no のに
      gcSeq({ s: "の", p: "名詞", d: "非自立" }, { s: "に" })(pieces, i) && gcIs(pieces[i - 1], { f: "基本形" }) && !gcIs(pieces[i + 2], { s: ["は", "も"] }) },
  { id: "shi", level: "N4", ja: "〜し", es: "y además (dar razones)", en: "and also (listing reasons)", example: "高いし、遠いし、行きません。",
    match: gcSeq({ s: "し", p: "助詞", d: "接続助詞" }) },
  { id: "ka-dou-ka", level: "N4", ja: "〜かどうか", es: "si… o no", en: "whether or not…", example: "行くかどうか分かりません。",
    match: gcSeq({ s: "か", p: "助詞" }, { s: "どうか" }) },
  { id: "sugiru", level: "N4", ja: "〜すぎる", es: "demasiado…", en: "too much…", example: "このケーキは甘すぎます。",
    match: gcSeq({ b: ["すぎる", "過ぎる"], d: "非自立" }) },
  { id: "yasui-nikui", level: "N4", ja: "〜やすい・〜にくい", es: "fácil / difícil de…", en: "easy / hard to…", example: "この本は読みやすい。",
    match: (pieces, i) => gcIs(pieces[i], { b: ["やすい", "にくい", "易い", "難い"], p: "形容詞", d: "非自立" }) && gcIs(pieces[i - 1], { ...VERB, f: "連用形" }) },
  { id: "hajimeru", level: "N4", ja: "〜始める・〜終わる・〜続ける", es: "empezar / terminar / seguir de…", en: "start / finish / keep doing…", example: "書き始めました。",
    match: (pieces, i) => gcIs(pieces[i], { b: ["始める", "はじめる", "終わる", "終える", "続ける", "出す"], p: "動詞", d: "非自立" }) && gcIs(pieces[i - 1], { ...VERB, f: "連用形" }) },
  { id: "bakari", level: "N4", ja: "〜たばかり", es: "acabar de…", en: "to have just…", example: "見たばかりです。",
    match: gcSeq(TA, { s: "ばかり" }) },
  { id: "shika-nai", level: "N4", ja: "〜しか〜ない", es: "solo… (con negación)", en: "only… (with a negative)", example: "百円しかない。",
    match: (pieces, i) => gcIs(pieces[i], { s: "しか", p: "助詞" }) && pieces.slice(i + 1).some((piece) => gcIs(piece, { b: "ない" }) || gcIs(piece, N_)) },
  { id: "to-iu", level: "N4", ja: "〜という", es: "llamado…, que se llama…", en: "called…, named…", example: "これは何という花ですか。",
    match: (pieces, i) => gcIs(pieces[i], { s: "という", p: "助詞" }) || gcSeq({ s: "と", p: "助詞" }, { b: "いう" })(pieces, i) && gcIs(pieces[i + 2], { p: "名詞" }) },
  { id: "to-omou", level: "N4", ja: "〜と思う・〜と言う", es: "creer que…, decir que…", en: "to think that…, to say that…", example: "暑いと思います。",
    match: (pieces, i) => gcSeq({ s: "と", p: "助詞", d: "格助詞" }, { b: ["思う", "言う", "考える"], p: "動詞" })(pieces, i) &&
      !gcIs(pieces[i - 1], { b: ["う", "よう"], p: "助動詞" }) && !gcIs(pieces[i - 1], { p: "名詞", d: ["一般", "固有名詞", "代名詞"] }) },
  { id: "ageru-kureru", level: "N4", ja: "あげる・くれる・もらう", es: "dar y recibir", en: "giving and receiving", example: "友達が本をくれました。",
    match: gcSeq({ b: ["あげる", "くれる", "もらう", "くださる", "差し上げる"], p: "動詞", d: "自立" }) }
];

const GRAMMAR_BY_ID = new Map(GRAMMAR.map((point) => [point.id, point]));

/* Las estructuras de una frase: piezas de kuromoji (tokenizer.tokenize(texto)).
   Devuelve sus ids en el orden del catálogo, sin repetir. */
function detectGrammar(rawPieces) {
  const pieces = rawPieces.map(gcPiece);
  const found = new Set();
  for (const point of GRAMMAR) {
    for (let i = 0; i < pieces.length; i++) {
      if (point.match(pieces, i)) { found.add(point.id); break; }
    }
  }
  return [...found];
}

/* =========================================
   MEDICIÓN: QUÉ ESTRUCTURAS MANEJA
   -----------------------------------------
   A partir de lo que ha hecho con frases que las contienen:
     seen   la frase apareció en un texto que leyó o en un repaso
     clean  leyó la frase sin consultar ninguna de sus palabras
     good   la tradujo bien (Traducir: correct o mostly)
     bad    la tradujo mal (incorrect)
   Estados (los números en STUDY_CONFIG.analysis.grammar):
     mastered    traducciones buenas en al menos masteredDays días distintos
     understood  una traducción buena, o cleanReads lecturas sin consultar
     seen        la ha visto
     unseen      no la ha visto
   Si su última traducción fue mala no cuenta como dominada ni, por las
   traducciones, como entendida (las lecturas sin consultar sí cuentan).
   ========================================= */

/* events  [{ ids: [estructuras], kind: "seen" | "clean" | "good" | "bad", day: "2026-10-22", at: ms }]
   Devuelve Map id -> "mastered" | "understood" | "seen" | "unseen" (de todo el catálogo) */
function grammarStates(events, { cleanReads = 3, masteredDays = 2 } = {}) {
  const tally = new Map(GRAMMAR.map((point) => [point.id, { seen: 0, clean: 0, goodDays: new Set(), lastAt: 0, lastBad: false }]));
  for (const event of events) {
    for (const id of event.ids) {
      const row = tally.get(id);
      if (!row) continue;
      row.seen++;
      if (event.kind === "clean") row.clean++;
      if (event.kind === "good") row.goodDays.add(event.day);
      if ((event.kind === "good" || event.kind === "bad") && (event.at || 0) >= row.lastAt) {
        row.lastAt = event.at || 0;
        row.lastBad = event.kind === "bad";
      }
    }
  }
  const states = new Map();
  for (const [id, row] of tally) {
    const translated = row.goodDays.size > 0 && !row.lastBad;
    states.set(id, translated && row.goodDays.size >= masteredDays ? "mastered"
      : translated || row.clean >= cleanReads ? "understood"
      : row.seen ? "seen" : "unseen");
  }
  return states;
}

/* Por nivel: { N5: { mastered, understood, seen, unseen, total }, … } (solo los niveles del catálogo) */
function grammarBreakdown(states) {
  const out = {};
  for (const point of GRAMMAR) {
    const row = out[point.level] ??= { mastered: 0, understood: 0, seen: 0, unseen: 0, total: 0 };
    row[states.get(point.id) || "unseen"]++;
    row.total++;
  }
  return out;
}

/* Lo que se maneja de un nivel de gramática: dominado y entendido (para estimateLevel) */
const grammarShare = (row) => row.total ? (row.mastered + row.understood) / row.total : 0;

/* Para tools/ y las pruebas (Node); en el navegador son globales */
if (typeof module !== "undefined") {
  module.exports = { GRAMMAR, GRAMMAR_BY_ID, detectGrammar, grammarStates, grammarBreakdown, grammarShare };
}
