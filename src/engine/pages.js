// Sayfa düzeyi işlemler (yeniden sırala / döndür / sil) — PDF içeriği
// (metin/görsel) DÜZENLEMESİNDEN TAMAMEN AYRI, saf bir katman.
//
// KASITLI SIRALAMA KARARI: main.js bu işlemi kullanıcı bir PDF AÇAR AÇMAZ,
// herhangi bir metin/görsel düzenlemesi başlamadan ÖNCE uygular ve sonucu
// (yeni bayt dizisini) normal openPdf() akışına verir. Böylece pdfview.js/
// state.js'teki TÜM `meta.page` indeks varsayımları bozulmadan kalır — sayfa
// silindiğinde/taşındığında var olan bir düzenlemenin hangi sayfaya ait
// olduğunu yeniden hesaplamak gerekmiyor, çünkü düzenleme o an henüz
// başlamamış oluyor.
import { PDFDocument, degrees } from 'pdf-lib';

/**
 * @param {Uint8Array} bytes - orijinal PDF baytları
 * @param {Array<{originalIndex:number, rotate?:0|90|180|270}>} order
 *   Yeni sayfa sırası. `order`'da GEÇMEYEN orijinal sayfalar SİLİNMİŞ sayılır.
 *   `rotate`, sayfanın MEVCUT döndürmesine EKLENİR (mutlak açı değil, delta).
 * @returns {Promise<Uint8Array>}
 */
export async function applyPageOperations(bytes, order) {
  if (!order.length) {
    throw new Error('En az bir sayfa kalmalı — hepsi silinemez.');
  }
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();

  const copied = await out.copyPages(src, order.map((o) => o.originalIndex));
  copied.forEach((page, i) => {
    const delta = order[i].rotate || 0;
    if (delta) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + delta) % 360));
    }
    out.addPage(page);
  });

  return out.save();
}

/**
 * Bir PDF'in sayfa sayısını, hiçbir başka işlem yapmadan öğrenmek için
 * hafif bir yardımcı (küçük-resim/sayfa listesi UI'ı bunu kullanır).
 * @param {Uint8Array} bytes
 * @returns {Promise<number>}
 */
export async function getPageCount(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}
