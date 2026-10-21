# Cambios

Lo que cambia para quien usa la app, el más reciente primero. Cada cambio añade aquí su línea en
el mismo commit. El detalle técnico está en el mensaje de cada commit (`git show <commit>`).
Cómo funciona todo hoy: [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).

## 2026-10-21

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
