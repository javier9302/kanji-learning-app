/* =========================================
   KANJI LEARNING APP - today.js
   Estudiar → Hoy: la pantalla de inicio. Junta lo del día en una lista que
   sale de lo que toca repasar (reglas en learning-core.js, planToday):
     1. un texto con las palabras que tocan (leerlo las repasa);
     2. Repasar lo que siga tocando y las nuevas;
     3. unos kanjis que escribir (de los que ya ha visto);
     4. unas frases que traducir (con las que tocan).
   No guarda nada propio: lo hecho se deduce de lo de hoy (lecturas terminadas,
   respuestas del día, kanjis escritos, traducciones). Se carga después de
   kanji-table.js; usa funciones de reading.js, study.js y translate.js.
   ========================================= */

const isToday = (ms, day = today()) => !!ms && isoDate(new Date(ms)) === day;

/* Lo que hace falta para planToday, con lo que ya está en memoria */
async function todayState() {
  await ensureStudyBank().catch(() => {});
  await ensureSentences(BANK.LEVELS.slice(0, BANK.LEVELS.indexOf(userLevel()) + 1)).catch(() => {});
  const day = today();
  const sessions = await getAll("sessions");
  // El texto: el suyo a medias, si no el recomendado (el que tiene más palabras que tocan) o, con cuenta, uno nuevo
  const pending = pendingOwnText() || nextText()?.text || null;
  const due = dueWordIds(day);
  const story = pending ? { kind: "text", text: pending, due: Object.keys(pending.lemmas).filter((key) => due.has(key)).length }
    : sb && sync.user ? { kind: "create", due: 0 } : { kind: "none", due: 0 };
  const cards = studyCards();
  const draw = pickDrawKanji();
  return {
    placed: !!meta.reading.placedAt,
    story,
    read: sessions.some((s) => !s.discarded && isToday(s.finishedAt, day)),
    due: cards.due.length, fresh: Math.min(cards.fresh.length, maxNewCards()),
    answered: meta.days[day]?.r || 0, goal: Math.max(1, Number(prefs.goal) || 20),
    writing: {
      available: !!draw && draw.kind !== "extra",
      done: [...userKanji.values()].filter((rec) => isToday(rec.lastWrittenAt, day)).length
    },
    sentences: {
      available: !!nextTranslationSentence(),
      done: translationLog.filter((entry) => entry.source !== "skip" && isToday(entry.at, day)).length
    },
    proof: (() => {
      const next = proofStatus().next;
      return next ? { level: next.level, pending: next.pending.length, doneToday: meta.kanjiProof?.lastDay === day } : null;
    })()
  };
}

/* Un paso: [título, explicación, botón] */
function todayStepText(step, state) {
  switch (step.kind) {
    case "placement": return [t("Haz la evaluación inicial"),
      t("Unas preguntas para saber tu nivel. Con ella la app sabe qué palabras darte."), t("Empezar")];
    case "story": {
      if (step.done) return [t("Texto leído"), t("Leer un texto ha repasado las palabras que tocaban y salían en él."), t("Leer otro")];
      if (state.story.kind === "create") return [t("Lee un texto con tus palabras"),
        t("Crea uno con IA: llevará las palabras que te toca repasar, y leerlo cuenta como repaso."), t("Crear texto")];
      return [t("Lee «{title}»", { title: state.story.text.title }), step.due
        ? t("Salen {n} que te toca repasar: si no las tocas, cuentan como repasadas.", { n: plural(step.due, "palabra", "palabras") })
        : t("Un texto a tu nivel para seguir leyendo."), t("Leer")];
    }
    case "reviews": return [t("Repasa"), step.due
      ? t("{due} y, después, hasta {fresh}.", { due: plural(step.due, "repaso pendiente", "repasos pendientes"), fresh: plural(step.fresh, "palabra nueva", "palabras nuevas") })
      : step.done ? t("No te queda nada por repasar ahora.") : t("Nada pendiente: aprende hasta {fresh}.", { fresh: plural(step.fresh, "palabra nueva", "palabras nuevas") }),
      t("Empezar")];
    case "writing": return [t("Escribe {n} kanjis", { n: step.count }),
      t("De los que ya has visto en tus palabras, de simple a complejo. Llevas {done}.", { done: step.progress }), t("Escribir")];
    case "proof": return [step.done ? t("Kanjis demostrados hoy") : t("Demuestra tus kanjis de {level}", { level: step.level }),
      t("{n} de {level} que ya has visto en tus palabras: su significado y cómo suenan en una palabra que conoces.", { n: plural(step.count, "kanji", "kanjis"), level: step.level }),
      step.done ? t("Otra prueba") : t("Empezar")];
    case "sentences": return [t("Traduce {n} frases", { n: step.count }),
      t("Con las palabras que te toca repasar. Llevas {done}.", { done: step.progress }), t("Traducir")];
    default: return ["", "", ""];
  }
}

async function renderToday() {
  const area = $("todayArea");
  if (!area.innerHTML) area.innerHTML = `<p class="message">${t("Calculando…")}</p>`;
  const state = await todayState();
  if (document.body.dataset.view !== "today") return;
  const plan = planToday(state, STUDY_CONFIG.today);
  todayLast = state;
  const finished = !plan.next;
  area.innerHTML = `
    <p class="helper">${escapeHTML(t("Hoy llevas {done} de {goal} respuestas en Repasar.", { done: state.answered, goal: state.goal }))}</p>
    ${finished ? `<div class="panel today-done"><h3>${t("¡Has terminado lo de hoy!")}</h3>
      <p class="helper">${t("Puedes seguir con cualquier sección; mañana habrá un plan nuevo.")}</p></div>` : ""}
    <ol class="today-steps">${plan.steps.map((step) => {
      const [title, body, action] = todayStepText(step, state);
      const next = step.kind === plan.next;
      return `<li class="today-step${step.done ? " today-step-done" : ""}${next ? " today-next" : ""}">
        <span class="today-mark" aria-hidden="true">${step.done ? "✓" : ""}</span>
        <div class="today-body">
          <strong>${escapeHTML(title)}</strong>
          <span class="helper">${escapeHTML(body)}</span>
        </div>
        <button class="button ${next ? "button-primary" : "button-outline"}" type="button" data-today="${step.kind}">${escapeHTML(action)}</button>
      </li>`;
    }).join("")}</ol>`;
}

let todayLast = null; // lo último que se calculó, para saber qué texto abrir

/* Cada paso abre su sección; Repasar empieza la sesión directamente */
function startTodayStep(kind) {
  if (kind === "story" && todayLast?.story.kind === "text") return openText(todayLast.story.text.id);
  if (kind === "placement" || kind === "story") return switchView("read");
  if (kind === "reviews") {
    switchView("study");
    return startSession();
  }
  if (kind === "writing") return switchView("draw");
  if (kind === "sentences") return switchView("translate");
  if (kind === "proof") return startProof();
}

function bindToday() {
  $("todayArea").addEventListener("click", (event) => {
    const button = event.target.closest("[data-today]");
    if (button) startTodayStep(button.dataset.today);
  });
}

/* ¿Quedó un texto a medias al recargar? Entonces se abre Leer en lugar de Hoy */
function readingInProgress() {
  const saved = savedReader();
  return !!saved.textId && !saved.closed && texts.some((text) => text.id === saved.textId && !text.readAt);
}
