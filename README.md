# kanji-learning-app

Web app para estudiar japonés: kanjis, vocabulario, lectura y traducción. Cómo funciona cada
parte: [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md). Configuración para el administrador:
[SETUP.md](SETUP.md). Cambios: [CHANGELOG.md](CHANGELOG.md).

## Exportar el progreso e importar una lista de palabras

En **Ajustes → Tus datos** hay dos botones pensados para que otra persona o una IA (Claude, en un
chat) analice el progreso y elija las siguientes palabras en lugar del orden de la app.

### Cómo se usa con Claude

1. **Descargar mis datos** guarda `progreso-japones-<fecha>.json`.
2. Adjunta el archivo en un chat con Claude y pídele, por ejemplo:

   > Este es mi progreso en mi app de japonés. El archivo trae una guía de sus campos
   > (`guide`) y, en `guide.howToCurate`, el formato de respuesta. Analiza qué sé y qué me
   > falta, y dame las siguientes 50 palabras que debería aprender, en orden, en ese formato
   > JSON.

3. Copia el JSON que te dé, pulsa **Importar lista** y pégalo (o guárdalo en un archivo y elígelo).
   La app dice cuántas importó y cuáles no valen y por qué.
4. Esas palabras salen **primero** entre las nuevas de Repasar, en ese orden, antes que todo lo
   demás (también antes que las agregadas a mano) y aunque lleven kanjis de un nivel superior.
   Cada una sale de la lista al empezar a estudiarla o al darla por dominada; cuando se acaban,
   vuelve el orden de siempre. **Quitar la lista** la borra antes. La lista se guarda en el
   dispositivo (no se sincroniza).

### El archivo exportado (versión 2)

Un objeto JSON. Los campos de arriba abajo:

| Campo | Qué lleva |
|---|---|
| `app`, `version`, `exportedAt` | `"kanji-learning-app"`, `2` y la fecha de la exportación |
| `guide` | Qué significa cada campo, en inglés (para la IA), e `howToCurate`: cómo contestar con una lista |
| `totals` | Palabras y kanjis del usuario por estado |
| `profile` | El análisis: por nivel JLPT y estado (vocabulario, kanjis, gramática), nivel estimado, lectura (textos, cobertura, consultas) y constancia (30 días) |
| `grammar` | Cada estructura de N5 con su estado (`mastered`, `understood`, `seen`, `unseen`) |
| `roadmap` | La hoja de ruta de la semana (premium) |
| `days`, `snapshots` | Historial diario (`r` repasos, `c` aciertos, `n` nuevas, `t` traducciones, `tc` buenas) y una foto por semana |
| `readingSessions`, `translations` | Textos leídos y traducciones hechas, lo más reciente primero |
| `kanjiReadings` | Lo que sabe de cada kanji por sus palabras: `state` (`mastered` / `partial`), `meaningKnown`, `knownReadings`, `missingReadings`, `knownWords` y `typed` (aciertos y fallos de cada lectura en su casilla) |
| `recentWords` | Las 40 palabras empezadas más recientemente (`id`, significado, `firstSeen`) |
| `topicProfile` | De momento `null` (los temas llegan en la fase D) |
| `nextWords` | Las 100 siguientes palabras nuevas según la app: `position`, `id`, significado, nivel, `score`, `parts` (cada componente del orden: `frequency`, `bridge`, `unlock`, `coverage`, `topic`), `why` y `queued` |
| `queue` | La lista importada que queda, si hay: `note`, `importedAt`, `total`, `remaining` (ids) |
| `words` | Una fila por palabra del usuario: escritura, lectura, significado, nivel, estado, aciertos, fallos, racha, vista o consultada al leer, `firstSeen`, `lastReviewed`, `nextReview` y su tarjeta FSRS resumida |
| `kanji` | Una fila por kanji del usuario: significado, nivel, estado, si sabe su significado o escribirlo y sus tarjetas FSRS |

Los identificadores de palabra son `escritura|lectura` con la lectura en hiragana: `有名|ゆうめい`.

### La lista para importar

```json
{
  "format": "kanji-app-queue",
  "version": 1,
  "note": "vocabulario de la escuela, una cosa nueva cada vez",
  "words": ["有名|ゆうめい", "前置き|まえおき", "教室", { "w": "角", "r": "かど" }]
}
```

- `words`, en el orden en que se deben aprender. Cada elemento puede ser un id (`"有名|ゆうめい"`),
  solo la escritura (`"教室"`) o un objeto `{ "w": escritura, "r": lectura }` (también `{ "id": … }`).
- `note` es opcional (hasta 300 caracteres); `format` y `version` también, pero conviene ponerlos.
- También se acepta una lista sin más (`["有名", "教室"]`) o texto con una palabra por línea
  (con o sin numeración: `1. 有名`).
- Solo valen palabras con kanji de la lista de la app (las de JLPT N5–N1). La app informa de:
  las que no están en ella; las que tienen varias lecturas y no dicen cuál (`角` → `角|かど` o
  `角|つの`); las que ya sabes o estás estudiando; las que casi siempre van en kana (no se
  repasan); y las repetidas. Si ninguna vale, no cambia nada.
