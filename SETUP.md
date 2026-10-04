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
   - `texts`, `text_states`, `user_words`, `reading_sessions` y `profiles` (lectura).

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
