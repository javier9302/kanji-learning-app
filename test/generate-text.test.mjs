/* generate-text: el límite de textos al día según el plan (solo la parte que
   no necesita Supabase; el resto de la función se prueba al desplegarla). */
import test from "node:test";
import assert from "node:assert/strict";
import { planLimits } from "../supabase/functions/generate-text/index.ts";

const env = (values) => (name) => values[name];
const NOW = Date.parse("2026-10-21T12:00:00Z");

test("plan gratuito: DAILY_TEXTS (10 por defecto) y su tope de llamadas", () => {
  assert.deepEqual(planLimits(null, env({}), NOW), { plan: "free", texts: 10, hardCap: 30 });
  assert.deepEqual(planLimits({ plan: "free" }, env({ DAILY_TEXTS: "4" }), NOW), { plan: "free", texts: 4, hardCap: 12 });
  assert.deepEqual(planLimits(undefined, env({ DAILY_TEXTS: "4", DAILY_HARD_CAP: "5" }), NOW), { plan: "free", texts: 4, hardCap: 5 });
});

test("plan premium: PREMIUM_DAILY_TEXTS (30 por defecto), mientras no caduque", () => {
  assert.deepEqual(planLimits({ plan: "premium", plan_until: null }, env({}), NOW), { plan: "premium", texts: 30, hardCap: 90 });
  assert.deepEqual(planLimits({ plan: "premium", plan_until: "2026-12-01T00:00:00Z" }, env({ PREMIUM_DAILY_TEXTS: "50" }), NOW).texts, 50);
  // Caducado: vuelve al gratuito
  assert.deepEqual(planLimits({ plan: "premium", plan_until: "2026-10-01T00:00:00Z" }, env({}), NOW), { plan: "free", texts: 10, hardCap: 30 });
  // Un valor desconocido no da premium
  assert.equal(planLimits({ plan: "PREMIUM" }, env({}), NOW).plan, "free");
});
