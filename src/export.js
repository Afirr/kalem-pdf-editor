// Düzeltmeleri PDF'e işleme:
// - Metin: orijinalin üstü zemin rengiyle kapatılır, yeni metin (taşınmışsa yeni
//   konumda) Türkçe destekli gömülü fontla yazılır.
// - Alan (görsel/logo): orijinal bölge zemin rengiyle kapatılır, gizlenmediyse
//   yakalanan PNG (taşınmış/yeniden boyutlandırılmışsa yeni konum ve boyutta) basılır.
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { FONTS } from './fonts.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function bake(bytes, textEdits, areas) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);

  const fontCache = {};
  const getFont = async (fontKey, bold) => {
    const fam = FONTS[fontKey] || FONTS.arial;
    const file = bold ? fam.boldFile : fam.file;
    if (!fontCache[file]) {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`Font yüklenemedi: ${file}`);
      fontCache[file] = await doc.embedFont(await res.arrayBuffer(), { subset: true });
    }
    return fontCache[file];
  };

  // ---- Metinler ----
  for (const rec of textEdits.values()) {
    const page = doc.getPage(rec.meta.page);

    // Orijinal tek satırlık glifleri her zaman gizle (yeni boyuttan bağımsız).
    // "Metin Ekle" ile oluşturulan kutularda örtülecek orijinal içerik yoktur.
    if (!rec.meta.custom) {
      page.drawRectangle({
        x: rec.meta.x - 1.5,
        y: rec.meta.yBase - rec.meta.fs * 0.3,
        width: rec.meta.w + 3,
        height: rec.meta.fs * 1.35,
        color: hexToRgb(rec.bg),
      });
    }

    if (!rec.text) continue; // silinmiş: sadece kapat, yeniden yazma

    const font = await getFont(rec.font, rec.bold);
    const size = rec.size;
    const lines = rec.text.split('\n');
    const lineH = size * 1.25;
    const x = rec.meta.x + rec.dx;
    const yBase = rec.meta.yBase + rec.dy;
    const color = hexToRgb(rec.color);
    // İtalik: ayrı italik TTF taşımak yerine harf eğimiyle (shear) benzetilir —
    // tarayıcı önizlemesindeki sentetik italikle aynı yaklaşım. PDF metin
    // matrisinde harfleri sağa yatıran bileşen ySkew'dur (xSkew satır TABANINI
    // yatırır — canlı denemede yanlış eksen olduğu görüldü).
    const skew = rec.italic ? degrees(12) : undefined;

    lines.forEach((line, i) => {
      if (!line) return;
      const y = yBase - i * lineH;
      const w = font.widthOfTextAtSize(line, size);
      if (rec.fillBg) {
        page.drawRectangle({
          x: x - 1.5, y: y - size * 0.26, width: w + 3, height: size * 1.32,
          color: hexToRgb(rec.fillBg),
        });
      }
      page.drawText(line, { x, y, size, font, color, ySkew: skew });
      // Altı/üstü çizili: metin rengiyle ince şeritler
      const lineThickness = Math.max(0.5, size * 0.055);
      if (rec.underline) {
        page.drawRectangle({ x, y: y - size * 0.16, width: w, height: lineThickness, color });
      }
      if (rec.strike) {
        page.drawRectangle({ x, y: y + size * 0.27, width: w, height: lineThickness, color });
      }
    });
  }

  // ---- Görseller (otomatik algılanan logolar/resimler) ----
  const imgCache = new Map();
  for (const [key, rec] of areas.entries()) {
    const page = doc.getPage(rec.meta.page);

    page.drawRectangle({
      x: rec.meta.x - 0.5,
      y: rec.meta.y - 0.5,
      width: rec.meta.w + 1,
      height: rec.meta.h + 1,
      color: hexToRgb(rec.bg),
    });

    if (rec.hidden || !rec.png) continue; // png henüz kırpılmadıysa (nadir yarış durumu) yalnızca kapat

    let img = imgCache.get(key);
    if (!img) {
      img = await doc.embedPng(rec.png);
      imgCache.set(key, img);
    }
    const w = rec.meta.w * rec.scale;
    const h = rec.meta.h * rec.scale;
    const x = rec.meta.x + rec.dx + (rec.meta.w - w) / 2;
    const y = rec.meta.y + rec.dy + (rec.meta.h - h) / 2;
    page.drawImage(img, { x, y, width: w, height: h });
  }

  return doc.save();
}
