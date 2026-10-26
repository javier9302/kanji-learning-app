# Cambios

Lo que cambia para quien usa la app, el más reciente primero. Cada cambio añade aquí su línea en
el mismo commit. El detalle técnico está en el mensaje de cada commit (`git show <commit>`).
Cómo funciona todo hoy: [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).

## 2026-10-26

- **Repasar: nuevo orden de las palabras nuevas.** Primero las que te enseñan una sola cosa nueva:
  un kanji nuevo junto a otros que ya conoces, o una lectura nueva de un kanji conocido (si sabes
  名前, salen 有名 o 午前 antes que palabras con dos kanjis nuevos). También pesan la frecuencia,
  cuánto vocabulario abre el kanji nuevo y completar las lecturas que le faltan a un kanji. No
  salen seguidas varias con el mismo kanji nuevo. La primera vez que sale una, con la respuesta,
  ves por qué. La vista de depuración (Ajustes → Repaso) enseña las 100 primeras con cada componente.

- **Repasar → Escribir la lectura (Palabra sola)**: una casilla por kanji, con el kana ya escrito
  (前置き → [まえ][お]き). Así se sabe qué kanji fallaste: la lectura buena sale debajo de cada
  casilla fallada y lo que aciertas de cada lectura se ve en la ficha del kanji (Mis palabras →
  Kanjis). Se puede volver a una sola casilla en Ajustes → Repaso. Para sincronizarlo, vuelve a
  ejecutar `schema.sql` (`853501b`).

- **Mis palabras → Kanjis** (solo premium): la tabla de todos los kanjis, por nivel JLPT, grado
  escolar o importancia, con cada uno dominado, parcial o sin conocer según las palabras que
  conoces. Al tocar uno ves sus significados, qué lecturas has visto y cuáles te faltan, tus
  palabras con él y las siguientes que te enseñarían lo que falta (`0eaf732`).

- **Ajustes → Tus datos → Descargar mis datos**: guarda todo tu progreso en un archivo (palabras y
  kanjis con lo que has demostrado de cada uno, gramática, nivel estimado, lecturas, traducciones e
  historial semanal) con una guía de lo que significa cada dato, para adjuntarlo en un chat con
  Claude y pedirle que analice tu progreso. Para todos, sin premium (`62d1db4`).

## 2026-10-24

- **Escribir con repaso espaciado**: cada kanji vuelve cuando toca repasarlo, en lugar de ir por la
  lista del nivel de principio a fin. Como kanjis nuevos (hasta 10 al día) salen primero los que ya
  has visto en tus palabras y, de vez en cuando, uno de tu nivel para completarlo. Se valora mejor:
  el primer fallo no cuenta, una pista o fallos de más lo dejan en «Difícil» y «Mostrar» en «Otra
  vez», y al terminar ves cuándo vuelve. Lo que ya sabías escribir pasa a repaso. Para
  sincronizarlo, vuelve a ejecutar `schema.sql`.
- Análisis, fase 4 publicada (`fc97bdd`).

## 2026-10-22

- **Análisis → Tu semana** (solo premium): un resumen breve escrito por la IA con tus números de la
  semana: qué fue bien, qué toca ahora y una acción concreta. Uno por semana.
- **admin.html → Progreso** (vista del profesor): la foto semanal de cada estudiante, su nivel
  estimado, cómo cambió desde la semana anterior, el foco de su hoja de ruta, su evolución y su
  resumen. Requiere volver a ejecutar `schema.sql` y desplegar `summarize-progress`.
- Arreglo: al cambiar de cuenta en un dispositivo, las fotos semanales de la cuenta anterior ya no
  pasan a la nueva.
- Análisis, fase 3 (hoja de ruta) publicada (`54961f8`).

- **Análisis → Tu hoja de ruta** (solo premium): las metas de la semana. Cuántas palabras, kanjis
  y estructuras te faltan para completar cada nivel, y cuáles van ahora. Si tus textos te cuestan
  o estudias pocos días, también te lo dice. Sus palabras salen antes en tu repaso y sus
  estructuras se usan en los textos que creas con IA (esto último, cuando se vuelva a desplegar
  `generate-text`).
- Análisis, fase 2 publicada (`6a3e088`).

- **Análisis → Gramática** (solo premium): 56 estructuras de N5 (partículas, です/ます y sus
  formas, forma て, 〜たい, 〜から…). La app las detecta en lo que lees, repasas y traduces, y te
  dice cuáles has visto, entendido o dominado, con un ejemplo de cada una y tu nivel de gramática.
  La foto semanal y la tabla de evolución incluyen la gramática.
- Análisis, fase 1 publicada (`bd3f338`).

- **Mis palabras → Análisis** (solo premium): cuántas palabras y kanjis de cada nivel JLPT has
  demostrado (dominadas, aprendiendo, dadas por sabidas), tu nivel estimado en vocabulario y
  kanjis, tu lectura y constancia, y una foto semanal para ver cómo avanzas. Las fotos se guardan
  para todos desde ya. Requiere volver a ejecutar `schema.sql` para sincronizarlas. Los colores de
  los gráficos de estados se ajustaron para distinguirse mejor, también con daltonismo.

## 2026-10-21

- **Frases comunes de N5** publicadas: 132 frases con traducción en `bank/sentences/n5.json`
  (122 de las 520 palabras de N5 con kanji tienen ya sus 2 frases). Esas palabras ya no necesitan la IA.
- **Frases que faltan** (`4e63674`): al repasar «En una frase» se busca primero en las frases
  comunes (las del banco y las nuevas compartidas), después en las de tus historias, y la que se
  usa se comparte con todos. Si no hay ninguna, la IA (Gemini) la crea en segundo plano y sale
  desde la siguiente vez. Pestaña **Frases** en admin.html para borrar las malas. Requiere volver
  a ejecutar `schema.sql` y desplegar la función `generate-sentences` (ver SETUP.md).
- **Repasar → Presentación** (`352dd98`): nueva opción «Palabra sola» / «En una frase» en
  «¿Qué vamos a estudiar?», solo con «Escribir la lectura». En una frase se escribe la lectura de la
  parte resaltada; con «Kanjis» se resalta solo el kanji dentro de una palabra (語 en 日本語 → ご).
  Desaparece el ajuste «Repasar con frases» de Ajustes (quien lo tenía activado empieza en «En una
  frase»). El resaltado ya no tiene fondo: color y subrayado grueso.
- **Palabras nuevas según el nivel de sus kanjis** (`7d49897`): ya no se elige por el nivel de la
  palabra sino por el de sus kanjis; se busca en todo el banco. Escribir pasa a ir nivel a nivel,
  con repaso cada 5 kanjis y una prueba para saltarse un nivel.
- **Frases comunes**: la comprobación acepta el 94 % de las frases de IA (antes el 84 %),
  reconociendo escrituras alternativas (終わる = 終る) (`1d1b558`). Herramienta para generarlas por
  tandas sin API de pago (`e94b749`).
- **Plan premium** (`73df258`): 10 textos de IA al día en el plan gratuito y 30 en premium. El plan
  se ve en Mi perfil y se cambia desde admin.html (pestaña Usuarios). Aún sin pagos.
- **Robustez** (`c86841d`): al recargar en mitad de un texto se vuelve a él; aviso de que Safari
  puede borrar los datos sin cuenta; las traducciones respondidas se sincronizan entre dispositivos.
- **Límites contra el abuso** en la base de datos (`8bd18be`): tamaño máximo y filas al día por usuario.
- **Homógrafos** (`f0e201e`): una misma escritura puede ser dos palabras en un texto (角 かど / つの);
  el furigana y el significado son siempre de la misma palabra.
- **Significados de palabras en kana** corregidos (いる ya no es 要る) y diccionario general
  disponible sin sesión y sin conexión (`9839908`).
- El diccionario de kuromoji (17 MB) se descarga una sola vez por dispositivo (`111aab5`).
- Arreglos menores, organización del código y pruebas automáticas en cada push (`a48a608`, `6eabe7b`).

## 2026-10-14

- Traducir: tiempo máximo por corrección con IA e informe de calibración.

## 2026-10-12

- **Traducir**, sección nueva: traducir frases de los textos, con corrección por IA o por uno
  mismo, progreso del significado y pestaña Traducciones en admin.html.

## 2026-10-11

- **Diccionario**: buscador en la cabecera, ficha de cada resultado, y buscar una palabra hace que
  salga antes en el repaso.
- **Frases de ejemplo**: se sacan de los textos del usuario; se puede pegar cualquier texto en
  japonés; repasar palabras dentro de una frase; estadística «Lecturas de kanji practicadas».

## 2026-10-09

- La app se puede instalar (web app con manifest) y nuevo sistema de repetición espaciada.

## 2026-10-02 a 2026-10-08

- Primeras versiones: listas JLPT, práctica de escritura, cuentas y sincronización con Supabase,
  panel de administración, lectura por palabras, evaluación inicial y textos creados con Gemini.
