# Registro de Ventas LIVE — Contexto del proyecto

PWA local para registrar pedidos de transmisiones de TikTok LIVE (pedidos por WhatsApp). Se venderá a varios negocios como producto instalable (NO es SaaS): una sola publicación, cada negocio la instala y cada dispositivo guarda sus propios datos.

Documento completo: https://claude.ai/artifact/HpqMWuy2pWdU7XaY5eWo7B
Maquetas aprobadas: https://claude.ai/artifact/5RZLpBW5HWAiNjSGxpHmk6

## Reglas que nunca se rompen
1. No crear catálogo ni inventario de productos. Las fotos pertenecen a pedidos concretos.
2. Nunca borrar fotos, pagos ni historial (al entregar, cancelar o agrupar).
3. No confundir ventas generadas con dinero cobrado.
4. Estado de pago independiente del estado del pedido.
5. Agrupar pedidos no altera códigos, fechas, fotos, pagos ni plazos.
6. Códigos únicos, automáticos y no editables.
7. No prometer sincronización entre dispositivos ni notificaciones en segundo plano.
8. Sin servicios de pago ni suscripciones. Costo Bs 0.
9. Integridad de datos por encima de la velocidad de desarrollo.

## Stack
- HTML, CSS y JavaScript con módulos ES, sin framework.
- Vite + vite-plugin-pwa (Workbox) para Service Worker y manifiesto.
- IndexedDB con Dexie.js.
- Fotos comprimidas con Canvas y guardadas como Blob.
- ZIP: fflate o client-zip (generado por partes). Excel: SheetJS. Gráficos: Chart.js.
- Pruebas: Vitest.
- Hosting: Cloudflare Pages conectado a GitHub; rama de pruebas y rama de producción.

## Integridad
- Dinero en centavos enteros (Bs 80,50 = 8050).
- Pagos y devoluciones solo se agregan; los errores se corrigen con un registro de anulación.
- Operaciones de varias tablas en una sola transacción.
- Totales recalculados y guardados en el pedido en cada cambio.
- Todo cambio importante va a `historial` con fecha, antes, después y `actor`.
- Cada cambio de esquema tiene número de versión, migración probada y respaldo automático previo.

## Arquitectura
Pantallas (modules/) → Servicios (services/, reglas del negocio) → Repositorios (repositories/, único acceso a IndexedDB) → IndexedDB.
`archivos.repo.js` no tiene función de borrado.

## Tablas (12)
clientes, pedidos, prendas, archivos, pagos, devoluciones, grupos, entregas, historial, ajustes, respaldos, transmisiones.
- clientes: nombre, nombreNormalizado, whatsapp (único, formato +591…), creadoEn, notas.
- pedidos: codigo (único), seq, clienteId, transmisionId, creadoEn, fechaLimite, estado, modalidad, totalPrendas, envio, total, pagado, reembolsado, estadoPago (calculado), grupoId, observaciones, cancelacion {fecha, motivo, actor}.
- prendas: pedidoId, orden, descripcion, talla, color, extra, precio, cantidad, subtotal, fotoId.
- archivos: tipo (foto/comprobante), mime, bytes, ancho, alto, blob, miniatura, sha256, refTipo, refId, creadoEn.
- pagos: pedidoId, monto, metodo (efectivo/QR), fechaHora, comprobanteId, anulaA, nota, actor.
- devoluciones: pedidoId, monto, metodo, fechaHora, motivo, observaciones, excepcion, comprobanteId, actor.
- grupos: clienteId, creadoEn, estado, notas.
- entregas: pedidoId o grupoId, modalidad, destinatario, telefono, ciudad, direccion, transportista, costoEnvio, fechaDespacho, seguimiento, entregadoEn.
- historial: entidad, entidadId, tipo, antes, despues, fechaHora, actor.
- ajustes: clave/valor (plazos, avisos, políticas, contador de códigos, seguridad, licencia, marca del negocio, último respaldo).
- respaldos: fecha, tipo, tamaño, nombre, rango.
- transmisiones: nombre, fecha, notas.

## Decisiones confirmadas (todo entra en la primera versión)
- Fotos: 1280 px lado mayor, calidad 75 %, miniatura ~240 px, SHA-256. Respaldo diario de datos y semanal solo con fotos nuevas. Archivo de fotos antiguas disponible pero desactivado por defecto.
- Envío en grupo: un costo por entrega del grupo, guardado en la entrega.
- Pago de un grupo: se reparte del pedido más antiguo al más nuevo, un registro de pago por pedido.
- Vencido: calculado por fecha límite (30 días por defecto, avisos días 25 y 28). Recoger vencido permitido y registrado.
- Cancelaciones: restan del día original en ventas activas y se muestran aparte como cancelaciones del período.
- Pago de más: bloqueado.
- Duplicados: aviso sin bloqueo si la misma clienta tiene un pedido con el mismo total en los últimos 10 minutos.
- Código: LIVE-00001, continuo, sin reinicio, generado dentro de la transacción del pedido.
- WhatsApp: Bolivia por defecto (+591, 8 dígitos que empiezan con 6 o 7), con opción de otro código de país.
- Licencia: código de activación por negocio, firmado y verificado sin internet.
- Marca por negocio: nombre, logo y WhatsApp en la primera configuración.
- Respaldo: ZIP con datos.json, fotos/, comprobantes/ y manifiesto con versión y SHA-256. Restauración verifica antes y reemplaza todo. Contraseña opcional (AES-GCM). Aviso si no hay respaldo en 24 h.
- Almacenamiento: pedir navigator.storage.persist() y exigir instalación en pantalla de inicio (sobre todo iPhone); mostrar espacio usado.

## Seguridad
- PIN de 6 dígitos guardado como hash PBKDF2-SHA256 (sal de 16 bytes, ~300.000 iteraciones, WebCrypto). Protege el acceso, no cifra los datos.
- 5 intentos fallidos → espera de 30 s, que se duplica en cada nueva serie.
- Bloqueo automático tras 5 min sin uso (configurable) y botón de cierre.
- Huella/Face ID con WebAuthn (autenticador del dispositivo, verificación de usuario obligatoria); oculto si no hay soporte.
- Código de recuperación de 12 caracteres mostrado una vez (se guarda solo su hash). Último recurso: reinstalar y restaurar respaldo, pidiendo un PIN nuevo.

## Diseño
Negro y blanco elegante, modo claro y oscuro. Títulos en Instrument Serif, texto en Inter, números tabulares. Rojo solo para lo urgente (vencidos, respaldo atrasado). Tarjetas compactas, botones de 44 px mínimo, navegación inferior: Panel, Pedidos, Clientes, Cobros, Más.
- Claro: fondo #F7F7F5, tarjeta #FFFFFF, texto #111111, secundario #666666, línea #E7E7E4, alerta #B42318.
- Oscuro: fondo #0E0E0E, tarjeta #181818, texto #F2F2F2, secundario #A3A3A3, línea #2A2A2A, alerta #F97066.

## Estructura de carpetas
```
public/ (icons/, manifest.webmanifest)
src/
  main.js
  core/ (db.js, money.js, dates.js, validation.js, events.js)
  repositories/ (clientes, pedidos, pagos, archivos, ...)
  services/ (pedidos, pagos, grupos, estadisticas, respaldo, excel, imagenes, seguridad, licencia)
  modules/ (panel, pedidos, clientes, pagos, entregas, estadisticas, vencimientos, informes, configuracion, seguridad, respaldos)
  ui/
  styles/
tests/ (unit/, data/ con generador de 500 pedidos)
```

## Etapas (cada una se prueba antes de seguir)
1. Arquitectura: Vite, esquema Dexie, router, PWA instalable y offline, despliegue en Cloudflare Pages. Prueba: se instala en Android, iPhone y Windows y abre sin internet.
2. Interfaz y acceso: bienvenida, licencia, marca del negocio, PIN, código de recuperación, panel, navegación. Prueba: PIN erróneo bloquea; la recuperación funciona.
3. Clientes y pedidos: transmisiones, detección por WhatsApp, prendas con fotos, códigos, búsqueda, agrupación, respaldo y restauración básicos. Prueba: 500 pedidos, búsqueda en menos de 1 s, sin códigos repetidos, restauración idéntica.
4. Pagos: parciales y completos, efectivo y QR, comprobantes, anulaciones, saldos. Prueba: saldos correctos en 20 casos manuales.
5. Entregas: recogida, envíos, vencimientos, WhatsApp con mensaje preparado, cancelaciones, devoluciones. Prueba: nada borra fotos ni pagos.
6. Estadísticas e informes: ventas vs cobros, deudas, entregas, devoluciones, gráficos, filtros, Excel. Prueba: venta de Bs 200 hoy y cobro mañana sale correcto.
7. Seguridad y respaldos completos: WebAuthn, bloqueo por inactividad, ZIP por partes, aviso diario, validaciones finales. Prueba: restaurar un respaldo grande en otro dispositivo.
8. Pruebas finales: volumen, offline, Android, iPhone, Windows y tablet.

## Forma de trabajo
- La dueña solo tiene celular (sin PC): toda herramienta para ella debe funcionar en el navegador del teléfono; nada de comandos ni archivos para abrir con doble clic.
- Una etapa por sesión. Al terminar, commit y resumen de qué probar.
- Editar solo los archivos necesarios.
- Interfaz y mensajes en español.
- Estado actual: etapas 1 y 2 terminadas en código (pendiente la prueba en dispositivos reales). Siguiente: etapa 3.

## Notas de la etapa 1
- Router por hash (`#/panel`), sin configuración de servidor.
- `core/db.js`: esquema v1 (12 tablas). Para cambiar el esquema: agregar `ESQUEMAS[n]` y `db.version(n)...upgrade()`, subir `VERSION_ESQUEMA` y probar en `tests/unit/db.test.js`. Antes de migrar se copia todo a la base `registro-ventas-live-migraciones`.
- Ajustes iniciales en `ajustesIniciales()` (contador `codigos.ultimoSeq`, plazos, avisos, etc.).
- Service Worker con `registerType: 'prompt'`: las versiones nuevas se aplican al tocar «Actualizar».
- Fuentes empaquetadas (@fontsource, solo latin) para que funcionen sin internet.
- Pruebas con `TZ=America/La_Paz` (vite.config.js).

## Notas de la etapa 2
- Licencia: `RVL1.<datos base64url>.<firma ECDSA P-256>`; formato en `core/licencia-formato.js`, clave pública en `core/licencia-clave-publica.js`. Emisor: `public/emisor/index.html` (se abre en /emisor/ desde el celular; fuera del precaché del SW) y `scripts/emitir-licencia.mjs`. La clave privada NO está en el repositorio.
- Ajustes nuevos: `licencia`, `marca` {nombre, whatsapp, logoId}, `seguridad.pin`, `seguridad.recuperacion` (solo hashes), `seguridad.intentosPin`, `seguridad.intentosRecuperacion`, `configuracion.completa`.
- Logo en `archivos` (tipo `logo`); cambiarlo agrega uno nuevo y no borra el anterior.
- Historial: `entidadId = 0` para entidades únicas (negocio, seguridad, licencia).
- El asistente solo entra directo si terminó la configuración en ese momento; en cualquier otro caso se pide el PIN.
- Sesión en memoria (`services/seguridad.js`); `services/sesion.js` → `bloquearAhora()`.
