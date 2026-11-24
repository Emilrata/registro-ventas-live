# Registro de Ventas LIVE

PWA local para registrar pedidos de transmisiones de TikTok LIVE. Funciona sin internet; cada dispositivo guarda sus propios datos (IndexedDB). Detalles y reglas del proyecto en [CLAUDE.md](CLAUDE.md).

## Comandos

```bash
npm install        # instalar dependencias (Node 20.19 o superior; recomendado 22)
npm run dev        # desarrollo en http://localhost:5173 (sin Service Worker)
npm test           # pruebas (Vitest)
npm run build      # compilar a dist/ (con Service Worker)
npm run preview    # probar la versión compilada en http://localhost:4173
```

Los íconos de `public/icons` ya están generados. Para cambiarlos:
`npm install --no-save sharp && node scripts/generar-iconos.mjs`.

## Despliegue en Cloudflare Pages (gratis)

1. En Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** y elegir este repositorio.
2. Configuración de compilación:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Variable de entorno: `NODE_VERSION` = `22`
3. **Production branch**: `main` (lo que llega a `main` es lo que usan los negocios).
   Las demás ramas (por ejemplo `pruebas`) generan una dirección de vista previa propia para probar antes.
4. `public/_headers` ya configura que `sw.js`, `index.html` y el manifiesto no queden en caché, para que las actualizaciones lleguen.

## Licencias (códigos de activación)

Cada negocio necesita un código de activación firmado. La app lo verifica sin internet con la clave **pública**
(`src/core/licencia-clave-publica.js`). Los códigos se crean con la clave **privada** (`clave-privada-licencias.json`),
que **nunca** se sube al repositorio. Guárdala en dos lugares seguros: si se pierde, no podrás emitir más códigos
(habría que cambiar la clave y volver a activar todos los negocios).

Dos formas de emitir un código:

- **Sin instalar nada:** abre `herramientas/emisor-licencias.html` con doble clic, carga la clave privada,
  escribe el nombre del negocio y copia el código.
- **Con Node:** `node scripts/emitir-licencia.mjs --clave clave-privada-licencias.json --negocio "Boutique Ana" [--vence 2027-12-31]`

## Acceso

- Al abrir la app siempre se pide el PIN de 6 dígitos. 5 errores → espera de 30 s (se duplica en cada nueva serie).
- «Olvidé mi PIN» usa el código de recuperación de 12 caracteres; el código usado deja de servir y se entrega uno nuevo.
- Bloqueo automático tras inactividad (5 min por defecto, configurable en Más) y botón de candado arriba.
- En iPhone/iPad la app exige instalarse en la pantalla de inicio antes de configurarse
  (Safari guarda aparte los datos de la pestaña y los de la app instalada).

## Actualizaciones

La app no se actualiza sola en medio del trabajo: cuando hay versión nueva aparece el aviso **«Hay una versión nueva de la app» → Actualizar**.

## Estructura

```
src/core/          db (esquema Dexie + copia antes de migrar), money, dates, validation, events
src/repositories/  único acceso a IndexedDB
src/services/      reglas del negocio
src/modules/       pantallas
src/ui/            router, componentes, instalación, actualización
src/styles/        colores (claro/oscuro) y componentes
tests/unit/        pruebas
```
