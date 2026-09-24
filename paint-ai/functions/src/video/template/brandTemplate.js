import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

/**
 * Inti Warna brand template for generated videos (9:16).
 * Every graphic is rendered to a transparent PNG (satori → SVG → resvg → PNG) and composited by ffmpeg:
 *   - brand bug (logo pill, whole video)          - hook title (first ~3 s)
 *   - before / process / after label (template)    - one caption per clip
 *   - end card (opaque, appended after the video) with CTA and contact details
 * Layout keeps inside the Reels/TikTok safe zone (top ~8 %, bottom ~22 %, right ~11 % reserved for app UI).
 */

const ASSETS = new URL('../../../assets/brand/', import.meta.url);

export const BRAND_COLORS = {
  navy: '#13295B',
  ink: '#0F172A',
  yellow: '#FFC928',
  magenta: '#C0267A',
  purple: '#7B2F9E',
  gold: '#F2B705',
  green: '#4FA82E',
  blue: '#1E88E5',
};
const RAINBOW = [BRAND_COLORS.magenta, BRAND_COLORS.purple, BRAND_COLORS.gold, BRAND_COLORS.green, BRAND_COLORS.blue];

const LABELS = {
  id: {
    eyebrow: {
      before_after: 'SEBELUM & SESUDAH',
      product_education: 'TIPS CAT',
      store_promotion: 'PROMO TOKO',
      customer_testimonial: 'KATA PELANGGAN',
      color_inspiration: 'INSPIRASI WARNA',
    },
    before: 'SEBELUM',
    process: 'PROSES',
    after: 'SESUDAH',
    cta: 'Konsultasikan warna rumahmu di toko kami',
    visit: 'Kunjungi toko Inti Warna terdekat',
  },
  en: {
    eyebrow: {
      before_after: 'BEFORE & AFTER',
      product_education: 'PAINT TIPS',
      store_promotion: 'STORE PROMO',
      customer_testimonial: 'CUSTOMER STORY',
      color_inspiration: 'COLOR INSPIRATION',
    },
    before: 'BEFORE',
    process: 'PROCESS',
    after: 'AFTER',
    cta: 'Talk to us about your home colors',
    visit: 'Visit your nearest Inti Warna store',
  },
};
export const templateLabels = (lang) => LABELS[lang === 'en' ? 'en' : 'id'];

// ------------------------------------------------------------------ assets

// Plain TrueType on purpose: satori inflates WOFF tables through fflate and silently draws blank glyphs
// when that dependency changes behaviour. TTF needs no decompression. (Plus Jakarta Sans, SIL OFL 1.1.)
const FONTS = { 600: 'PlusJakartaSans-SemiBold.ttf', 700: 'PlusJakartaSans-Bold.ttf', 800: 'PlusJakartaSans-ExtraBold.ttf' };
const FONT_DIR = new URL('../../../assets/fonts/', import.meta.url);

let fontsPromise = null;
export function loadFonts() {
  fontsPromise ??= Promise.all(
    Object.entries(FONTS).map(async ([weight, file]) => ({ name: 'Jakarta', weight: Number(weight), style: 'normal', data: await readFile(new URL(file, FONT_DIR)) })),
  );
  return fontsPromise;
}

let imagesPromise = null;
function loadImages() {
  imagesPromise ??= Promise.all(['inti-warna-mark.png', 'inti-warna-logo.png'].map((f) => readFile(new URL(f, ASSETS)))).then(([mark, logo]) => ({
    mark: `data:image/png;base64,${mark.toString('base64')}`,
    logo: `data:image/png;base64,${logo.toString('base64')}`,
  }));
  return imagesPromise;
}

/** Plain text safe for the bundled latin font: no emoji / arrows, single spaces, clamped. */
export function cleanText(value, max = 90) {
  const text = String(value ?? '')
    .replace(/[→⇒➜➡]/g, '-')
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}+=%&@#$*<>|~^`']/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).trim()}…`;
}

// ------------------------------------------------------------------ element helpers (satori object syntax)

const h = (type, style, children) => ({ type, props: { style, children } });
const img = (src, style) => ({ type: 'img', props: { src, style } });
const text = (value, style) => h('div', { display: 'flex', ...style }, value);

const svgIcon = (paths, color) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`,
  ).toString('base64')}`;
const ICONS = {
  pin: '<path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  camera: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20"/>',
};

function rainbowBar(width, height) {
  return h(
    'div',
    { display: 'flex', width, height, borderRadius: height, overflow: 'hidden' },
    RAINBOW.map((c) => h('div', { display: 'flex', flex: 1, height, backgroundColor: c })),
  );
}

const canvas = (width, height, children, style = {}) => h('div', { display: 'flex', position: 'relative', width, height, fontFamily: 'Jakarta', ...style }, children);

// ------------------------------------------------------------------ graphics

function brandBug({ mark, width, height }) {
  return canvas(width, height, [
    h(
      'div',
      {
        position: 'absolute',
        top: Math.round(height * 0.045),
        left: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 18px 8px 10px',
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.96)',
        boxShadow: '0 6px 18px rgba(15,23,42,0.22)',
      },
      [img(mark, { height: 34 }), text('Inti Warna', { fontSize: 22, fontWeight: 800, color: BRAND_COLORS.navy, letterSpacing: -0.3 })],
    ),
  ]);
}

const STAGE_STYLE = {
  before: { backgroundColor: BRAND_COLORS.ink, color: '#FFFFFF' },
  process: { backgroundColor: BRAND_COLORS.yellow, color: BRAND_COLORS.navy },
  after: { backgroundColor: '#16A34A', color: '#FFFFFF' },
};
function stageLabel({ label, tone, width, height }) {
  return canvas(width, height, [
    h(
      'div',
      {
        position: 'absolute',
        top: Math.round(height * 0.045) + 64,
        left: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 22px',
        borderRadius: 16,
        boxShadow: '0 8px 22px rgba(15,23,42,0.28)',
        ...STAGE_STYLE[tone],
      },
      [h('div', { display: 'flex', width: 12, height: 12, borderRadius: 12, backgroundColor: tone === 'process' ? BRAND_COLORS.navy : '#FFFFFF' }), text(label, { fontSize: 30, fontWeight: 800, letterSpacing: 1.5 })],
    ),
  ]);
}

function hookCard({ eyebrow, title, width, height }) {
  const size = title.length <= 22 ? 64 : title.length <= 38 ? 56 : title.length <= 56 ? 48 : 42;
  return canvas(width, height, [
    h(
      'div',
      { position: 'absolute', top: Math.round(height * 0.2), left: 0, width, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '0 40px' },
      [
        eyebrow
          ? text(eyebrow, { padding: '8px 20px', borderRadius: 999, backgroundColor: BRAND_COLORS.yellow, color: BRAND_COLORS.navy, fontSize: 22, fontWeight: 800, letterSpacing: 1.5, boxShadow: '0 6px 16px rgba(15,23,42,0.25)' })
          : null,
        h(
          'div',
          { display: 'flex', flexDirection: 'column', maxWidth: width - 80, borderRadius: 26, overflow: 'hidden', backgroundColor: 'rgba(19,41,91,0.95)', boxShadow: '0 14px 36px rgba(15,23,42,0.35)' },
          [
            rainbowBar(width - 80, 8),
            text(title, { padding: '22px 30px 26px', color: '#FFFFFF', fontSize: size, fontWeight: 800, lineHeight: 1.12, letterSpacing: -0.8, textAlign: 'center', justifyContent: 'center' }),
          ],
        ),
      ].filter(Boolean),
    ),
  ]);
}

function sceneCaption({ caption, accent, width, height }) {
  const size = caption.length <= 28 ? 38 : caption.length <= 48 ? 34 : 30;
  return canvas(width, height, [
    h('div', { position: 'absolute', bottom: Math.round(height * 0.235), left: 0, width, display: 'flex', justifyContent: 'center', padding: '0 44px' }, [
      text(caption, {
        maxWidth: width - 88,
        padding: '14px 24px 16px 22px',
        borderRadius: 18,
        borderLeft: `10px solid ${accent}`,
        backgroundColor: 'rgba(255,255,255,0.96)',
        color: BRAND_COLORS.navy,
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.18,
        letterSpacing: -0.4,
        textAlign: 'center',
        justifyContent: 'center',
        boxShadow: '0 10px 26px rgba(15,23,42,0.28)',
      }),
    ]),
  ]);
}

function endCard({ logo, cta, rows, width, height }) {
  const row = (icon, color, value) =>
    h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 52, backgroundColor: `${color}1F` }, [img(svgIcon(ICONS[icon], color), { width: 26, height: 26 })]),
      text(value, { flex: 1, fontSize: 25, fontWeight: 600, color: '#1E293B', lineHeight: 1.25 }),
    ]);
  const ctaSize = cta.length <= 30 ? 48 : cta.length <= 50 ? 42 : 36;
  return canvas(
    width,
    height,
    [
      h('div', { position: 'absolute', top: -160, right: -160, width: 420, height: 420, borderRadius: 420, backgroundColor: 'rgba(192,38,122,0.12)', display: 'flex' }),
      h('div', { position: 'absolute', top: 40, right: 120, width: 180, height: 180, borderRadius: 180, backgroundColor: 'rgba(123,47,158,0.10)', display: 'flex' }),
      h('div', { position: 'absolute', bottom: -180, left: -140, width: 460, height: 460, borderRadius: 460, backgroundColor: 'rgba(242,183,5,0.16)', display: 'flex' }),
      h('div', { position: 'absolute', bottom: 120, left: 200, width: 160, height: 160, borderRadius: 160, backgroundColor: 'rgba(79,168,46,0.12)', display: 'flex' }),
      h('div', { position: 'absolute', top: 0, left: 0, width, height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36, padding: '0 56px 40px' }, [
        img(logo, { width: 440 }),
        rainbowBar(180, 8),
        text(cta, { fontSize: ctaSize, fontWeight: 800, color: BRAND_COLORS.navy, textAlign: 'center', justifyContent: 'center', lineHeight: 1.15, letterSpacing: -0.8, maxWidth: width - 112 }),
        rows.length
          ? h(
              'div',
              { display: 'flex', flexDirection: 'column', gap: 20, width: width - 112, padding: '30px 32px', borderRadius: 30, backgroundColor: '#FFFFFF', boxShadow: '0 16px 40px rgba(19,41,91,0.14)' },
              rows.map((r) => row(r.icon, r.color, r.value)),
            )
          : null,
      ].filter(Boolean)),
    ],
    { backgroundColor: '#FFFDF8', overflow: 'hidden' },
  );
}

const SHADOW_PAD = 44;

/**
 * Renders an element to PNG. Overlays are cropped to their visible box (+ room for shadows) so ffmpeg
 * blends a small image at (x, y) instead of a full transparent frame — much faster to composite.
 */
async function renderPng(element, { width, height }, file, { crop = true } = {}) {
  const svg = await satori(element, { width, height, fonts: await loadFonts() });
  const resvg = new Resvg(svg, { background: 'rgba(0,0,0,0)' });
  let x = 0;
  let y = 0;
  if (crop) {
    const box = resvg.getBBox();
    if (box && box.width > 0 && box.height > 0) {
      x = Math.max(0, Math.floor(box.x - SHADOW_PAD));
      y = Math.max(0, Math.floor(box.y - SHADOW_PAD));
      const right = Math.min(width, Math.ceil(box.x + box.width + SHADOW_PAD));
      const bottom = Math.min(height, Math.ceil(box.y + box.height + SHADOW_PAD));
      box.x = x;
      box.y = y;
      box.width = right - x;
      box.height = bottom - y;
      resvg.cropByBBox(box);
    }
  }
  await writeFile(file, resvg.render().asPng());
  return { path: file, x, y };
}

// ------------------------------------------------------------------ timeline + assets

/** Clip start times after cross-fades of `transition` seconds, and the main (pre end card) length. */
export function computeTimeline(durations, transition) {
  const starts = [];
  let t = 0;
  durations.forEach((d, i) => {
    starts.push(Math.round(t * 1000) / 1000);
    t += d - (i < durations.length - 1 ? transition : 0);
  });
  return { starts, total: Math.round(t * 1000) / 1000 };
}

/** Stage label per clip for the before/after template: first = before, last = after, rest = process. */
export function stageFor(index, count) {
  if (count < 2) return null;
  if (index === 0) return 'before';
  if (index === count - 1) return 'after';
  return 'process';
}

/**
 * Renders every template graphic for one video and returns ffmpeg overlay instructions.
 * @returns {Promise<{ overlays: {path:string,x:number,y:number,start:number,end:number,fade:boolean}[], endCard: {path:string,duration:number}|null, timeline: {starts:number[], total:number} }>}
 */
export async function buildTemplateAssets({ dir, dims, durations, transition, template, hookText, captions = [], cta, contact = {}, lang = 'id', options = {} }) {
  const { width, height } = dims;
  const L = templateLabels(lang);
  const images = await loadImages();
  const { starts, total } = computeTimeline(durations, transition);
  const overlays = [];
  const file = (name) => path.join(dir, `${name}.png`);
  const clipEnd = (i) => starts[i] + durations[i] - (i < durations.length - 1 ? transition : 0);

  overlays.push({ ...(await renderPng(brandBug({ mark: images.mark, width, height }), dims, file('bug'))), start: 0, end: total, fade: false });

  const title = cleanText(hookText, 70);
  let hookEnd = 0;
  if (title) {
    hookEnd = Math.min(3.4, Math.max(1.5, total - 0.5));
    overlays.push({ ...(await renderPng(hookCard({ eyebrow: L.eyebrow[template] ?? '', title, width, height }), dims, file('hook'))), start: 0.15, end: hookEnd, fade: true });
  }

  if (template === 'before_after') {
    for (let i = 0; i < durations.length; i += 1) {
      const tone = stageFor(i, durations.length);
      if (!tone) continue;
      overlays.push({ ...(await renderPng(stageLabel({ label: L[tone], tone, width, height }), dims, file(`stage-${i}`))), start: starts[i] + 0.1, end: clipEnd(i), fade: true });
    }
  }

  if (options.captions !== false) {
    for (let i = 0; i < durations.length; i += 1) {
      const caption = cleanText(captions[i], 70);
      if (!caption) continue;
      const start = Math.max(starts[i] + 0.3, i === 0 ? hookEnd + 0.15 : 0);
      const end = clipEnd(i) - 0.15;
      if (end - start < 1.2) continue;
      overlays.push({ ...(await renderPng(sceneCaption({ caption, accent: RAINBOW[i % RAINBOW.length], width, height }), dims, file(`caption-${i}`))), start, end, fade: true });
    }
  }

  let end = null;
  if (options.endCard !== false) {
    const rows = [];
    const place = [contact.storeName, [contact.address, contact.city].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
    rows.push({ icon: 'pin', color: BRAND_COLORS.magenta, value: cleanText(place || L.visit, 90) });
    if (contact.whatsapp) rows.push({ icon: 'chat', color: '#16A34A', value: cleanText(`WhatsApp ${contact.whatsapp}`, 40) });
    if (contact.instagram) rows.push({ icon: 'camera', color: BRAND_COLORS.purple, value: cleanText(contact.instagram.startsWith('@') ? contact.instagram : `@${contact.instagram}`, 40) });
    if (contact.website) rows.push({ icon: 'globe', color: BRAND_COLORS.blue, value: cleanText(contact.website, 50) });
    if (contact.hours) rows.push({ icon: 'clock', color: BRAND_COLORS.gold, value: cleanText(contact.hours, 50) });
    const ctaText = cleanText(cta, 70) || L.cta;
    end = { path: (await renderPng(endCard({ logo: images.logo, cta: ctaText, rows, width, height }), dims, file('endcard'), { crop: false })).path, duration: 3.2 };
  }
  return { overlays, endCard: end, timeline: { starts, total } };
}
