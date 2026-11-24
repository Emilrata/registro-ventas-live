// Validaciones y normalizaciones compartidas.

export const CODIGO_PAIS_POR_DEFECTO = '591'; // Bolivia

/**
 * Normaliza un número de WhatsApp a formato internacional "+59171234567".
 * - Sin prefijo: se asume el código de país indicado (Bolivia por defecto).
 * - Bolivia: 8 dígitos que empiezan con 6 o 7.
 * - Otros países: E.164, entre 8 y 15 dígitos en total.
 * Devuelve { ok: true, valor } o { ok: false, error }.
 */
export function normalizarWhatsapp(texto, codigoPais = CODIGO_PAIS_POR_DEFECTO) {
  if (typeof texto !== 'string' || texto.trim() === '') {
    return { ok: false, error: 'Escribe el número de WhatsApp.' };
  }
  const pais = String(codigoPais).replace(/\D/g, '');
  if (!/^[1-9]\d{0,2}$/.test(pais)) {
    return { ok: false, error: 'El código de país no es válido.' };
  }

  let s = texto.trim();
  if (/[^\d\s()+.\-]/.test(s)) {
    return { ok: false, error: 'El número solo puede tener dígitos.' };
  }
  const internacional = s.startsWith('+') || s.startsWith('00');
  let digitos = s.replace(/\D/g, '');
  if (s.startsWith('00')) digitos = digitos.slice(2);

  let completo;
  if (internacional) {
    completo = digitos;
  } else if (pais === '591' && digitos.length === 11 && digitos.startsWith('591')) {
    completo = digitos; // escribió 591 sin "+"
  } else {
    completo = pais + digitos.replace(/^0+/, '');
  }

  if (completo.startsWith('591')) {
    const local = completo.slice(3);
    if (!/^[67]\d{7}$/.test(local)) {
      return { ok: false, error: 'En Bolivia el número debe tener 8 dígitos y empezar con 6 o 7.' };
    }
  } else if (!/^[1-9]\d{7,14}$/.test(completo)) {
    return { ok: false, error: 'El número no es válido para ese país.' };
  }
  return { ok: true, valor: `+${completo}` };
}

/**
 * Normaliza un nombre para búsqueda: minúsculas, sin tildes, espacios simples.
 * "  María  José " → "maria jose"
 */
export function normalizarNombre(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Limpia el nombre para mostrar: espacios simples, sin bordes. */
export function limpiarTexto(texto) {
  return typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : '';
}

export function validarNombreCliente(texto) {
  const valor = limpiarTexto(texto);
  if (valor.length === 0) return { ok: false, error: 'Escribe el nombre de la clienta.' };
  if (valor.length > 80) return { ok: false, error: 'El nombre no puede pasar de 80 caracteres.' };
  return { ok: true, valor };
}
