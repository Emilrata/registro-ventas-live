// Dinero en centavos enteros. Nunca se usan decimales de coma flotante.
// Bs 80,50 se guarda como 8050.

const MAXIMO_CENTAVOS = Number.MAX_SAFE_INTEGER;

/** Lanza un error si el valor no es un entero seguro (centavos válidos). */
export function asegurarCentavos(valor, nombre = 'monto') {
  if (!Number.isSafeInteger(valor)) {
    throw new TypeError(`${nombre} debe ser un número entero de centavos (recibido: ${String(valor)})`);
  }
  return valor;
}

/**
 * Convierte el texto que escribe la persona en centavos.
 * Acepta: "80", "80,5", "80,50", "80.50", "1.250", "1.250,50", "1,250.50", "Bs 80,50".
 * Reglas:
 *  - Si hay coma y punto, el que aparece último es el separador decimal.
 *  - Si solo hay comas: una coma seguida de 1 o 2 dígitos es decimal; grupos de 3 son miles.
 *  - Si solo hay puntos: igual que con comas.
 *  - Máximo 2 decimales. No se aceptan negativos.
 * Devuelve null si el texto no es un monto válido.
 */
export function parsearMonto(texto) {
  if (typeof texto === 'number') {
    if (!Number.isFinite(texto) || texto < 0) return null;
    texto = String(texto);
  }
  if (typeof texto !== 'string') return null;

  let s = texto.trim().replace(/^bs\.?\s*/i, '').replace(/\s+/g, '');
  if (s === '' || !/^[\d.,]+$/.test(s)) return null;

  const ultimaComa = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');
  let entero;
  let decimales = '';

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const sepDecimal = ultimaComa > ultimoPunto ? ',' : '.';
    const sepMiles = sepDecimal === ',' ? '.' : ',';
    const i = s.lastIndexOf(sepDecimal);
    if (s.indexOf(sepDecimal) !== i) return null; // dos separadores decimales
    entero = s.slice(0, i);
    decimales = s.slice(i + 1);
    if (!gruposDeMilesValidos(entero, sepMiles)) return null;
    entero = entero.split(sepMiles).join('');
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const sep = ultimaComa >= 0 ? ',' : '.';
    const partes = s.split(sep);
    const ultima = partes[partes.length - 1];
    if (partes.length === 2 && ultima.length >= 1 && ultima.length <= 2) {
      entero = partes[0];
      decimales = ultima;
    } else if (gruposDeMilesValidos(s, sep)) {
      entero = partes.join('');
    } else {
      return null;
    }
  } else {
    entero = s;
  }

  if (entero === '') entero = '0';
  if (!/^\d+$/.test(entero) || !/^\d{0,2}$/.test(decimales)) return null;

  const centavosTexto = entero.replace(/^0+(?=\d)/, '') + decimales.padEnd(2, '0');
  const centavos = Number(centavosTexto);
  if (!Number.isSafeInteger(centavos) || centavos > MAXIMO_CENTAVOS) return null;
  return centavos;
}

function gruposDeMilesValidos(texto, sep) {
  if (!texto.includes(sep)) return /^\d+$/.test(texto);
  const grupos = texto.split(sep);
  if (!/^\d{1,3}$/.test(grupos[0])) return false;
  return grupos.slice(1).every((g) => /^\d{3}$/.test(g));
}

/**
 * Formatea centavos como texto boliviano: 125050 → "Bs 1.250,50".
 * opciones.simbolo = false omite "Bs".
 */
export function formatearMonto(centavos, { simbolo = true } = {}) {
  asegurarCentavos(centavos);
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const entero = Math.trunc(abs / 100);
  const resto = abs % 100;
  const enteroTexto = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const texto = `${enteroTexto},${String(resto).padStart(2, '0')}`;
  return `${negativo ? '−' : ''}${simbolo ? 'Bs ' : ''}${texto}`;
}

/** Suma una lista de montos en centavos, validando cada uno. */
export function sumarCentavos(montos) {
  let total = 0;
  for (const m of montos) {
    total += asegurarCentavos(m);
    if (!Number.isSafeInteger(total)) throw new RangeError('La suma excede el límite permitido');
  }
  return total;
}

/** Precio unitario (centavos) por cantidad (entero positivo). */
export function multiplicarCentavos(centavos, cantidad) {
  asegurarCentavos(centavos);
  if (!Number.isSafeInteger(cantidad) || cantidad < 0) {
    throw new TypeError('La cantidad debe ser un entero no negativo');
  }
  const r = centavos * cantidad;
  if (!Number.isSafeInteger(r)) throw new RangeError('El resultado excede el límite permitido');
  return r;
}
