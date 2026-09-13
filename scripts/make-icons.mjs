/**
 * Generate favicon & ikon aplikasi dari sumber logo.
 *   node scripts/make-icons.mjs [branding/almaz-mark.svg | branding/logo-source.png]
 * Output: public/favicon.ico, public/icons/*.png, public/icons/logo-mark.svg (jika sumber SVG)
 * Sumber PNG sebaiknya persegi, latar hitam/transparan, mark di tengah.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const src = process.argv[2] ?? 'branding/almaz-mark.svg';
const BG = '#000000'; // latar ikon (brand: oranye di atas hitam)
const out = 'public/icons';
fs.mkdirSync(out, { recursive: true });

async function render(size, padRatio, bg) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const mark = await sharp(src).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

const jobs = [
  ['icon-16.png', 16, 0.06], ['icon-32.png', 32, 0.06], ['icon-48.png', 48, 0.06],
  ['apple-touch-icon.png', 180, 0.12], ['icon-192.png', 192, 0.12], ['icon-512.png', 512, 0.12],
  ['maskable-512.png', 512, 0.2],
];
for (const [name, size, pad] of jobs) fs.writeFileSync(path.join(out, name), await render(size, pad, BG));

// favicon.ico multi-size (16/32/48) - format ICO menyimpan PNG di dalamnya
const icoSizes = [16, 32, 48];
const pngs = icoSizes.map((s) => fs.readFileSync(path.join(out, `icon-${s}.png`)));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
const dir = Buffer.alloc(16 * pngs.length); let offset = 6 + 16 * pngs.length;
pngs.forEach((buf, i) => { const s = icoSizes[i]; const o = i * 16; dir[o] = s === 256 ? 0 : s; dir[o + 1] = s === 256 ? 0 : s; dir[o + 2] = 0; dir[o + 3] = 0; dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12); offset += buf.length; });
fs.writeFileSync('public/favicon.ico', Buffer.concat([header, dir, ...pngs]));
fs.rmSync('src/app/favicon.ico', { force: true });
if (src.endsWith('.svg')) fs.copyFileSync(src, path.join(out, 'logo-mark.svg'));
else fs.writeFileSync(path.join(out, 'logo-mark.png'), await render(512, 0, { r: 0, g: 0, b: 0, alpha: 0 }));
console.log('ikon dibuat dari', src, '->', fs.readdirSync(out).join(', '), '+ public/favicon.ico');
