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
- ZIP: fflate (generado por partes). Excel: generador propio `core/xlsx.js` sobre fflate (SheetJS de npm tiene vulnerabilidades y la versión actual no está en npm). Gráficos: Chart.js 4.5.1.
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
- Pago al reservar (pedido de la dueña, 25/11/2026): cada pedido se guarda con su pago COMPLETO en el mismo formulario; sin adelantos; no se entrega con deuda; al editar, si sube el total se cobra la diferencia y no se puede bajar de lo pagado. Ajuste `pedidos.exigirPagoCompleto` (true por defecto; `services/politicas.js`). El modo flexible (false) conserva pagos parciales y «entregar igual»; las pruebas antiguas lo usan (`bdDePrueba()` sin opciones).
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
- Estado actual: etapas 1 a 8 terminadas (versión 1.0.0). App publicada en https://registro-ventas-live.pages.dev (Cloudflare Pages, rama `main`). Falta solo la prueba en dispositivos reales (sobre todo iPhone).

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

## Notas de la etapa 3
- Servicios: `clientes.js`, `transmisiones.js`, `pedidos.js` (crear/editar/buscar), `grupos.js`, `respaldo.js`; cálculos puros en `core/calculos.js`.
- Pedido: `estado` = pendiente | entregado | cancelado; `estadoPago` = sin-pago | parcial | pagado (calculado con pagado − reembolsado); `modalidad` = recojo | envio.
- Código: siguiente = max(`codigos.ultimoSeq`, mayor `seq`) + 1, dentro de la transacción del pedido.
- Al restaurar, el contador queda en el mayor entre este teléfono, el respaldo y el último pedido: un código ya usado nunca se repite.
- Editar pedido: lista completa de prendas; las quitadas se borran de `prendas` (quedan en el historial) y su foto se conserva en `archivos`. Bloquea total < pagado neto.
- Grupos: nunca se borran; con menos de 2 pedidos pasan a `deshecho`.
- Respaldo: ZIP sin compresión (fflate), `manifiesto.json` con SHA-256 de cada archivo; restaurar verifica todo antes, hace copia interna (`copiaInterna`) y reemplaza todo en una transacción, conservando `seguridad.*`, `licencia` y `configuracion.completa` del teléfono.
- UI: usar `agregar()`/`reemplazar()` de `ui/dom.js` en vez de `append`/`replaceChildren` (estos escriben «null»).
- Pruebas de volumen: `tests/data/generador.js` y `tests/unit/volumen.test.js`.

## Notas de la etapa 4
- `services/pagos.js`: `registrarPago`, `anularPago` (registro nuevo con monto negativo y `anulaA`), `pagarGrupo` (más antiguo → más nuevo, un registro por pedido, comprobante compartido), `cobrosEntre`, `pedidosPorCobrar`.
- `pedido.pagado` se recalcula SIEMPRE sumando la tabla `pagos`. Pagos llevan `grupoId` (null si es individual) y `actor`.
- Pago de más bloqueado; no se paga un pedido cancelado; no se anula si quedaría menos que lo reembolsado.
- Cobros por día local; las anulaciones restan el día en que se hacen. Panel muestra ventas generadas y cobrado hoy por separado.
- 20 casos de saldo en `tests/unit/pagos.test.js`.

## Notas de la etapa 5
- `services/entregas.js`: `registrarEntrega` (pedido o grupo; recojo o envío; exige `aceptarSaldo` si hay saldo; marca `vencido`), `confirmarRecepcion` (envío), `deshacerEntrega` (la entrega queda con `anulada`, no se borra), `cancelarPedido` (solo pendientes; guarda `cancelacion`).
- Pedido entregado guarda `entregaId`. Entrega guarda `pedidos` (ids), `saldoAlEntregar`, `vencido`, `anulada`. Envío en grupo: un `costoEnvio` en la entrega (no cambia totales de pedidos).
- `services/devoluciones.js`: solo se agregan; `anularDevolucion` crea registro negativo con `anulaA`. No más de pagado − reembolsado. En pedido no cancelado exige `excepcion`. `pedido.reembolsado` se recalcula sumando la tabla.
- `services/vencimientos.js`: vencido = pasó el día local de `fechaLimite`; aviso desde el día 25 (ajuste `pedidos.diasAviso`).
- `services/mensajes.js`: textos de WhatsApp (listo, recordatorio, saldo, enviado) y `enlaceWhatsApp` (wa.me). Solo abre WhatsApp; no envía nada solo.
- Los cancelados no suman al total del grupo. Lista de pedidos filtra por estado (filtro antes de offset/limit).
- Prueba «nada borra fotos ni pagos» en `tests/unit/entregas.test.js`.

## Notas de la etapa 6
- `services/estadisticas.js`: ventas = pedidos creados en el período sin cancelados; cancelaciones aparte por fecha de cancelación; cobros por fecha de pago (anulaciones restan ese día); devoluciones por fecha; deudas y pendientes = foto de hoy. Días locales.
- `services/excel.js` + `core/xlsx.js`: 9 hojas (Resumen, Por día, Pedidos, Prendas, Pagos, Devoluciones, Entregas, Por cobrar, Clientas). Dinero como número en Bs con formato #,##0.00; fechas como serie de Excel en hora local. Verificado con openpyxl y LibreOffice.
- `modules/informes.js` se carga aparte (import dinámico) por Chart.js; sigue en el precaché.
- Gráfico: dos series en la misma escala (un eje), gris validado con el validador de dataviz (ΔE ≥ 39, contraste ≥ 3:1), leyenda y tabla alternativa.
- Prueba de la etapa en `tests/unit/estadisticas.test.js`.

## Notas de la etapa 7
- `core/zip-lector.js`: lee el índice del ZIP y devuelve cada entrada como `Blob.slice` del archivo (no carga el ZIP en memoria). Sin ZIP64 (límite 4 GB).
- `services/respaldo.js` (formato 2; lee también el formato 1): tipos `datos` (solo datos.json), `fotos` (archivos con id > `respaldo.fotosHastaId`; por id, no por hora) y `completo`. Escritura por partes (trozos de 8 MB, fotos de a una). Contraseña opcional: cada entrada AES-GCM-256 (IV+cifrado) con clave PBKDF2; `verificador` en el manifiesto. SHA-256 del contenido guardado en el manifiesto + SHA-256 de la foto descifrada contra `archivos.sha256`.
- Restaurar acepta VARIOS archivos: datos del más reciente con datos; fotos de cualquiera. Si faltan fotos: `puedeContinuar` y, con confirmación, se restaura con `perdido: true` (blob null); los respaldos siguientes las ignoran.
- Ajustes: `respaldo.ultimo` (datos/completo), `respaldo.ultimoFotos`, `respaldo.fotosHastaId`. Panel avisa: >24 h sin respaldo de datos, fotos sin respaldar >7 días, espacio >80 %.
- Bienvenida: en el paso «Tu negocio» se puede restaurar un respaldo (teléfono nuevo); luego se crea un PIN nuevo.
- `services/biometria.js`: WebAuthn de plataforma con `userVerification: 'required'`; se guarda la clave pública (SPKI) en `seguridad.biometria` y cada desbloqueo se verifica localmente (tipo, desafío, origen, rpIdHash, banderas UP+UV, firma ES256/RS256). Activar pide el PIN antes. Oculto si no hay soporte.
- Prueba de la etapa: `tests/unit/respaldo-completo.test.js` (300 fotos, ~45 MB, con contraseña) y E2E de 200 pedidos con fotos JPEG restaurados en otro contexto de navegador.
- Pendiente (desactivado por defecto en el documento): «archivo de fotos antiguas». No implementado para no arriesgar la regla de no borrar fotos.

## Notas de la etapa 8
- Volumen (Chromium, Pixel 7): 3000 pedidos, 800 clientas, 1500 fotos JPEG (62 MB). Panel ~0,3 s; lista ~30 ms; búsqueda por código ~0,3 s, por nombre ~0,55 s, por WhatsApp ~15 ms; detalle <40 ms; informes 30 días ~0,45 s, un año ~2,3 s (con aviso «Calculando…»); Excel del año ~2 s; respaldo completo 55 MB en 3,3 s; restauración en otro contexto ~10 s con conteos idénticos. Offline correcto.
- 144 revisiones de pantalla (320 px, 360 px, 390 px, tablet, escritorio, ancho; claro y oscuro; 12 pantallas): sin desbordes, botones <44 px ni textos cortados. Sin errores de consola.
- Compatibilidad: `index.html` detecta navegadores antiguos (`window.__navegadorAntiguo`: indexedDB, crypto.subtle, `<dialog>`, `Array.prototype.at`) y muestra aviso; mínimo iOS 15.4 / Chrome 92. `services/imagenes.js` → `abrirImagen` con respaldo (createImageBitmap con opciones → sin opciones → `<img>`) para Safari.
- Formulario de pedido: precio vacío cuenta 0 en pantalla y al guardar pide «Escribe el precio de la prenda N».
- Solo hay Chromium en el entorno: la prueba en iPhone/Safari, Windows y tablet real la hace la dueña con la lista de comprobación.

## Páginas legales
- `public/legal/privacidad/` y `public/legal/terminos/` (+ `legal.css`): precacheadas (abren sin internet), enlazadas desde Más → Legal y la bienvenida. Incluyen la sección de Google Drive con la declaración de «Uso limitado» que exige Google.
- Proveedor: Ventas Live Bolivia, Santa Cruz de la Sierra. Correo de contacto: soporte.ventaslive@gmail.com (también será la cuenta del proyecto de Google Cloud).
- No son asesoría legal: recomendar revisión por abogado antes de vender.


## Google Drive (opcional, pedido de la dueña)
- Proyecto de Google Cloud «Ventas LIVE» con la cuenta soporte.ventaslive@gmail.com. ID de cliente (público) en `core/drive-config.js`. El secreto del cliente NO se usa. Origen autorizado: https://registro-ventas-live.pages.dev. Pantalla de consentimiento: externa, PUBLICADA (en producción, 25/11/2026) con marca: página principal, privacidad y términos en registro-ventas-live.pages.dev; sin logo (subir logo exige verificación). drive.file es no sensible: sin límite de usuarios. Probado con el Drive real de la dueña.
- `services/drive.js`: Google Identity Services (token, ~1 h, solo en memoria), alcance `drive.file`; carpeta «Ventas LIVE – Respaldos»; subida reanudable en trozos de 8 MB; listar/descargar; conserva los 7 últimos de «datos» y NUNCA borra fotos ni completos. Conexión en ajuste `drive.conexion` (del dispositivo: no viaja en respaldos).
- UI: `ui/drive-ui.js` (tarjeta en Respaldos y en la bienvenida para teléfono nuevo; botón «Subir a Google Drive» tras crear un respaldo). `panelRestaurar().restaurarArchivos(files)` restaura archivos bajados de Drive.
- Pruebas: `tests/unit/drive.test.js` con Drive simulado (mismas URLs). No hay acceso a Google real desde el entorno de desarrollo: la prueba real la hace la dueña.
