// PDF görüntüleme: pdf.js ile sayfa çizimi + metin/görsel katmanlarının çizimi.
// Görseller, operatör listesi (paintImageXObject) taranarak otomatik algılanır —
// kullanıcının elle bir alan seçmesine gerek yoktur.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { state, textKey, imageKey } from './state.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(bytes, name) {
  if (state.doc) {
    try { await state.doc.destroy(); } catch { /* önemsiz */ }
  }
  state.bytes = new Uint8Array(bytes);
  state.name = name;
  state.doc = await pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
}

export function fitScale(containerWidth) {
  return Math.min(1.6, Math.max(0.5, containerWidth / 630));
}

let renderGen = 0; // üst üste çağrılar yarışmasın diye
export async function renderAll(container) {
  const gen = ++renderGen;
  const doc = state.doc;
  container.innerHTML = '';
  state.itemRefs.clear();
  state.pageInfos.clear();
  for (let p = 1; p <= doc.numPages; p++) {
    if (gen !== renderGen || doc !== state.doc) return; // yeni bir çizim başladı
    await renderPage(p, container, doc);
  }
}

async function renderPage(num, container, doc) {
  const pageIdx = num - 1;
  const page = await doc.getPage(num);
  const vp = page.getViewport({ scale: state.scale });
  const vp1 = page.getViewport({ scale: 1 });
  const pdfH = vp1.height;
  const pdfW = vp1.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.dataset.page = String(pageIdx);
  wrap.style.width = `${vp.width}px`;
  wrap.style.height = `${vp.height}px`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = `${vp.width}px`;
  canvas.style.height = `${vp.height}px`;
  wrap.appendChild(canvas);

  const pageNo = document.createElement('div');
  pageNo.className = 'page-num';
  pageNo.textContent = num;
  wrap.appendChild(pageNo);

  wrap.addEventListener('mousedown', (ev) => {
    if (ev.target === wrap || ev.target === canvas || ev.target === pageNo) {
      state.onPageMouseDown?.(pageIdx, wrap, ev);
    }
  });

  container.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;

  const pageInfo = { canvas, dpr, pdfH, pdfW, scale: state.scale, wrap, page: pageIdx };
  state.pageInfos.set(pageIdx, pageInfo);

  // ---- Metin öğeleri ----
  const tc = await page.getTextContent();
  const fontInfo = {};
  for (const fn of new Set(tc.items.map((i) => i.fontName))) {
    let realName = '';
    try { realName = page.commonObjs.get(fn)?.name || ''; } catch { /* henüz yüklenmemiş */ }
    const fam = tc.styles[fn]?.fontFamily || 'sans-serif';
    fontInfo[fn] = {
      bold: /bold|black|heavy|semi|extrab/i.test(realName),
      serif: /serif/i.test(fam) && !/sans/i.test(fam),
    };
  }

  tc.items.forEach((it, index) => {
    if (!it.str || !it.str.trim()) return;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) return; // döndürülmüş metin desteklenmiyor
    const fs = Math.abs(d) || Math.abs(a);
    if (!fs || !it.width) return;

    const meta = {
      page: pageIdx, index, str: it.str, x: e, yBase: f, w: it.width, fs,
      bold: fontInfo[it.fontName]?.bold || false,
      serif: fontInfo[it.fontName]?.serif || false,
    };
    renderTextItem(wrap, pageInfo, meta);
  });

  // ---- Kullanıcının "Metin Ekle" ile eklediği metin kutuları ----
  (state.customTexts.get(pageIdx) || []).forEach((meta) => renderTextItem(wrap, pageInfo, meta));

  // ---- Görsel öğeleri (otomatik algılanan) ----
  const regions = await detectImageRegions(page, tc.items);
  regions.forEach((region, index) => {
    const meta = { page: pageIdx, index, x: region.x, y: region.y, w: region.w, h: region.h };
    renderImageItem(wrap, pageInfo, meta);
  });

  // ---- Katman panelinden "Birleştir" ile oluşturulan görsel bölgeler ----
  (state.customAreas.get(pageIdx) || []).forEach((meta) => renderImageItem(wrap, pageInfo, meta));
}

// ---------- Görsel (logo/resim) otomatik algılama ----------
// Operatör listesini CTM yığınıyla tarar; her paintImageXObject çağrısının birim
// karesini (0,0)-(1,1) CTM ile PDF nokta uzayına dönüştürüp sınır kutusunu bulur.
// Üst üste binen kutular (ör. bir fotoğraf + üzerine çizilmiş maske) tek nesneye
// birleştirilir; aksi hâlde kullanıcı aynı görsel için birden fazla, çakışan
// seçilebilir alan görür.
function mulMat(s, c) {
  return [
    s[0] * c[0] + s[1] * c[2], s[0] * c[1] + s[1] * c[3],
    s[2] * c[0] + s[3] * c[2], s[2] * c[1] + s[3] * c[3],
    s[4] * c[0] + s[5] * c[2] + c[4], s[4] * c[1] + s[5] * c[3] + c[5],
  ];
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
// Kesişim / birleşim oranı (0-1): iki dikdörtgenin ne kadar aynı yeri kapladığını ölçer.
function rectIou(a, b) {
  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
function unionRect(a, b) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// Sayfadaki gerçek metin satırlarının sınır kutuları (PDF'in kendi, alttan
// yukarı artan koordinat uzayında — detectImageRegions'ın ürettiği bölgelerle
// aynı uzay). Döndürülmüş metin desteklenmiyor (renderTextItem ile tutarlı).
function textBoxesFromItems(items) {
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
// satırlarının dışında kalacak şekilde daraltır; metin bölgeyi neredeyse
// tümüyle kaplıyorsa bölgeyi tümden eler (null). Böylece bir başlığın
// arkasındaki dekoratif bant gibi bir görsel, üstündeki gerçek metni
// "yutmaz" — aksi hâlde görsel taşındığında metin de onunla birlikte
// sürüklenmiş gibi görünür (aslında yalnızca yakalanan pikselin parçası olur).
function trimRegionAgainstText(region, textBoxes) {
  let { x, y, w, h } = region;
  for (const t of textBoxes) {
    const ox = Math.min(x + w, t.x + t.w) - Math.max(x, t.x);
    const oy = Math.min(y + h, t.y + t.h) - Math.max(y, t.y);
    if (ox <= 0 || oy <= 0) continue;
    if (oy <= ox) {
      // metin bölgeyi enine kaplıyor (bir başlık satırı gibi): dikeyde kırp
      if (t.y + t.h / 2 > y + h / 2) h = Math.min(h, Math.max(0, t.y - y));
      else { const newY = t.y + t.h; h = Math.max(0, (y + h) - newY); y = newY; }
    } else {
      // metin bölgeyi boyuna kaplıyor: yatayda kırp
      if (t.x + t.w / 2 > x + w / 2) w = Math.min(w, Math.max(0, t.x - x));
      else { const newX = t.x + t.w; w = Math.max(0, (x + w) - newX); x = newX; }
    }
    if (w <= 4 || h <= 4) return null;
  }
  return { x, y, w, h };
}

function mergeOverlapping(rects) {
  const list = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (rectsOverlap(list[i], list[j])) {
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

function detectImageRegions(page, textItems) {
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
    // sadece o pikselin bir parçası olmuştur). Böyle bir çakışma varsa
    // görsel bölgesini gerçek metnin dışında kalacak şekilde daraltıyoruz.
    const textBoxes = textBoxesFromItems(textItems);
    if (!textBoxes.length) return merged;
    return merged
      .map((r) => trimRegionAgainstText(r, textBoxes))
      .filter(Boolean);
  })();
  imageRegionCache.set(page, promise);
  return promise;
}

// ---------- Ortak yardımcılar ----------
function positionAt(el, xPt, topPt, wPt, hPt, s) {
  el.style.left = `${xPt * s - 2}px`;
  el.style.top = `${topPt * s - 1}px`;
  el.style.minWidth = `${wPt * s + 4}px`;
  el.style.minHeight = `${hPt * s + 2}px`;
}
function setRect(el, r) {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}
function attachPointer(el, key, handler) {
  el.dataset.key = key;
  el.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
    handler(ev, el);
  });
}
function makeHandles(wrap, key, rect, onDown) {
  const corners = [
    ['nw', rect.left, rect.top],
    ['ne', rect.left + rect.width, rect.top],
    ['sw', rect.left, rect.top + rect.height],
    ['se', rect.left + rect.width, rect.top + rect.height],
  ];
  for (const [corner, cx, cy] of corners) {
    const h = document.createElement('div');
    h.className = `rhandle ${corner}`;
    h.dataset.key = key;
    h.style.left = `${cx}px`;
    h.style.top = `${cy}px`;
    h.addEventListener('mousedown', (ev) => { ev.stopPropagation(); onDown(ev); });
    wrap.appendChild(h);
  }
}
// Seçili bir öğenin tüm çevresel arayüzünü (tutamaçlar + sil düğmesi) tek seferde ekler.
function makeSelectionChrome(wrap, key, rect, onResizeDown) {
  makeHandles(wrap, key, rect, onResizeDown);
  makeKillButton(wrap, key, rect);
}
function makeKillButton(wrap, key, rect) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'kill-btn';
  btn.title = 'Bu öğeyi sil';
  btn.dataset.key = key;
  btn.textContent = '×';
  btn.style.left = `${rect.left + rect.width}px`;
  btn.style.top = `${rect.top}px`;
  btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    state.onDeleteClick?.(key);
  });
  wrap.appendChild(btn);
}

// Bir metin kutusunun geçerli (rec varsa taşınmış/boyutlanmış, yoksa orijinal) ekran
// dikdörtgeni — hem çizim hem de yeniden-boyutlandırma sürüklemesinin başlangıç
// merkezini hesaplamak için main.js tarafından da kullanılır.
export function textBoxScreenRect(meta, rec, pageInfo) {
  const s = pageInfo.scale;
  const size = rec ? rec.size : meta.fs;
  const dx = rec ? rec.dx : 0;
  const dy = rec ? rec.dy : 0;
  const ratio = size / meta.fs;
  const left = (meta.x + dx) * s;
  const topPdf = pageInfo.pdfH - (meta.yBase + dy) - size * 0.87;
  return { left, top: topPdf * s, width: meta.w * ratio * s, height: size * 1.16 * s };
}

// Bir görselin geçerli ekran dikdörtgeni (merkezden ölçekli).
export function imageBoxScreenRect(meta, rec, pageInfo) {
  const s = pageInfo.scale;
  const scale = rec ? rec.scale : 1;
  const dx = rec ? rec.dx : 0;
  const dy = rec ? rec.dy : 0;
  const w = meta.w * scale;
  const h = meta.h * scale;
  const x = meta.x + dx + (meta.w - w) / 2;
  const y = meta.y + dy + (meta.h - h) / 2;
  const topPdf = pageInfo.pdfH - y - h;
  return { left: x * s, top: topPdf * s, width: w * s, height: h * s };
}

// ---------- Metin öğesi ----------
export function renderTextItem(wrap, pageInfo, meta) {
  const key = textKey(meta.page, meta.index);
  const s = pageInfo.scale;
  const fullMeta = { ...meta, canvas: pageInfo.canvas, pxScale: s * pageInfo.dpr, pdfH: pageInfo.pdfH };
  state.itemRefs.set(key, { kind: 'text', wrap, pageInfo, fullMeta, meta });

  const editing = state.editingKey === key;
  const rec = state.textEdits.get(key) || (editing ? state.editingDraft : null);
  const selected = state.selected.has(key);

  if (!rec) {
    const hit = document.createElement('div');
    hit.className = 'titem' + (selected ? ' selected' : '');
    hit.title = 'Düzenlemek için tıkla';
    positionAt(hit, meta.x, pageInfo.pdfH - meta.yBase - meta.fs * 0.87, meta.w, meta.fs * 1.16, s);
    hit.style.paddingBottom = `${meta.fs * 0.18 * s}px`;
    attachPointer(hit, key, (ev) => state.onTextPointerDown?.(fullMeta, key, hit, ev));
    wrap.appendChild(hit);
    if (selected) makeSelectionChrome(wrap, key, textBoxScreenRect(meta, null, pageInfo), (ev) => state.onResizeHandleDown?.(key, ev));
    return;
  }

  const cover = document.createElement('div');
  cover.className = 'tcover' + (selected ? ' selected' : '');
  cover.dataset.key = key;
  positionAt(cover, meta.x, pageInfo.pdfH - meta.yBase - meta.fs * 0.87, meta.w, meta.fs * 1.16, s);
  cover.style.background = rec.bg;
  if (!editing) {
    cover.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      state.onTextPointerDown?.(fullMeta, key, cover, ev);
    });
  }
  wrap.appendChild(cover);

  if (rec.text || editing) {
    const content = document.createElement('div');
    content.className = 'titem edited' + (selected ? ' selected' : '');
    content.dataset.key = key;
    const left = meta.x + rec.dx;
    const topPdf = pageInfo.pdfH - (meta.yBase + rec.dy) - rec.size * 0.87;
    positionAt(content, left, topPdf, meta.w, rec.size * 1.16, s);
    content.style.paddingBottom = `${rec.size * 0.18 * s}px`;
    content.style.background = rec.bg;
    content.style.color = rec.color;
    content.style.fontSize = `${rec.size * s}px`;
    content.style.fontFamily = rec.serif
      ? 'Georgia, "Times New Roman", serif'
      : 'Arial, Helvetica, sans-serif';
    content.style.fontWeight = rec.bold ? '700' : '400';
    content.style.width = 'max-content';
    content.style.whiteSpace = 'pre';
    content.textContent = rec.text;
    if (editing) {
      content.contentEditable = 'true';
      content.spellcheck = false;
    } else {
      content.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        state.onTextPointerDown?.(fullMeta, key, content, ev);
      });
    }
    wrap.appendChild(content);
  }

  if (selected) makeSelectionChrome(wrap, key, textBoxScreenRect(meta, rec, pageInfo), (ev) => state.onResizeHandleDown?.(key, ev));
}

export function refreshTextItem(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
  renderTextItem(ref.wrap, ref.pageInfo, ref.meta);
}

// ---------- Görsel (logo/resim) öğesi ----------
export function renderImageItem(wrap, pageInfo, meta) {
  const key = imageKey(meta.page, meta.index);
  state.itemRefs.set(key, { kind: 'image', wrap, pageInfo, meta });
  const rec = state.areas.get(key);
  const selected = state.selected.has(key);

  if (!rec) {
    const hit = document.createElement('div');
    hit.className = 'aitem-hit' + (selected ? ' selected' : '');
    hit.title = 'Seç, sürükle veya köşeden büyüt';
    setRect(hit, imageBoxScreenRect(meta, null, pageInfo));
    attachPointer(hit, key, (ev) => state.onImagePointerDown?.(meta, key, hit, ev));
    wrap.appendChild(hit);
    if (selected) makeSelectionChrome(wrap, key, imageBoxScreenRect(meta, null, pageInfo), (ev) => state.onResizeHandleDown?.(key, ev));
    return;
  }

  const originalRect = imageBoxScreenRect(meta, null, pageInfo);
  const cover = document.createElement('div');
  cover.className = 'acover' + (selected && rec.hidden ? ' selected' : '');
  setRect(cover, originalRect);
  cover.style.background = rec.bg;
  attachPointer(cover, key, (ev) => state.onImagePointerDown?.(meta, key, cover, ev));
  wrap.appendChild(cover);

  if (!rec.hidden) {
    const rect = imageBoxScreenRect(meta, rec, pageInfo);
    const content = document.createElement('div');
    content.className = 'aitem' + (selected ? ' selected' : '');
    setRect(content, rect);
    if (rec.url) {
      const img = document.createElement('img');
      img.draggable = false;
      img.src = rec.url;
      img.alt = '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.display = 'block';
      content.appendChild(img);
    } else {
      content.style.background = rec.bg; // kırpma henüz tamamlanmadı: kısa süreliğine zemin rengiyle doldur
    }
    attachPointer(content, key, (ev) => state.onImagePointerDown?.(meta, key, content, ev));
    wrap.appendChild(content);
    if (selected) makeSelectionChrome(wrap, key, rect, (ev) => state.onResizeHandleDown?.(key, ev));
  } else if (selected) {
    makeSelectionChrome(wrap, key, originalRect, (ev) => state.onResizeHandleDown?.(key, ev));
  }
}

export function refreshImageItem(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
  renderImageItem(ref.wrap, ref.pageInfo, ref.meta);
}

// Tür ayrımı gözetmeden doğru yeniden çizimi tetikler (seçim/sürükleme/boyutlandırma
// gibi tüm main.js akışlarının tek giriş noktası).
export function refreshItem(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  if (ref.kind === 'text') refreshTextItem(key);
  else refreshImageItem(key);
}

// ---------- Geometri & renk yardımcıları ----------

// Ekran (CSS px, sayfa köşesine göre) dikdörtgenini PDF nokta uzayına çevirir (sol-alt köşe standardı)
export function screenRectToPdf(pageInfo, leftPx, topPx, wPx, hPx) {
  const s = pageInfo.scale;
  return {
    x: leftPx / s,
    y: pageInfo.pdfH - (topPx + hPx) / s,
    w: wPx / s,
    h: hPx / s,
  };
}

// Sayfanın render edilmiş tuvalinden bir bölgeyi PNG olarak kırpar
export async function cropToPng(pageInfo, leftPx, topPx, wPx, hPx) {
  const dpr = pageInfo.dpr;
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(wPx * dpr));
  off.height = Math.max(1, Math.round(hPx * dpr));
  off.getContext('2d').drawImage(
    pageInfo.canvas,
    leftPx * dpr, topPx * dpr, wPx * dpr, hPx * dpr,
    0, 0, off.width, off.height,
  );
  const blob = await new Promise((res) => off.toBlob(res, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, w: off.width, h: off.height, blob };
}

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function samplePixel(ctx, canvas, x, y) {
  x = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
  y = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
  return ctx.getImageData(x, y, 1, 1).data;
}

// Bir dikdörtgenin hemen dışından en sık görülen zemin rengini örnekler
export function sampleBgAround(pageInfo, leftPx, topPx, wPx, hPx) {
  const dpr = pageInfo.dpr;
  const ctx = pageInfo.canvas.getContext('2d');
  const bx = leftPx * dpr, by = topPx * dpr, bw = wPx * dpr, bh = hPx * dpr;
  const pts = [
    [bx - 5, by + bh / 2], [bx + bw + 5, by + bh / 2],
    [bx + bw / 2, by - 5], [bx + bw / 2, by + bh + 5],
    [bx - 5, by - 5], [bx + bw + 5, by + bh + 5],
  ];
  const counts = new Map();
  for (const [x, y] of pts) {
    const [r, g, b] = samplePixel(ctx, pageInfo.canvas, x, y);
    const k = `${r >> 4},${g >> 4},${b >> 4}`;
    const cur = counts.get(k) || { n: 0, r, g, b };
    cur.n++;
    counts.set(k, cur);
  }
  const best = [...counts.values()].sort((p, q) => q.n - p.n)[0];
  return hex(best.r, best.g, best.b);
}

// Metin öğesi için zemin + yazı rengini örnekler (imleç konumu meta'dan hesaplanır)
export function sampleTextColors(fullMeta) {
  const k = fullMeta.pxScale;
  const ctx = fullMeta.canvas.getContext('2d');
  const bx = fullMeta.x * k;
  const by = (fullMeta.pdfH - fullMeta.yBase - fullMeta.fs * 0.85) * k;
  const bw = Math.max(2, fullMeta.w * k);
  const bh = Math.max(2, fullMeta.fs * 1.1 * k);

  const pts = [
    [bx - 5, by + bh / 2], [bx + bw + 5, by + bh / 2],
    [bx + bw / 2, by - 5], [bx + bw / 2, by + bh + 5],
    [bx - 5, by - 5], [bx + bw + 5, by + bh + 5],
  ];
  const counts = new Map();
  for (const [x, y] of pts) {
    const [r, g, b] = samplePixel(ctx, fullMeta.canvas, x, y);
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const cur = counts.get(key) || { n: 0, r, g, b };
    cur.n++;
    counts.set(key, cur);
  }
  const bg = [...counts.values()].sort((p, q) => q.n - p.n)[0];

  const region = ctx.getImageData(Math.round(bx), Math.round(by), Math.ceil(bw), Math.ceil(bh)).data;
  let best = null;
  let bestDist = 0;
  for (let i = 0; i < region.length; i += 4) {
    const dr = region[i] - bg.r;
    const dg = region[i + 1] - bg.g;
    const db = region[i + 2] - bg.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist > bestDist) {
      bestDist = dist;
      best = [region[i], region[i + 1], region[i + 2]];
    }
  }
  const textColor = bestDist > 2500 ? best : [0, 0, 0];
  return { bg: hex(bg.r, bg.g, bg.b), color: hex(...textColor) };
}
