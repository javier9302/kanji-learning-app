/* =========================================
   KANJI LEARNING APP - config.js
   Conexión con Supabase (cuentas y sincronización).
   Los dos valores están en el panel de Supabase:
   Project Settings -> API  (o el botón "Connect" del proyecto).
   - url:     "Project URL"
   - anonKey: clave pública "anon" / "publishable". Puede ir en el
              navegador: los datos los protege Row Level Security.
   NUNCA pongas aquí la clave "service_role" ni una "secret key".
   Mientras sigan los valores de ejemplo, la app funciona sin cuentas.
   ========================================= */

const SUPABASE_CONFIG = {
  url: "https://rilizudwepfmxbwrorxl.supabase.co/rest/v1/",
  anonKey: "sb_publishable_4KPUHe5su_qvJphUvYnhhA_lSY0Rseh",
  // Pon true cuando hayas activado el proveedor Google en Supabase (ver SETUP.md)
  google: true
};
