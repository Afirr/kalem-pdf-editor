// Düzeltmeleri PDF'e işleme: orijinal metnin üstü zemin rengiyle kapatılır,
// yeni metin Türkçe destekli gömülü fontla aynı konuma yazılır.
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

export async function bake(bytes, edits) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);

  const cache = {};
  const getFont = async (serif, bold) => {
    const key = (serif ? 'serif' : 'sans') + (bold ? '-bold' : '');
    if (!cache[key]) {
      const res = await fetch(FONT_FILES[key]);
      if (!res.ok) throw new Error(`Font yüklenemedi: ${FONT_FILES[key]}`);
      cache[key] = await doc.embedFont(await res.arrayBuffer(), { subset: true });
    }
    return cache[key];
  };

  for (const edit of edits.values()) {
    const page = doc.getPage(edit.meta.page);
    const font = await getFont(edit.serif, edit.bold);
    const size = edit.size;
    const lines = edit.text.split('\n');
    const lineH = size * 1.25;

    let textW = 0;
    for (const line of lines) {
      textW = Math.max(textW, font.widthOfTextAtSize(line, size));
    }
    const coverW = Math.max(edit.meta.w, textW) + 3;
    const coverH = size * 1.32 + (lines.length - 1) * lineH;

    page.drawRectangle({
      x: edit.meta.x - 1.5,
      y: edit.meta.yBase - size * 0.28 - (lines.length - 1) * lineH,
      width: coverW,
      height: coverH,
      color: hexToRgb(edit.bg),
    });

    lines.forEach((line, i) => {
      if (!line) return;
      page.drawText(line, {
        x: edit.meta.x,
        y: edit.meta.yBase - i * lineH,
        size,
        font,
        color: hexToRgb(edit.color),
      });
    });
  }

  return doc.save();
}
