// Görsel (logo/resim) otomatik algılama — pdf.js page nesnesi ve düz JS
// matematiği dışında hiçbir bağımlılığı yok (document/window kullanılmaz).
// Operatör listesini CTM yığınıyla tarar; her paintImageXObject çağrısının birim
// karesini (0,0)-(1,1) CTM ile PDF nokta uzayına dönüştürüp sınır kutusunu bulur.
// Üst üste binen kutular (ör. bir fotoğraf + üzerine çizilmiş maske) tek nesneye
// birleştirilir; aksi hâlde kullanıcı aynı görsel için birden fazla, çakışan
// seçilebilir alan görür.
import * as pdfjsLib from 'pdfjs-dist';

export function mulMat(s, c) {
  return [
    s[0] * c[0] + s[1] * c[2], s[0] * c[1] + s[1] * c[3],
    s[2] * c[0] + s[3] * c[2], s[2] * c[1] + s[3] * c[3],
    s[4] * c[0] + s[5] * c[2] + c[4], s[4] * c[1] + s[5] * c[3] + c[5],
  ];
}

// Kesişim / birleşim oranı (0-1): iki dikdörtgenin ne kadar aynı yeri kapladığını ölçer.
export function rectIou(a, b) {
  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
export function unionRect(a, b) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// Sayfadaki gerçek metin satırlarının sınır kutuları (PDF'in kendi, alttan
// yukarı artan koordinat uzayında — detectImageRegions'ın ürettiği bölgelerle
// aynı uzay). Döndürülmüş metin desteklenmiyor (renderTextItem ile tutarlı).
export function textBoxesFromItems(items) {
  const boxes = [];
  for (const it of items || []) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue;
    const fs = Math.abs(d) || Math.abs(a);
    if (!fs || !it.width) continue;
    boxes.push({ x: e, y: f - fs * 0.29, w: it.width, h: fs * 1.16 });
  }
  return boxes;
}

// Bir görsel bölgesini, üstüne/altına/kenarına taşan gerçek metin
// satırlarının dışında kalacak PARÇALARA böler (kırpıp atmaz — hiçbir görsel
// piksel kaybolmaz, yalnızca metnin bulunduğu şerit iki ayrı öğeye ayrılır).
// Böylece bir başlığın arkasındaki dekoratif bant gibi bir görsel, üstündeki
// gerçek metni "yutmaz" (aksi hâlde görsel taşındığında metin de onunla
// birlikte sürüklenmiş gibi görünür) VE metnin öbür tarafında kalan görsel
// içeriği de kaybolmaz — o da kendi başına seçilebilir bir parça olarak kalır.
export function splitRegionAroundText(region, textBoxes) {
  let pieces = [region];
  for (const t of textBoxes) {
    const next = [];
    for (const r of pieces) {
      const ox = Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x);
      const oy = Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y);
      if (ox <= 0 || oy <= 0) { next.push(r); continue; } // örtüşme yok
      if (oy <= ox) {
        // metin bölgeyi enine kesiyor (bir başlık satırı gibi): üst/alt parçaya böl
        if (t.y + t.h < r.y + r.h) {
          const nh = (r.y + r.h) - (t.y + t.h);
          if (nh > 4) next.push({ x: r.x, y: t.y + t.h, w: r.w, h: nh });
        }
        if (t.y > r.y) {
          const nh = t.y - r.y;
          if (nh > 4) next.push({ x: r.x, y: r.y, w: r.w, h: nh });
        }
      } else {
        // metin bölgeyi boyuna kesiyor: sol/sağ parçaya böl
        if (t.x + t.w < r.x + r.w) {
          const nw = (r.x + r.w) - (t.x + t.w);
          if (nw > 4) next.push({ x: t.x + t.w, y: r.y, w: nw, h: r.h });
        }
        if (t.x > r.x) {
          const nw = t.x - r.x;
          if (nw > 4) next.push({ x: r.x, y: r.y, w: nw, h: r.h });
        }
      }
    }
    pieces = next;
  }
  return pieces;
}

// Yalnız neredeyse AYNI yeri kaplayan (IOU yüksek) kutuları tek bölgeye
// birleştirir — ör. bir fotoğraf + üzerine tam oturan bir maske/parlaklık
// katmanı. Salt "kutular değiyor" yeterli DEĞİL: bir logo görseli çoğu zaman
// çok daha büyük bir arka plan fotoğrafının/dokusunun üstüne biner ve
// kutuları örtüşür, ama ikisi ayrı, ayrı ayrı seçilebilir öğeler olmalı —
// düşük IOU'da birleştirmek logoyu arka plana "kaynaklar" (kullanıcı logoyu
// taşımaya çalıştığında altındaki fotoğrafın bir parçasını da sürüklemiş gibi
// görünür).
export function mergeOverlapping(rects) {
  const list = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (rectIou(list[i], list[j]) >= 0.5) {
          const u = unionRect(list[i], list[j]);
          list.splice(j, 1);
          list.splice(i, 1);
          list.push(u);
          merged = true;
          break;
        }
      }
    }
  }
  return list;
}

const imageRegionCache = new WeakMap(); // pdf.js page nesnesi -> Promise<bölgeler>

export function detectImageRegions(page, textItems) {
  if (imageRegionCache.has(page)) return imageRegionCache.get(page);
  const promise = (async () => {
    const OPS = pdfjsLib.OPS;
    const { fnArray, argsArray } = await page.getOperatorList();
    const strokeOps = new Set([OPS.stroke, OPS.closeStroke]);
    const fillOps = new Set([
      OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
      OPS.closeFillStroke, OPS.closeEOFillStroke,
    ]);
    // Doldur+çizgi (fillStroke vb.) birleşik operatörlerin de görünür bir
    // çizgi bileşeni var — yalnız saf "stroke"da değil, bunlarda da kalınlık
    // payı uygulanmazsa çizginin dış kenarı kalıntı olarak kalır.
    const hasVisibleStroke = new Set([
      OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke,
      OPS.closeFillStroke, OPS.closeEOFillStroke,
    ]);
    let ctm = [1, 0, 0, 1, 0, 0];
    const ctmStack = [];
    let lineWidth = 1; // PDF varsayılanı; OPS.setLineWidth ile güncellenir
    const rawImages = [];
    const rawStrokes = [];
    // Tasarım araçları (Figma/Canva vb.) bir görseli ve etrafına çizdiği
    // dekoratif halka/çerçeve/köşe süsünü genelde tek bir "Figure" işaretli-
    // içerik (marked content) bloğunda dışa aktarır. Bu grup bilgisini
    // kullanmak, salt geometrik yakınlık tahmininden çok daha güvenilir.
    const figureStack = [];
    const figureRegions = [];

    const bboxFromMinMax = (minMax) => {
      const [mx0, my0, mx1, my1] = minMax;
      const c = [[mx0, my0], [mx1, my0], [mx0, my1], [mx1, my1]].map(([x, y]) => [
        ctm[0] * x + ctm[2] * y + ctm[4],
        ctm[1] * x + ctm[3] * y + ctm[5],
      ]);
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    };

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      if (fn === OPS.save) { ctmStack.push({ ctm, lineWidth }); continue; }
      if (fn === OPS.restore) { ({ ctm, lineWidth } = ctmStack.pop() || { ctm, lineWidth }); continue; }
      if (fn === OPS.transform) { ctm = mulMat(argsArray[i], ctm); continue; }
      if (fn === OPS.setLineWidth) { lineWidth = argsArray[i][0]; continue; }
      if (fn === OPS.setGState) {
        // Çizgi kalınlığı doğrudan "w" operatörü yerine ExtGState ("gs") üzerinden
        // "LW" anahtarıyla da ayarlanabilir — tasarım araçlarının dışa aktardığı
        // PDF'lerde bu yaygın.
        const entry = argsArray[i][0]?.find(([k]) => k === 'LW');
        if (entry) lineWidth = entry[1];
        continue;
      }

      if (fn === OPS.beginMarkedContentProps || fn === OPS.beginMarkedContent) {
        // Yığın her zaman itilir (etiket ne olursa olsun) ki EMC ile derinlik
        // senkron kalsın; yalnızca "Figure" için gerçek bir çerçeve tutulur.
        figureStack.push(argsArray[i]?.[0] === 'Figure' ? { rects: [] } : null);
        continue;
      }
      if (fn === OPS.endMarkedContent) {
        const frame = figureStack.pop();
        if (frame && frame.rects.length) {
          const u = frame.rects.reduce(unionRect);
          if (u.w > 4 && u.h > 4) figureRegions.push(u);
        }
        continue;
      }

      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [
          ctm[0] * x + ctm[2] * y + ctm[4],
          ctm[1] * x + ctm[3] * y + ctm[5],
        ]);
        const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        const r = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
        if (r.w > 4 && r.h > 4) {
          rawImages.push(r);
          figureStack[figureStack.length - 1]?.rects.push(r);
        }
        continue;
      }

      if (fn === OPS.constructPath) {
        // args: [boyaOperatörü, alt-yol verisi, minMax] — pdf.js her yolun
        // sınır kutusunu zaten hesaplayıp veriyor. minMax, YOLUN kendisinin
        // (çizginin orta hattının) sınırıdır; çizili çizgi bunun ötesine de
        // taşar, o yüzden çizgilerde kalınlığın yarısı kadar payla genişletiyoruz
        // — aksi hâlde nesne taşınınca eski yerde ince bir kalıntı kalır.
        const [pathOp, , minMax] = argsArray[i];
        if (!minMax || (!strokeOps.has(pathOp) && !fillOps.has(pathOp))) continue;
        let r = bboxFromMinMax(minMax);
        if (r.w <= 2 || r.h <= 2) continue;
        if (hasVisibleStroke.has(pathOp)) {
          const scale = (Math.hypot(ctm[0], ctm[1]) + Math.hypot(ctm[2], ctm[3])) / 2;
          // Yarım çizgi kalınlığı + kenar yumuşatmanın (anti-aliasing) taşırdığı
          // birkaç pikseli de yutacak sabit bir güvenlik payı.
          const pad = Math.max(1, (lineWidth / 2) * scale) + 1;
          r = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
        }
        const top = figureStack[figureStack.length - 1];
        if (top) {
          top.rects.push(r); // aktif bir Figure'ın parçası: onun bölgesine katılır
        } else if (strokeOps.has(pathOp)) {
          rawStrokes.push(r); // Figure dışı çizgi: yalnız IOU ile eşleşirse birleştirilir (yedek yöntem)
        }
        // Not: Figure dışı, tek başına küçük dolgu/çizgi şekillerini bağımsız bir
        // görsel adayı sayma denemesi (ör. küçük ikonlar) geri alındı — boyut
        // sezgisiyle "dekoratif sembol" ile "vektöre çevrilmiş metin karakteri"
        // güvenilir ayırt edilemiyor; gerçek bir belgede paragraf metninin her
        // birkaç harfi ayrı, gereksiz seçilebilir bir "görsel" hâline geliyordu.
      }
    }

    for (const r of figureRegions) rawImages.push(r);

    // İşaretli-içerik yapısı olmayan belgeler için geometrik yedek: bir görselle
    // neredeyse aynı yeri kaplayan (IOU yüksek) çizgi-yolları da katılır. Eşik
    // yüksek tutulur: sayfadaki uzak/büyük bir kart çerçevesi yanlışlıkla
    // görsele eklenip alanı büyütmesin.
    const baseImages = rawImages.slice();
    for (const st of rawStrokes) {
      for (const im of baseImages) {
        if (rectIou(st, im) < 0.6) continue;
        rawImages.push(st); // st, çizgi kalınlığı payı zaten eklenmiş hâlde
        break;
      }
    }
    const merged = mergeOverlapping(rawImages);

    // Bir görsel bölgesi (ör. bir başlığın arkasındaki dekoratif bant/leke
    // grafiği), gerçek bir metin satırının bulunduğu alanı da kapsayabilir —
    // bu durumda metin, görselin yakalanan pikseline "gömülü" kalır: görsel
    // taşındığında metin de onunla birlikte gitmiş GİBİ görünür (aslında
    // sadece o pikselin bir parçası olmuştur). Böyle bir çakışma varsa görsel
    // bölgesini metnin iki yanında kalan PARÇALARA bölüyoruz — kırpıp atmıyoruz,
    // aksi hâlde metnin öbür tarafındaki gerçek görsel içeriği de kaybolur ve
    // görsel "yarım kesilmiş" gibi görünür.
    const textBoxes = textBoxesFromItems(textItems);
    if (!textBoxes.length) return merged;
    return merged.flatMap((r) => splitRegionAroundText(r, textBoxes));
  })();
  imageRegionCache.set(page, promise);
  return promise;
}
