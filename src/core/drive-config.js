// Configuración pública de la conexión con Google Drive (proyecto «Ventas LIVE» en Google Cloud).
// El ID de cliente es PÚBLICO (va en cualquier app web). El «secreto del cliente» NO se usa ni va aquí.
export const GOOGLE_CLIENT_ID = '85191118484-33218rfr00ffvmcjjc4bi18a2nghfact.apps.googleusercontent.com';
// Solo los archivos que crea esta app: no puede ver el resto del Drive.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const NOMBRE_CARPETA = 'Ventas LIVE – Respaldos';
export const DATOS_A_CONSERVAR = 7;
