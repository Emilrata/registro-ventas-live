// Genera los íconos PNG de public/icons a partir de SVG.
// Uso (una sola vez, o al cambiar el diseño):
//   npm install --no-save sharp && node scripts/generar-iconos.mjs
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const FONDO = '#111111';
const FIGURA = '#FFFFFF';

// Símbolo "en vivo": aro con punto central. escala = fracción del lienzo que ocupa.
function svg({ tamano, escala, redondeo }) {
  const c = tamano / 2;
  const r = (tamano * escala) / 2;
  const radioEsquina = redondeo ? tamano * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamano}" height="${tamano}" viewBox="0 0 ${tamano} ${tamano}">
  <rect width="${tamano}" height="${tamano}" rx="${radioEsquina}" fill="${FONDO}"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.86}" fill="none" stroke="${FIGURA}" stroke-width="${r * 0.14}"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.42}" fill="${FIGURA}"/>
</svg>`;
}

const salidas = [
  { archivo: 'icon-192.png', tamano: 192, escala: 0.62, redondeo: true },
  { archivo: 'icon-512.png', tamano: 512, escala: 0.62, redondeo: true },
  // Maskable: fondo completo y figura dentro de la zona segura (80 %).
  { archivo: 'icon-maskable-512.png', tamano: 512, escala: 0.5, redondeo: false },
  // iOS redondea solo: fondo completo.
  { archivo: 'apple-touch-icon.png', tamano: 180, escala: 0.6, redondeo: false },
];

for (const s of salidas) {
  await sharp(Buffer.from(svg(s))).png({ compressionLevel: 9 }).toFile(`public/icons/${s.archivo}`);
  console.log('creado', s.archivo);
}
writeFileSync('public/icons/favicon.svg', svg({ tamano: 64, escala: 0.66, redondeo: true }) + '\n');
console.log('creado favicon.svg');
