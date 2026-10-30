/* notify-due: cuándo se avisa de las palabras que tocan (solo la parte que no necesita Supabase) */
import test from "node:test";
import assert from "node:assert/strict";
import { shouldNotify, message, HOURS } from "../supabase/functions/notify-due/index.ts";

const row = (more = {}) => ({ due: 12, min_due: 10, local_hour: 10, local_day: "2026-10-30", last_sent_at: null, last_day: null, last_count: 0, ...more });

test("shouldNotify: con un grupo de palabras que tocan, de día y una vez por grupo", () => {
  assert.equal(shouldNotify(row()), true);
  assert.equal(shouldNotify(row({ due: 9 })), false);                    // aún no es un grupo
  assert.equal(shouldNotify(row({ local_hour: HOURS.from - 1 })), false); // de noche no
  assert.equal(shouldNotify(row({ local_hour: HOURS.to })), false);
  const sent = { last_sent_at: "2026-10-30T01:00:00Z", last_day: "2026-10-30", last_count: 12 };
  assert.equal(shouldNotify(row({ ...sent, due: 15 })), false);          // las mismas de antes, y alguna más
  assert.equal(shouldNotify(row({ ...sent, due: 22 })), true);           // otro grupo de 10
  assert.equal(shouldNotify(row({ ...sent, last_day: "2026-10-29", due: 12 })), true); // otro día
});

test("message: en su idioma, con cuántas tocan; y el de prueba", () => {
  assert.equal(message(23, "es").title, "Tienes 23 palabras para repasar");
  assert.equal(message(23, "en").title, "23 words to review");
  assert.match(message(0, "es", true).title, /funcionan/);
});
