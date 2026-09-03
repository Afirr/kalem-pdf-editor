import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { applyPageOperations, getPageCount } from './pages.js';

async function makeTestPdf(pageLabels) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of pageLabels) {
    const page = doc.addPage([200, 200]);
    page.drawText(label, { x: 20, y: 100, size: 20, font });
  }
  return doc.save();
}

describe('getPageCount', () => {
  it('gerçek sayfa sayısını döner', async () => {
    const bytes = await makeTestPdf(['A', 'B', 'C']);
    expect(await getPageCount(bytes)).toBe(3);
  });
});

describe('applyPageOperations', () => {
  it('sayfaları verilen sırayla yeniden düzenler', async () => {
    const bytes = await makeTestPdf(['A', 'B', 'C']);
    const out = await applyPageOperations(bytes, [
      { originalIndex: 2 },
      { originalIndex: 0 },
      { originalIndex: 1 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
  });

  it('order dizisinde olmayan sayfaları siler', async () => {
    const bytes = await makeTestPdf(['A', 'B', 'C']);
    const out = await applyPageOperations(bytes, [
      { originalIndex: 0 },
      { originalIndex: 2 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
  });

  it('tek sayfa bırakmak (2 sayfa silmek) çalışır', async () => {
    const bytes = await makeTestPdf(['A', 'B', 'C']);
    const out = await applyPageOperations(bytes, [{ originalIndex: 1 }]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  });

  it('hiç sayfa kalmazsa hata fırlatır (hepsi silinemez)', async () => {
    const bytes = await makeTestPdf(['A', 'B']);
    await expect(applyPageOperations(bytes, [])).rejects.toThrow();
  });

  it('rotate delta mevcut döndürmeye eklenir (mutlak değil)', async () => {
    const bytes = await makeTestPdf(['A']);
    // Once 90 derece dondur, sonra 90 derece daha -> toplam 180 olmali.
    const once = await applyPageOperations(bytes, [{ originalIndex: 0, rotate: 90 }]);
    const twice = await applyPageOperations(once, [{ originalIndex: 0, rotate: 90 }]);
    const doc = await PDFDocument.load(twice);
    expect(doc.getPage(0).getRotation().angle).toBe(180);
  });

  it('rotate verilmezse (0/undefined) mevcut döndürme korunur', async () => {
    const bytes = await makeTestPdf(['A']);
    const rotated = await applyPageOperations(bytes, [{ originalIndex: 0, rotate: 90 }]);
    const untouched = await applyPageOperations(rotated, [{ originalIndex: 0 }]);
    const doc = await PDFDocument.load(untouched);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it('aynı orijinal sayfa birden fazla kez kullanılabilir (kopyala)', async () => {
    const bytes = await makeTestPdf(['A', 'B']);
    const out = await applyPageOperations(bytes, [
      { originalIndex: 0 },
      { originalIndex: 0 },
      { originalIndex: 1 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
  });
});
