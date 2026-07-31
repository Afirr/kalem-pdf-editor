// PDF görüntüleme: pdf.js ile sayfa çizimi + metin/görsel katmanlarının çizimi.
// Görseller, operatör listesi (paintImageXObject) taranarak otomatik algılanır —
// kullanıcının elle bir alan seçmesine gerek yoktur.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { state, textKey, imageKey } from './state.js';
import { FONTS, detectFontKey, prettyFontName } from './engine/fonts.js';
import { detectImageRegions } from './engine/regions.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js'in getTextContent()'i içeride "for await (const chunk of stream)" ile
// ReadableStream'i asenkron olarak dolaşıyor. Bu, WebKit/Safari'nin bazı
// sürümlerinde (gerçek bir iOS Simulator'da doğrulandı — Safari kendini
// "26.3" gibi yeni gösterse de ReadableStream[Symbol.asyncIterator] hâlâ
// tanımsız olabiliyor) desteklenmiyor ve "undefined is not a function" hatasıyla
// tüm sayfa metin/görsel algılamasını sessizce durduruyor — kullanıcı sayfayı
// görüyor ama hiçbir şeyi seçemiyor/sürükleyemiyor. Standart polyfill.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

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

  wrap.addEventListener('pointerdown', (ev) => {
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
      font: detectFontKey(realName, fam), // PDF'teki gerçek adından en yakın aile
      fontRaw: prettyFontName(realName),
    };
  }

  // Bu sayfadaki tüm metin/görsel öğelerinin meta'sını önce topluyoruz ki
  // aşağıda gerçek çizim, doğal algılama sırası yerine kullanıcının katman
  // panelinden ayarladığı z-sırasına (varsa) göre yapılabilsin.
  const textMetas = new Map();
  tc.items.forEach((it, index) => {
    if (!it.str || !it.str.trim()) return;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) return; // döndürülmüş metin desteklenmiyor
    const fs = Math.abs(d) || Math.abs(a);
    if (!fs || !it.width) return;

    const meta = {
      page: pageIdx, index, str: it.str, x: e, yBase: f, w: it.width, fs,
      bold: fontInfo[it.fontName]?.bold || false,
      font: fontInfo[it.fontName]?.font || 'arial',
      fontRaw: fontInfo[it.fontName]?.fontRaw || '',
    };
    textMetas.set(textKey(pageIdx, index), meta);
  });
  (state.customTexts.get(pageIdx) || []).forEach((meta) => {
    textMetas.set(textKey(pageIdx, meta.index), meta);
  });

  const regions = await detectImageRegions(page, tc.items);
  const imageMetas = new Map();
  regions.forEach((region, index) => {
    const meta = { page: pageIdx, index, x: region.x, y: region.y, w: region.w, h: region.h };
    imageMetas.set(imageKey(pageIdx, index), meta);
  });
  (state.customAreas.get(pageIdx) || []).forEach((meta) => {
    imageMetas.set(imageKey(pageIdx, meta.index), meta);
  });

  // Katman (z) sırasını al; yoksa doğal algılama sırasıyla oluştur. Önceki
  // sırada olup artık var olmayan anahtarlar düşer, yeni beliren anahtarlar
  // (ör. yeni eklenen metin/birleştirilen görsel) en üste eklenir.
  const naturalOrder = [...textMetas.keys(), ...imageMetas.keys()];
  let order = state.zOrder.get(pageIdx);
  if (!order) {
    order = naturalOrder;
  } else {
    const known = new Set(order);
    order = order.filter((k) => textMetas.has(k) || imageMetas.has(k));
    for (const k of naturalOrder) if (!known.has(k)) order.push(k);
  }
  state.zOrder.set(pageIdx, order);

  for (const key of order) {
    const tMeta = textMetas.get(key);
    if (tMeta) { renderTextItem(wrap, pageInfo, tMeta); continue; }
    const iMeta = imageMetas.get(key);
    if (iMeta) renderImageItem(wrap, pageInfo, iMeta);
  }
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
  el.addEventListener('pointerdown', (ev) => {
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
    h.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); onDown(ev); });
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
  btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
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
    cover.addEventListener('pointerdown', (ev) => {
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

    // iOS Safari, font-size < 16px olan bir alana odaklanınca sayfayı zorla
    // yakınlaştırır. Küçük punto metinleri (ör. 8pt başlık) görsel olarak
    // KÜÇÜLTMEDEN bu zoom'u önlemek için: gerçek font-size'ı hep 16px'e
    // sabitleyip transform:scale(ratio) ile görsel boyutu geri telafi
    // ediyoruz (ratio>=1 olduğunda — yani punto zaten 16px+ ise — formül
    // otomatik olarak transform'suz eski davranışa eşitleniyor).
    const trueFontPx = rec.size * s;
    const BASE_PX = 16;
    const ratio = Math.min(1, trueFontPx / BASE_PX);

    positionAt(content, left, topPdf, meta.w / ratio, (rec.size * 1.16) / ratio, s);
    content.style.paddingBottom = `${(rec.size * 0.18 * s) / ratio}px`;
    // Zemin rengi yalnızca metin hâlâ ORİJİNAL konumundaysa (altındaki cover
    // ile aynı yerde) uygulanır — dışa aktarımda da yalnız orijinal konum
    // kapatılır. Metin taşınmışsa arka planı boyamak, eski (uyuşmayan) bir
    // renk yamasının metinle birlikte sürüklenmiş gibi görünmesine yol açar.
    const moved = Math.abs(rec.dx) > 0.02 || Math.abs(rec.dy) > 0.02;
    // Kullanıcının seçtiği dolgu rengi (vurgu) her durumda kazanır; yoksa eski
    // "orijinal konumda zemin rengi, taşınmışsa saydam" davranışı sürer.
    content.style.background = rec.fillBg || (moved ? 'transparent' : rec.bg);
    content.style.color = rec.color;
    content.style.fontSize = `${trueFontPx / ratio}px`;
    if (ratio < 1) {
      // transform-origin:top left, positionAt'ın hesapladığı left/top'u
      // (kutunun ekrandaki gerçek sol-üst köşesini) SABİT tutar — yalnız
      // sağ-alt yönde büyütülmüş kutuyu görsel olarak geri küçültür.
      content.style.transform = `scale(${ratio})`;
      content.style.transformOrigin = 'top left';
    } else {
      content.style.transform = '';
    }
    content.style.fontFamily = (FONTS[rec.font] || FONTS.arial).css;
    content.style.fontWeight = rec.bold ? '700' : '400';
    content.style.fontStyle = rec.italic ? 'italic' : 'normal';
    content.style.textDecoration = [
      rec.underline ? 'underline' : '',
      rec.strike ? 'line-through' : '',
    ].filter(Boolean).join(' ') || 'none';
    content.style.width = 'max-content';
    content.style.whiteSpace = 'pre';
    content.textContent = rec.text;
    if (editing) {
      content.contentEditable = 'true';
      content.spellcheck = false;
    } else {
      content.addEventListener('pointerdown', (ev) => {
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
