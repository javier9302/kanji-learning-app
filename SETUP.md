# Puesta en marcha: cuentas, base de datos y publicación

Esta guía cubre lo que hay que hacer a mano una sola vez. Todo usa planes gratuitos.

Mientras `config.js` tenga los valores de ejemplo, la app funciona igual que antes, sin cuentas y guardando todo en el navegador. Las cuentas se activan al rellenar ese archivo.

Los nombres de los menús de Supabase y Cloudflare cambian de vez en cuando; si alguno no coincide, busca el equivalente más parecido.

## 1. Crear el proyecto en Supabase

1. Entra en <https://supabase.com>, crea una cuenta y pulsa **New project**.
2. Elige un nombre, una contraseña para la base de datos (guárdala, aunque la app no la usa) y la región más cercana a tus usuarios.
3. Espera a que el proyecto termine de crearse.

## 2. Crear las tablas

1. En el proyecto, abre **SQL Editor** y pulsa **New query**.
2. Copia el contenido completo de [`supabase/schema.sql`](supabase/schema.sql), pégalo y pulsa **Run**.
3. Comprueba en **Table Editor** que existen estas tablas, todas con RLS activado:
   - `items` y `days` (repaso de kanjis y palabras);
   - `texts`, `text_states`, `user_words`, `reading_sessions` y `profiles` (lectura);
   - `admins` (quién aprueba textos) y `generations` (registro de textos generados con IA);
   - `dictionary` (diccionario general) y `words_to_review` (palabras por revisar).

El archivo se puede volver a ejecutar sin perder datos. **Si ya lo ejecutaste antes de que existiera la lectura, ejecútalo otra vez**: crea las tablas nuevas y deja las anteriores como están. Hasta entonces la app mostrará «Faltan las tablas en Supabase».

## 3. Configurar la autenticación

En **Authentication → URL Configuration**:

- **Site URL**: la dirección pública de la app (la tendrás tras el paso 5), por ejemplo `https://kanji-learning-app.pages.dev/`.
- **Redirect URLs**: añade esa misma dirección y, para probar en tu ordenador, `http://localhost:8000/`.

Los enlaces de los correos de confirmación y de cambio de contraseña solo funcionan si la dirección está en esa lista. Puedes dejar un valor provisional ahora y corregirlo después de publicar.

En **Authentication → Sign In / Providers → Email**, deja activado el proveedor Email. Con «Confirm email» activado (recomendado), la cuenta nueva debe confirmarse desde el correo antes de entrar.

### Correos: límite del plan gratuito

El servicio de correo incluido en Supabase solo envía unos pocos mensajes por hora. Sirve para tus pruebas, pero no para abrir el registro al público. Antes de publicar de verdad, conecta un proveedor SMTP con plan gratuito (por ejemplo Resend o Brevo) en **Authentication → Emails → SMTP Settings**.

### Google (opcional)

1. En Google Cloud Console crea unas credenciales **OAuth client ID** de tipo «Web application». Como «Authorized redirect URI» pon la dirección que muestra Supabase en **Authentication → Sign In / Providers → Google** (termina en `/auth/v1/callback`).
2. Copia el Client ID y el Client Secret en esa misma pantalla de Supabase y activa el proveedor.
3. En `config.js` cambia `google: false` por `google: true`. Aparecerá el botón «Continuar con Google».

## Aprobar textos para compartirlos

Cada texto que un usuario agrega se sube con estado `pending` y solo lo ve él. Para que lo vean todos hay que aprobarlo.

### Con la página de administración

1. Crea tu cuenta en la app, como cualquier usuario.
2. Date permiso de administrador una sola vez, desde **SQL Editor**, con tu correo:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'tu-correo@ejemplo.com';
```

3. Abre `admin.html` en la dirección de la app (por ejemplo `https://javier9302.github.io/kanji-learning-app/admin.html`) e inicia sesión.

La página lista los textos pendientes, deja leer cada uno con su traducción y tiene los botones **Aprobar** y **Rechazar**. Una cuenta sin permiso puede iniciar sesión ahí, pero no ve ningún texto ajeno ni puede cambiar estados: el permiso lo comprueba la base de datos, no la página. Para quitar un administrador, borra su fila de la tabla `admins`.

### Desde el panel de Supabase

- **Desde Table Editor:** abre la tabla `texts`, revisa las columnas `title` y `data` de las filas con `status` = `pending` y cambia `status` a `approved` (o a `rejected`).
- **Desde SQL Editor:**

```sql
-- Ver los pendientes
select id, title, level, topic, created_at from texts
where status = 'pending' and deleted_at is null order by created_at;

-- Aprobar uno
update texts set status = 'approved' where id = 'PEGA-AQUI-EL-ID';
```

Los usuarios no pueden aprobar sus propios textos: un trigger de la base de datos ignora cualquier cambio de `status` que no venga de un administrador o del panel. Un texto aprobado llega a los demás usuarios en su siguiente sincronización, con la etiqueta «De la comunidad».

## Generar textos con IA (Gemini)

El botón «Generar con IA» llama a una función del servidor, `generate-text`, que guarda la clave de la IA. Sin esta función el botón avisa de que no está configurado y sigue funcionando el «Modo manual».

1. **Clave de Gemini.** Entra en <https://aistudio.google.com/apikey>, crea una API key y cópiala.
2. **Tabla de registro.** Ejecuta de nuevo `supabase/schema.sql` (crea la tabla `generations`).
3. **Secretos.** En Supabase, **Edge Functions → Secrets**, añade:

| Secreto | Valor |
|---|---|
| `GEMINI_API_KEYS` | una o varias claves con etiqueta, separadas por comas: `personal=CLAVE1,reserva=CLAVE2` |
| `GEMINI_API_KEY` | alternativa si solo tienes una clave (sin etiqueta) |
| `GEMINI_MODEL` | opcional; por defecto `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | opcional; por defecto `gemini-3.5-flash-lite` |
| `DAILY_TEXTS` | opcional; textos entregados por usuario y día en el plan gratuito, por defecto `10` |
| `PREMIUM_DAILY_TEXTS` | opcional; textos al día en el plan premium, por defecto `30` |
| `PREMIUM_DAILY_HARD_CAP` | opcional; tope de llamadas al día en premium, por defecto el triple |
| `DAILY_HARD_CAP` | opcional; tope de llamadas a la IA por usuario y día, cuenten o no; por defecto el triple de `DAILY_TEXTS` |

4. **Desplegar la función.** En **Edge Functions → Deploy a new function → Via Editor**, ponle el nombre exacto `generate-text`, pega el contenido de [`supabase/functions/generate-text/index.ts`](supabase/functions/generate-text/index.ts) y despliega. Deja activada la verificación de JWT.

   Con la CLI de Supabase, la alternativa es `supabase functions deploy generate-text`.

Cómo funciona:

- Solo responde a usuarios con sesión iniciada.
- Al estudiante solo le cuenta un texto que recibe y puede leer (`DAILY_TEXTS` al día). Si la IA falla o devuelve un texto roto, la app repite la petición hasta dos veces más y esos intentos no cuentan.
- Para que los fallos no gasten tu cuota sin límite, hay un tope de llamadas por usuario y día (`DAILY_HARD_CAP`).
- Un texto solo se rechaza si está roto: no es JSON o los tokens no reconstruyen la oración. Lo demás se arregla y se muestra.
- Las claves se prueban en orden. Si una se queda sin cuota o falla, se pasa a la siguiente; si fallan todas con el modelo principal, se repite con el de reserva.
- La etiqueta de cada clave (lo que va antes del `=`) es lo que queda en el registro, nunca la clave. Escribe las claves solo en los secretos de Supabase: no las pongas en el código ni en el repositorio.
- Cada llamada queda en la tabla `generations` con el modelo y los tokens usados. Para ver el consumo:

```sql
select key_label, model, count(*) as llamadas, sum(prompt_tokens) as entrada,
       sum(output_tokens) as salida, sum((not ok)::int) as fallos
from generations group by key_label, model;

-- Claves que han fallado o se han quedado sin cuota (p. ej. "personal/gemini-3.8-flash:429")
select created_at, attempts from generations
where attempts is not null order by created_at desc limit 20;
```

Para revisar los fallos, con lo que respondió la IA en cada uno:

```sql
select created_at, model, key_label, attempt, error, left(raw, 500) as respuesta
from generations where not ok order by created_at desc limit 20;
```

Si cambias el texto del prompt en `reading.js` (función `renderPrompt`), copia el mismo cambio a la función y vuelve a desplegarla.

## Formato de los textos y análisis del japonés

Desde la versión de prompt `2026-10-09.1-seg`, la IA solo escribe el texto separado en unidades con `|` y la traducción de cada oración:

```json
{"title":"…","title_en":"…","title_es":"…","sentences":[
  {"p":1,"ja":"私|は|毎朝|コーヒー|を|飲みます|。","en":"…","es":"…"}]}
```

La app pone el lema, la lectura y el tipo de cada unidad con **kuromoji**, y los significados con el banco y el diccionario general. La respuesta de la IA ocupa unas diez veces menos que antes.

- kuromoji y su diccionario están en `vendor/kuromoji/` (unos 19 MB). El navegador los descarga la primera vez que se analiza un texto y después los guarda. Hay que subir esa carpeta al repositorio.
- El formato antiguo (con `tokens` y `dictionary`) se sigue aceptando al pegar, y los textos ya guardados no cambian.
- La versión del prompt nuevo es `SEGMENTED_VERSION`, también en `reading.js` y en la función.

## Registros de generación y reportes de error

Cada intento de generar un texto queda en la tabla `generations` con la fecha, el modelo, la versión del prompt (`prompt_version`), los parámetros con que se pidió, la respuesta de la IA y el tipo de resultado (`result`): `ok`, `invalid_json`, `missing_fields`, `tokens_mismatch`, `too_short`, `truncated`, `empty`, `provider` o `quota`.

La tabla `text_reports` guarda lo que la validación del servidor no detecta: lo que la app tuvo que arreglar al recibir el texto (`kind` = `auto`) y lo que alguien marca con el botón **Reportar error** del lector (`kind` = `user`).

En `admin.html`, la pestaña **Registros** muestra los últimos fallos y reportes y tiene el botón **Exportar registros (JSON)**, que descarga todo.

La versión del prompt es la constante `PROMPT_VERSION`, que está en `reading.js` y en la función `generate-text`. Súbela en los dos sitios cada vez que cambies el texto del prompt, y vuelve a desplegar la función.

## Diccionario general y palabras por revisar

Cuando un texto trae una palabra que no está en el banco de la app, el texto se muestra igualmente y la palabra se resuelve así: primero en el diccionario general (tabla `dictionary`) y, si no está, con lo que explicó la IA. Esas palabras quedan anotadas para que las revises.

1. Ejecuta `supabase/schema.sql` (crea las tablas `dictionary` y `words_to_review`).
2. Abre `admin.html`, pestaña **Palabras por revisar**, y pulsa **Importar diccionario**. Sube unas 22.500 palabras comunes de JMdict que no están en el banco; tarda alrededor de un minuto. **Si ya lo importaste con una versión anterior, vuelve a pulsarlo**: corrige significados equivocados (いる salía como «necesitar», なる como «dar fruto») y no toca lo que hayas aprobado.
3. En esa misma pestaña aparecen las palabras por revisar:
   - **Aprobar** la guarda en el diccionario tal como se ve. Desde entonces la app la usa y no vuelve a aparecer en la lista.
   - **Editar** permite corregir lectura y significados antes de aprobar.
   - **Descartar** la quita de la lista sin guardarla.

Cada palabra indica de dónde salió: del diccionario JMdict, solo de la IA, o si la IA la escribió con kanji y la app la pasó a kana (por ejemplo 有りました → ありました).

El mismo diccionario está también en la app (`vendor/jmdict/common-2026-10-20.json`, unos 740 kB comprimido): se descarga la primera vez que hace falta y se guarda para siempre, así que funciona sin sesión y sin conexión. Con sesión, además, se consultan en Supabase las palabras aprobadas por un administrador, que mandan sobre JMdict.

Para regenerarlo con una versión nueva de JMdict: `node tools/build-dictionary.mjs` (descarga JMdict de EDRDG; cambia `VERSION` en el script y la ruta en `reading.js` y `admin.js`). Una palabra escrita en kana se resuelve así: la del banco que casi siempre va en kana (有る → ある), la de JMdict, y solo si en el banco hay una única palabra con esa lectura (いう → 言う), esa; si hay varias no se adivina. Las reglas están en `ja-core.js` y en `tools/lib/jmdict.js`.

Sin sesión no se anotan palabras por revisar.

## Repaso espaciado y palabras nuevas

El repaso usa **FSRS** (`vendor/ts-fsrs`). Todo lo ajustable está en un solo archivo,
[`study-config.js`](study-config.js): palabras nuevas por sesión, los pesos con los que se
elige la siguiente palabra nueva (agregada a mano > vista en lecturas > kanjis conocidos >
frecuencia), las reglas por nivel de kanji (`newWordKanji`), las de Escribir (`writing`) y los parámetros de FSRS.

**Qué palabras nuevas se proponen** lo decide el nivel de sus **kanjis**, no el de la palabra (hay
palabras de N5 con un kanji de N1 y palabras de N3 hechas solo con kanjis de N5). Sale una palabra
si todos sus kanjis son de tu nivel o inferior, o ya los conoces; o si tiene varios kanjis, conoces
al menos uno y la palabra es de tu nivel. Las que agregas a mano no tienen esta limitación. La vista
de depuración enseña las que esperan y qué kanji las bloquea. Reglas en `learning-core.js`.

**Escribir** va nivel a nivel en el modo automático: no salen kanjis de N4 hasta escribir todos los
de N5. Cada `writing.reviewEvery` kanjis sale uno ya escrito para repasarlo. Quien ya sabe escribir
un nivel puede hacer la prueba («¿Ya sabes escribir los de N5?»): unos kanjis al azar de ese nivel,
sin ayuda; si aprueba, el nivel se salta. Los niveles saltados se sincronizan (vuelve a ejecutar
`supabase/schema.sql`). Eligiendo un nivel en el selector se practican sus kanjis sin orden.
Cámbialo, recarga la página y listo.

- Tras actualizar la app hay que volver a ejecutar `supabase/schema.sql` en el SQL Editor:
  añade las columnas `fsrs`, `origin` y `meaning` a `user_words`, y `fsrs` y `seen_at` a
  `user_kanji`. Mientras no existan, la app sigue sincronizando sin esos datos.
- El prompt ahora incluye palabras en kana preferentes: vuelve a desplegar la función
  `generate-text` con el contenido nuevo de `supabase/functions/generate-text/index.ts`.
- `bank/frequency.js` (el puesto de cada palabra del banco) se generó a partir de
  `data/frecuencia_6000.tsv`. Esa lista **no se publica**: la carpeta `data/` está en
  `.gitignore`. En `data/frecuencia_fuera_del_banco.tsv` quedan las palabras de la lista
  que no están en el banco.
- En **Ajustes → Repaso** se cambia el máximo de palabras nuevas y se activa la vista de
  depuración, que muestra en **Repasar** la puntuación de cada palabra nueva y su porqué.

## Diccionario

El buscador de la cabecera busca por escritura, lectura (en kana o en romaji) o significado.

- **Vuelve a ejecutar `supabase/schema.sql`.** Añade la función `search_dictionary` (búsqueda en la
  tabla `dictionary`) y permite el origen `diccionario` en `user_words`. Mientras no lo hagas la app
  sigue funcionando: busca en el diccionario general solo por escritura y lectura, y las palabras
  buscadas se suben como si vinieran de una lectura hasta que la base de datos las admita.
- Sin sesión iniciada solo se busca en el banco de la app; la vista lo dice.
- Abrir la ficha de un resultado anota la consulta. La palabra queda como **no conocida** (no cuenta
  en el porcentaje conocido de los textos ni en la lista de palabras conocidas del prompt) y gana
  prioridad entre las palabras nuevas del repaso. Los pesos están en `study-config.js`:
  `weights.dictionary`, `weights.lookup` y `lookupDecayDays`.
- «Estudiar esta palabra» y «Ya la domino» hacen lo mismo que los botones de **Agregar palabra**.
- El máximo de palabras nuevas por sesión no cambia: buscar muchas palabras no llena el repaso.

## Planes: gratuito y premium

El plan de cada usuario decide cuántos textos con IA puede generar al día (`DAILY_TEXTS` o
`PREMIUM_DAILY_TEXTS`, secretos de `generate-text`).

1. **Vuelve a ejecutar `supabase/schema.sql`** (añade `plan` y `plan_until` a `profiles` y las
   funciones de administración) y **vuelve a desplegar `generate-text`**.
2. En `admin.html`, pestaña **Usuarios**, cambia el plan de cada usuario. Con una fecha, premium
   dura hasta ese día; sin fecha, no caduca. El usuario ve su plan en **Ajustes → Mi perfil** y,
   al crear un texto, cuántos le quedan hoy.

**Análisis del progreso (solo premium):** en **Mis palabras → Análisis** el alumno premium ve lo
que ha demostrado de cada nivel JLPT, su nivel estimado y su evolución semana a semana. Para que la
foto semanal se sincronice entre dispositivos, **vuelve a ejecutar `supabase/schema.sql`** (crea
`progress_snapshots`; los administradores pueden leer las de todos). Sin la tabla, el análisis
funciona igual con las fotos del dispositivo.

Un usuario no puede cambiarse el plan a sí mismo: un trigger de la base de datos lo impide aunque
lo intente sin pasar por la app, y la función lee el plan en el servidor. Todavía no hay pagos:
cuando los haya, una Edge Function con la clave de servicio llamará a `admin_set_plan` desde el
aviso del proveedor de pagos (Stripe o Lemon Squeezy).

## Frases de ejemplo y la presentación «En una frase»

En **Estudiar → Repasar**, con el modo «Escribir la lectura», la opción **Presentación** elige
entre «Palabra sola» (por defecto) y «En una frase»: cada palabra se pregunta resaltada dentro de
una frase en la que el resto ya se conoce. Con «En una frase» también se pueden repasar kanjis: se
resalta el kanji dentro de una palabra de la frase y se pide cómo suena allí (語 en 日本語 → ご),
repartiendo la lectura de la palabra con `bank/readings.js`. Si no hay ninguna frase que valga,
sale la tarjeta de siempre con el aviso «Sin frase disponible». La corrección y el calendario de
repasos no cambian. Sustituye al antiguo ajuste «Repasar con frases»: quien lo tenía activado
empieza en «En una frase».

- **De dónde sale la frase de cada palabra**, en este orden:
  1. Las comunes: `bank/sentences/<nivel>.json` y las **compartidas** (tabla `shared_sentences`,
     que lee cualquiera, también sin sesión).
  2. Las de las **historias**: al guardar un texto (escrito por la IA, de la comunidad o pegado) se
     quedan sus frases de 4 a 20 unidades con todas las palabras resueltas. La que se usa al
     repasar se copia a las compartidas, para todos. Las de un texto pegado nunca se comparten.
  3. Si no hay ninguna, la app la **pide a la IA en segundo plano** (función `generate-sentences`)
     y enseña la palabra sola con «Sin frase disponible». Cada frase de la IA se analiza y se
     comprueba en la app con la misma regla que las demás; las que valen se comparten y salen
     desde la siguiente vez que aparezca la palabra. Una palabra ya pedida no se vuelve a pedir
     en 3 días. Al empezar una sesión se piden de una vez las de todas sus tarjetas sin frase.
- **Para que funcionen las frases compartidas y las de la IA:**
  1. **Vuelve a ejecutar `supabase/schema.sql`**: crea `shared_sentences` y `sentence_generations`
     (el registro de cada llamada a la IA). Sin ellas la app sigue funcionando con las frases
     comunes y las de las historias.
  2. **Despliega la función.** En **Edge Functions → Deploy a new function → Via Editor**, ponle el
     nombre exacto `generate-sentences`, pega el contenido de
     [`supabase/functions/generate-sentences/index.ts`](supabase/functions/generate-sentences/index.ts)
     y despliega. **Deja activada la verificación de JWT** (solo la llaman usuarios con sesión).
  3. **Secretos:** usa las mismas claves de Gemini que `generate-text`; si aquella funciona no hay
     que añadir nada. Opcionales: `SENTENCE_DAILY_WORDS` (palabras con frases nuevas por usuario y
     día, 40 por defecto) y `SENTENCE_DAILY_CALLS` (llamadas al día, 20 por defecto). No gasta la
     cuota de textos del usuario.
- **Revisar las frases compartidas:** `admin.html`, pestaña **Frases**. Al borrar una desaparece de
  todos los dispositivos en su siguiente repaso con frases. Cada usuario puede añadir como mucho
  200 frases compartidas al día.
- El prompt de las frases tiene una sola fuente, `tools/lib/sentence-batches.js`; la función lleva
  una copia. Si lo cambias, ejecuta `node tools/sync-prompt.mjs` y vuelve a desplegar la función
  (`npm test` avisa si las copias no coinciden).
- En **Biblioteca** se puede pegar cualquier texto en japonés tal cual. Se analiza en el
  dispositivo con kuromoji, **no se sube ni se propone a la comunidad** y no tiene traducción.
- **Vuelve a ejecutar `supabase/schema.sql`**: crea la tabla `user_sentences`, donde se guardan las
  frases de los textos que sí se suben y cuántas veces se ha enseñado cada una. Sin la tabla, todo
  sigue funcionando y las frases se quedan en el dispositivo (cada uno las saca de sus textos).
- `bank/readings.js` dice qué lectura de cada kanji ejercita cada palabra del banco. Se genera con
  `node tools/build-readings.mjs` a partir de JmdictFurigana (CC BY-SA, como JMdict); solo hay que
  repetirlo si cambia el banco.
- `node tools/coverage.mjs` informa de cuántas frases comunes hay por cada pareja (kanji, lectura)
  y `node tools/size-report.mjs`, del tamaño de los archivos.
- «Lecturas de kanji practicadas», en Estadísticas, se guarda en cada dispositivo y no se sincroniza.

## Traducir: corrección de traducciones con IA

En **Estudiar → Traducir** el estudiante escribe la traducción de una frase de sus textos. Sin
configurar nada ya funciona: ve la traducción de referencia y se corrige él mismo. Para que
corrija la IA hay que desplegar la función `grade-translation`.

1. **Tabla de registro.** Vuelve a ejecutar `supabase/schema.sql` (crea `translation_grades`).
2. **Desplegar la función.** En **Edge Functions → Deploy a new function → Via Editor**, ponle el
   nombre exacto `grade-translation`, pega el contenido de
   [`supabase/functions/grade-translation/index.ts`](supabase/functions/grade-translation/index.ts)
   y despliega. **Deja activada la verificación de JWT.** Con la CLI:
   `supabase functions deploy grade-translation`.
3. **Secretos.** Usa las mismas claves que `generate-text` (`GEMINI_API_KEYS` o `GEMINI_API_KEY`):
   si aquella ya funciona no hay que añadir nada. Opcionales:

| Secreto | Valor |
|---|---|
| `GRADE_MODEL` | modelo para corregir; por defecto el de `GEMINI_MODEL` o `gemini-3.8-flash` |
| `GRADE_FALLBACK_MODEL` | por defecto el de `GEMINI_FALLBACK_MODEL` o `gemini-3.5-flash-lite` |
| `DAILY_GRADES` | correcciones entregadas por usuario y día; por defecto `30` |
| `DAILY_GRADES_HARD_CAP` | tope de llamadas a la IA por usuario y día, cuenten o no; por defecto el triple |
| `GRADE_CALL_TIMEOUT_MS` | espera máxima por cada llamada a Gemini; por defecto `20000` (si tarda más se prueba otra clave o el modelo de reserva) |
| `GRADE_TIME_BUDGET_MS` | tiempo máximo de toda la corrección; por defecto `50000`. Pasado ese tiempo la app deja que el estudiante se corrija |

Cómo funciona:

- Solo responde a usuarios con sesión. El límite diario es aparte del de los textos generados.
- Al estudiante solo le cuenta una corrección que recibe. Si la IA responde algo que no vale, la
  función se lo vuelve a pedir (hasta tres intentos) y esos fallos no cuentan.
- Antes de llamar a la IA la app ahorra lo que puede: una respuesta vacía o demasiado corta no se
  envía, una que coincide con la traducción de referencia se da por buena, y la misma respuesta a
  la misma frase reutiliza la corrección anterior.
- Si la IA no está disponible (sin sesión, sin conexión, sin cuota, límite alcanzado o función sin
  desplegar), la app lo dice y el estudiante se corrige con la referencia.
- **Privacidad.** A Gemini solo se le envían la frase en japonés, su traducción de referencia, la
  respuesta del estudiante y el idioma; nunca su identificador, su correo ni su progreso. Aun así,
  en el plan gratuito de Gemini **Google puede usar lo enviado para mejorar sus productos**, así
  que conviene avisar a los estudiantes de que no escriban datos personales en la respuesta.
  La tabla `translation_grades` sí guarda quién hizo cada corrección y lo que escribió (hace falta
  para el límite diario y para revisar correcciones dudosas); solo la leen los administradores.
- La versión del prompt es `GRADING_PROMPT_VERSION`, en la propia función. Súbela al cambiar el
  prompt y vuelve a desplegar.

Qué cambia en el progreso (todo ajustable en `study-config.js`, bloque `translate`):

- Traducir demuestra que se entiende el **significado**. No mueve el calendario de repaso de la
  lectura: solo apunta, aparte, aciertos y fallos de significado en cada palabra y kanji.
- Una palabra entendida suma según quién corrige (`credit`): la IA 1 punto; coincidir con la
  referencia, corregirse uno mismo o no estar de acuerdo con la IA, medio punto. Una palabra que el
  estudiante tocó para ver su significado no suma. Cada frase suma una sola vez por palabra.
- Con `promoteAt` puntos seguidos (2: dos frases distintas corregidas por la IA) se da su
  significado por sabido, y una palabra «por confirmar» pasa a dominada. Un fallo la deja en
  «aprendiendo», pone la cuenta a cero, la sube en «Las que más fallas» y le da prioridad entre las
  palabras nuevas del repaso (`weights.meaningFail`).
- El significado de un kanji se da por sabido cuando `kanjiWords` (3) palabras distintas que lo
  llevan se entienden así. Una sola no basta.
- **Vuelve a ejecutar `supabase/schema.sql`** también para esto: añade las columnas `meaning_*` a
  `user_words` y `user_kanji`, el origen `traducir`, las columnas de traducciones de `days` y el
  tipo `grade` de `text_reports`. Mientras falten, el resto del progreso se sigue sincronizando.

«No estoy de acuerdo» (solo en correcciones de la IA que no son «Correcta») deshace la corrección,
cuenta la frase como entendida con menos peso y deja un reporte. En `admin.html`, la pestaña
**Traducciones** enseña los últimos fallos de la función y las correcciones discutidas, y exporta
todo a JSON para revisar el prompt.

Las frases respondidas (almacén `translations`) se quedan en cada dispositivo; lo que se sincroniza
es el progreso de palabras y kanjis y el historial del día.

Calibración (opcional, gasta cuota): `tools/calibrate-grading.mjs` corrige 30 frases con 4 tipos de
respuesta en los dos idiomas (240 llamadas) contra la función ya desplegada y compara el veredicto
esperado con el de la IA. Antes sube `DAILY_GRADES` (por ejemplo a `300`) y después vuelve a
dejarlo. La cuenta se pasa por variables de entorno y no se guarda:

```sh
node tools/calibrate-grading.mjs --dry-run        # no llama a nada
CALIBRATION_EMAIL=tu@correo CALIBRATION_PASSWORD='…' node tools/calibrate-grading.mjs --limit 20
```

Consumo y fallos:

```sql
select model, key_label, result, count(*) as llamadas, sum(prompt_tokens) as entrada,
       sum(output_tokens) as salida, round(avg(latency_ms)) as ms
from translation_grades group by model, key_label, result order by llamadas desc;
```

## Pruebas

Hace falta Node 20 o posterior. La app no usa nada de esto al ejecutarse.

```sh
npm install        # una vez
npm test           # funciones sueltas y supabase/schema.sql en un Postgres en memoria
npm run smoke      # la app en Chrome sin ventana: un repaso, una lectura y el diccionario
```

`npm run smoke` no inicia sesión: la cuenta y la sincronización con Supabase se prueban a mano.

GitHub Actions (`.github/workflows/test.yml`) ejecuta las dos cosas en cada `git push`; el resultado
se ve en la pestaña **Actions** del repositorio. No necesita ningún secreto.

Si cambias el prompt de los textos en `reading.js` (`renderPromptSeg`), cópialo a la función con
`node tools/sync-prompt.mjs` y vuelve a desplegar `generate-text`; una prueba avisa si no coinciden.

Organización del código: los scripts se cargan en el orden de `index.html` y comparten nombres
globales. La lectura está en cuatro archivos: `texts.js` (validar, resolver y guardar textos,
biblioteca), `reading.js` (nivel, crear textos, lector, evaluación), `reading-stats.js` y
`reading-sync.js`. Las reglas sin navegador, que también usan las herramientas y las pruebas, están
en `ja-core.js`, `sentences-core.js` y `translate-core.js`.

## Avisos al administrador por correo (opcional)

Para recibir un correo cada vez que alguien sube un texto que espera aprobación:

1. Crea una cuenta en <https://resend.com> y una API key. Con el remitente de pruebas de Resend solo puedes enviarte correos a ti mismo (al correo de tu cuenta de Resend), que es justo este caso.
2. En **Edge Functions → Secrets** añade `RESEND_API_KEY`, `ADMIN_EMAIL` (tu correo) y `ADMIN_URL` (la dirección de `admin.html`).
3. Despliega la función `notify-admin` igual que la anterior, con el contenido de [`supabase/functions/notify-admin/index.ts`](supabase/functions/notify-admin/index.ts).
4. En **Database → Webhooks → Create a new hook**:
   - tabla `texts`, evento **Insert**;
   - tipo **Supabase Edge Functions**, función `notify-admin`;
   - añade la cabecera de autorización con la clave de servicio que ofrece el propio formulario.

Aunque no configures el correo, en la app verás cuántos textos hay pendientes: el botón de tu perfil dice «Panel de administración (3 pendientes)».

## 4. Rellenar `config.js`

En Supabase abre **Project Settings → API** (o el botón **Connect**) y copia:

| En `config.js` | En Supabase |
|---|---|
| `url` | Project URL, del tipo `https://abcd1234.supabase.co` |
| `anonKey` | la clave pública: «anon public» o «publishable key» |

```js
const SUPABASE_CONFIG = {
  url: "https://abcd1234.supabase.co",
  anonKey: "eyJhbGciOi...",
  google: false
};
```

La clave pública puede estar en el código: los datos los protege Row Level Security. **No copies nunca la clave `service_role` ni una «secret key».**

Guarda el archivo y súbelo al repositorio (`git add config.js`, `git commit`, `git push`).

## 5. Publicar en Cloudflare Pages

1. Sube el repositorio a GitHub si aún no está.
2. En <https://dash.cloudflare.com> ve a **Workers & Pages → Create → Pages → Connect to Git** y elige el repositorio.
3. En la configuración de compilación:
   - **Framework preset**: None
   - **Build command**: vacío
   - **Build output directory**: `/`
4. Pulsa **Save and Deploy**. Al terminar tendrás una dirección `https://<nombre>.pages.dev`.
5. Vuelve al paso 3 y pon esa dirección en **Site URL** y **Redirect URLs**.

Cada `git push` vuelve a publicar la app. El archivo `_headers` del repositorio ya trae las cabeceras necesarias, y Netlify usa ese mismo archivo si prefieres publicarla allí (carpeta de publicación: la raíz, sin comando de compilación).

Se publica todo lo que hay en el repositorio, incluidos este archivo y `supabase/schema.sql`. No contienen nada secreto.

## 6. Probar en tu ordenador

Desde la carpeta del proyecto:

```sh
python3 -m http.server 8000
```

Abre <http://localhost:8000/>. Las cuentas funcionan en local si añadiste esa dirección a Redirect URLs. El modo sin conexión y la instalación solo funcionan en la versión publicada (necesitan HTTPS).

## 7. Probar en el móvil

1. Abre la dirección `pages.dev` en el móvil.
2. Instala la app:
   - **Android (Chrome)**: menú ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio».
   - **iPhone (Safari)**: botón Compartir → «Añadir a pantalla de inicio».
3. Inicia sesión con la misma cuenta que en el ordenador y comprueba que aparecen tus listas y tu progreso.
4. Activa el modo avión y abre la app: debe abrirse y permitir repasar. Al recuperar la conexión, los cambios se suben solos.

## Cómo funciona, en breve

- La app guarda siempre una copia en el navegador y trabaja con ella, por eso funciona sin conexión y sin cuenta.
- Con la sesión iniciada, sube los cambios a Supabase y descarga los de otros dispositivos. Si un mismo elemento cambió en dos sitios, gana el cambio más reciente.
- La primera vez que alguien inicia sesión en un dispositivo, el progreso que ya había en ese navegador se guarda en su cuenta.
- Al cerrar sesión, los datos se quedan en el dispositivo. Si después entra una cuenta distinta, la app avisa y los quita antes de cargar los de esa cuenta.
- De la lectura se sincronizan los textos, el estado de cada texto (leído, descartado), el progreso por palabra, las sesiones y el nivel de lectura.
- Si alguien borra un texto suyo, desaparece para todos. Si quita de su biblioteca un texto de otro usuario, solo se oculta para él.
- Las preferencias de estudio, el furigana, el idioma y la meta diaria son de cada dispositivo y no se sincronizan.

## Límites del plan gratuito de Supabase

- Los proyectos sin actividad durante aproximadamente una semana se pausan; se reactivan desde el panel.
- La base de datos gratuita tiene 500 MB. Un usuario que agregue todas las listas base ocupa unos pocos MB.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| En «Datos» pone que las cuentas no están configuradas | `config.js` sigue con los valores de ejemplo, o no se ha publicado el cambio |
| «Faltan las tablas en Supabase» | No se ejecutó `supabase/schema.sql` (paso 2) |
| El enlace del correo abre una página de error o `localhost` | Falta la dirección en Site URL / Redirect URLs (paso 3) |
| No llega el correo de confirmación | Límite de envíos del plan gratuito, o está en la carpeta de spam |
| «Demasiados intentos» | Límite de peticiones de Supabase; espera unos minutos |
| Tras publicar sigo viendo la versión antigua | Cierra y vuelve a abrir la app; la versión nueva se guarda en la primera carga con conexión |
