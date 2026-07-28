// Düzeltmeleri PDF'e işleme:
// - Metin: orijinalin üstü zemin rengiyle kapatılır, yeni metin (taşınmışsa yeni
//   konumda) Türkçe destekli gömülü fontla yazılır.
// - Alan (görsel/logo): orijinal bölge zemin rengiyle kapatılır, gizlenmediyse
//   yakalanan PNG (taşınmış/yeniden boyutlandırılmışsa yeni konum ve boyutta) basılır.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const FONT_FILES = {
  sans: '/fonts/Arial.ttf',
  'sans-bold': '/fonts/Arial-Bold.ttf',
  serif: '/fonts/Times.ttf',
  'serif-bold': '/fonts/Times-Bold.ttf',
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function bake(bytes, textEdits, areas) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);

  const fontCache = {};
  const getFont = async (serif, bold) => {
    const key = (serif ? 'serif' : 'sans') + (bold ? '-bold' : '');
    if (!fontCache[key]) {
      const res = await fetch(FONT_FILES[key]);
      if (!res.ok) throw new Error(`Font yüklenemedi: ${FONT_FILES[key]}`);
      fontCache[key] = await doc.embedFont(await res.arrayBuffer(), { subset: true });
    }
    return fontCache[key];
  };

  // ---- Metinler ----
  for (const rec of textEdits.values()) {
    const page = doc.getPage(rec.meta.page);

    // Orijinal tek satırlık glifleri her zaman gizle (yeni boyuttan bağımsız)
    page.drawRectangle({
      x: rec.meta.x - 1.5,
      y: rec.meta.yBase - rec.meta.fs * 0.3,
      width: rec.meta.w + 3,
      height: rec.meta.fs * 1.35,
      color: hexToRgb(rec.bg),
    });

    if (!rec.text) continue; // silinmiş: sadece kapat, yeniden yazma

    const font = await getFont(rec.serif, rec.bold);
    const size = rec.size;
    const lines = rec.text.split('\n');
    const lineH = size * 1.25;
    const x = rec.meta.x + rec.dx;
    const yBase = rec.meta.yBase + rec.dy;

    lines.forEach((line, i) => {
      if (!line) return;
      page.drawText(line, { x, y: yBase - i * lineH, size, font, color: hexToRgb(rec.color) });
    });
  }

  // ---- Alanlar (görsel/logo) ----
  const imgCache = new Map();
  for (const rec of areas.values()) {
    const page = doc.getPage(rec.page);

    page.drawRectangle({
      x: rec.x - 0.5,
      y: rec.y - 0.5,
      width: rec.w + 1,
      height: rec.h + 1,
      color: hexToRgb(rec.bg),
    });

    if (rec.hidden) continue;

    let img = imgCache.get(rec.key);
    if (!img) {
      img = await doc.embedPng(rec.png);
      imgCache.set(rec.key, img);
    }
    const w = rec.w * rec.scale;
    const h = rec.h * rec.scale;
    const x = rec.x + rec.dx + (rec.w - w) / 2;
    const y = rec.y + rec.dy + (rec.h - h) / 2;
    page.drawImage(img, { x, y, width: w, height: h });
  }

  return doc.save();
}
