/**
 * Kompres foto di browser sebelum dikirim ke server:
 * - sisi terpanjang maks MAX_SIDE px
 * - JPEG quality 0.82
 * Mengurangi payload dan biaya token vision tanpa menghilangkan detail kebersihan.
 */
const MAX_SIDE = 1280;
const QUALITY = 0.82;

export interface CompressedImage {
  base64: string; // tanpa prefix data:
  mediaType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  previewUrl: string;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar (JPG/PNG/HEIC).');
  }
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung canvas.');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const base64 = dataUrl.split(',')[1];
  const bytes = Math.round((base64.length * 3) / 4);
  return { base64, mediaType: 'image/jpeg', width, height, bytes, previewUrl: dataUrl };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fallback ke <img>
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gagal membaca gambar.'));
    };
    img.src = url;
  });
}
