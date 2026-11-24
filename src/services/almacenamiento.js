// Estado del almacenamiento del navegador y de la instalación de la app.

/** ¿La app se abrió instalada (pantalla de inicio) y no en una pestaña? */
export function estaInstalada() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true // Safari en iPhone/iPad
  );
}

export function esIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** { soportado, persistente, usado, cuota } — usado y cuota en bytes (o null). */
export async function estadoAlmacenamiento() {
  const s = navigator.storage;
  if (!s) return { soportado: false, persistente: false, usado: null, cuota: null };
  const [persistente, estimacion] = await Promise.all([
    s.persisted ? s.persisted().catch(() => false) : false,
    s.estimate ? s.estimate().catch(() => null) : null,
  ]);
  return {
    soportado: true,
    persistente: Boolean(persistente),
    usado: estimacion?.usage ?? null,
    cuota: estimacion?.quota ?? null,
  };
}

/** Pide al navegador que no borre los datos. Devuelve true si lo concede. */
export async function pedirPersistencia() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 1536000 → "1,5 MB" */
export function formatearBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < unidades.length - 1) {
    v /= 1024;
    i += 1;
  }
  const texto = i === 0 ? String(Math.round(v)) : v.toFixed(1).replace('.', ',');
  return `${texto} ${unidades[i]}`;
}
