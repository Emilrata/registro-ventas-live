// Generador mínimo de archivos Excel (.xlsx = ZIP con XML, formato Office Open XML).
// Se usa en lugar de SheetJS: la versión de npm tiene vulnerabilidades conocidas y la actual
// solo se distribuye fuera de npm. Este generador solo ESCRIBE (no lee archivos ajenos).
//
// hojas = [{ nombre, columnas: [{ titulo, tipo, ancho }], filas: [[valor, ...]] }]
// tipos: 'texto' · 'entero' · 'dinero' (recibe CENTAVOS, muestra Bs) · 'fecha' (ISO o Date, hora local)
import { zipSync, strToU8 } from 'fflate';

const ESTILO = { normal: 0, encabezado: 1, dinero: 2, fecha: 3, entero: 4 };

/** Quita caracteres que XML no permite y escapa los especiales. */
export function escaparXml(valor) {
  return String(valor)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Número de columna (0 = A) a letras: 0 → A, 25 → Z, 26 → AA. */
export function letraColumna(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Fecha → número de serie de Excel, usando la hora LOCAL del dispositivo (lo que ve la persona). */
export function serieExcel(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Nombre de hoja válido: máximo 31 caracteres, sin []:*?/\ y único. */
function nombreHoja(nombre, usados) {
  let base = String(nombre || 'Hoja').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = base;
  let i = 2;
  while (usados.has(n.toLowerCase())) {
    const sufijo = ` (${i++})`;
    n = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(n.toLowerCase());
  return n;
}

function celda(ref, valor, tipo) {
  // Celda con tipo propio: { valor, tipo } (para columnas que mezclan textos y números).
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && 'valor' in valor) {
    return celda(ref, valor.valor, valor.tipo ?? 'texto');
  }
  if (valor === null || valor === undefined || valor === '') return '';
  if (tipo === 'dinero' || tipo === 'entero') {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return celdaTexto(ref, valor, ESTILO.normal);
    const v = tipo === 'dinero' ? valor / 100 : valor;
    return `<c r="${ref}" s="${tipo === 'dinero' ? ESTILO.dinero : ESTILO.entero}"><v>${v}</v></c>`;
  }
  if (tipo === 'fecha') {
    const s = serieExcel(valor);
    if (s === null) return '';
    return `<c r="${ref}" s="${ESTILO.fecha}"><v>${s}</v></c>`;
  }
  return celdaTexto(ref, valor, ESTILO.normal);
}

function celdaTexto(ref, valor, estilo) {
  return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
}

function xmlHoja({ columnas, filas }) {
  const ultima = letraColumna(Math.max(columnas.length - 1, 0));
  const cols = columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? Math.max(10, Math.min(40, String(c.titulo).length + 4))}" customWidth="1"/>`)
    .join('');
  const encabezado = `<row r="1">${columnas.map((c, i) => celdaTexto(`${letraColumna(i)}1`, c.titulo, ESTILO.encabezado)).join('')}</row>`;
  const cuerpo = filas
    .map((fila, f) => {
      const r = f + 2;
      return `<row r="${r}">${columnas.map((c, i) => celda(`${letraColumna(i)}${r}`, fila[i], c.tipo ?? 'texto')).join('')}</row>`;
    })
    .join('');
  const total = filas.length + 1;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${ultima}${total}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${encabezado}${cuerpo}</sheetData>` +
    (filas.length ? `<autoFilter ref="A1:${ultima}${total}"/>` : '') +
    '</worksheet>'
  );
}

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Crea el archivo .xlsx. Devuelve Uint8Array. */
export function crearXlsx(hojas, { titulo = 'Informe', fecha = new Date() } = {}) {
  if (!Array.isArray(hojas) || hojas.length === 0) throw new TypeError('El libro necesita al menos una hoja');
  const usados = new Set();
  const nombres = hojas.map((h) => nombreHoja(h.nombre, usados));
  const archivos = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    ),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${escaparXml(titulo)}</dc:title><dc:creator>Registro de Ventas LIVE</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date(fecha).toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created>` +
        '</cp:coreProperties>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${nombres.map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `<definedNames>${hojas
          .map((h, i) => (h.filas.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escaparXml(nombres[i]).replace(/'/g, "''")}'!$A$1:$${letraColumna(h.columnas.length - 1)}$${h.filas.length + 1}</definedName>` : ''))
          .join('')}</definedNames>` +
        '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(ESTILOS),
  };
  hojas.forEach((h, i) => {
    if (!Array.isArray(h.columnas) || h.columnas.length === 0) throw new TypeError(`La hoja ${nombres[i]} no tiene columnas`);
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xmlHoja(h));
  });
  return zipSync(archivos, { level: 6 });
}
