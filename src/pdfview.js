// PDF görüntüleme: pdf.js ile sayfa çizimi + metin/alan katmanlarının çizimi
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { state, textKey } from './state.js';

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
  const pdfH = page.getViewport({ scale: 1 }).height;
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

  const pageInfo = { canvas, dpr, pdfH, scale: state.scale, wrap, page: pageIdx };
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

  // ---- Alan (görsel/logo) öğeleri ----
  for (const rec of state.areas.values()) {
    if (rec.page === pageIdx) renderAreaItem(wrap, pageInfo, rec);
  }
}

function positionAt(el, xPt, topPt, wPt, hPt, s) {
  el.style.left = `${xPt * s - 2}px`;
  el.style.top = `${topPt * s - 1}px`;
  el.style.minWidth = `${wPt * s + 4}px`;
  el.style.minHeight = `${hPt * s + 2}px`;
}

function attachPointer(el, key, handler) {
  el.dataset.key = key;
  el.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
    handler(ev, el);
  });
}

// ---------- Metin öğesi ----------
export function renderTextItem(wrap, pageInfo, meta) {
  const key = textKey(meta.page, meta.index);
  const s = pageInfo.scale;
  const fullMeta = { ...meta, canvas: pageInfo.canvas, pxScale: s * pageInfo.dpr, pdfH: pageInfo.pdfH };
  state.itemRefs.set(key, { kind: 'text', wrap, pageInfo, fullMeta });

  const rec = state.textEdits.get(key);
  const selected = state.selected.has(key);

  if (!rec) {
    const hit = document.createElement('div');
    hit.className = 'titem' + (selected ? ' selected' : '');
    hit.title = 'Seç, üstteki çubuktan düzenle';
    positionAt(hit, meta.x, pageInfo.pdfH - meta.yBase - meta.fs * 0.87, meta.w, meta.fs * 1.16, s);
    hit.style.paddingBottom = `${meta.fs * 0.18 * s}px`;
    attachPointer(hit, key, (ev) => state.onTextPointerDown?.(fullMeta, key, hit, ev));
    wrap.appendChild(hit);
    return;
  }

  // Değiştirilmiş: orijinal konumda kapatma + (varsa) yeni konumda içerik
  const cover = document.createElement('div');
  cover.className = 'tcover' + (selected ? ' selected' : '');
  positionAt(cover, meta.x, pageInfo.pdfH - meta.yBase - meta.fs * 0.87, meta.w, meta.fs * 1.16, s);
  cover.style.background = rec.bg;
  attachPointer(cover, key, (ev) => state.onTextPointerDown?.(fullMeta, key, cover, ev));
  wrap.appendChild(cover);

  if (rec.text) {
    const content = document.createElement('div');
    content.className = 'titem edited' + (selected ? ' selected' : '');
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
    attachPointer(content, key, (ev) => state.onTextPointerDown?.(fullMeta, key, content, ev));
    wrap.appendChild(content);
  }
}

export function refreshTextItem(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
  renderTextItem(ref.wrap, ref.pageInfo, ref.fullMeta);
}

// ---------- Alan (görsel/logo) öğesi ----------
export function renderAreaItem(wrap, pageInfo, rec) {
  const s = pageInfo.scale;
  const key = rec.key;
  state.itemRefs.set(key, { kind: 'area', wrap, pageInfo });
  const selected = state.selected.has(key);

  const cover = document.createElement('div');
  cover.className = 'acover' + (selected && rec.hidden ? ' selected' : '');
  const topOrig = pageInfo.pdfH - rec.y - rec.h;
  positionAt(cover, rec.x, topOrig, rec.w, rec.h, s);
  cover.style.background = rec.bg;
  attachPointer(cover, key, (ev) => state.onAreaPointerDown?.(rec, cover, ev));
  wrap.appendChild(cover);

  if (!rec.hidden) {
    const content = document.createElement('div');
    content.className = 'aitem' + (selected ? ' selected' : '');
    const w = rec.w * rec.scale;
    const h = rec.h * rec.scale;
    const x = rec.x + rec.dx + (rec.w - w) / 2;
    const y = rec.y + rec.dy + (rec.h - h) / 2;
    const topPdf = pageInfo.pdfH - y - h;
    positionAt(content, x, topPdf, w, h, s);
    content.style.width = `${w * s}px`;
    content.style.height = `${h * s}px`;
    content.style.minWidth = '';
    content.style.minHeight = '';
    const img = document.createElement('img');
    img.draggable = false;
    img.src = rec.url;
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.display = 'block';
    content.appendChild(img);
    attachPointer(content, key, (ev) => state.onAreaPointerDown?.(rec, content, ev));
    wrap.appendChild(content);

    if (selected) {
      const left = x * s, top = topPdf * s, right = left + w * s, bottom = top + h * s;
      const corners = [
        ['nw', left, top], ['ne', right, top], ['sw', left, bottom], ['se', right, bottom],
      ];
      for (const [corner, cx, cy] of corners) {
        const handle = document.createElement('div');
        handle.className = `rhandle ${corner}`;
        handle.dataset.key = key;
        handle.style.left = `${cx}px`;
        handle.style.top = `${cy}px`;
        handle.addEventListener('mousedown', (ev) => {
          ev.stopPropagation();
          state.onResizeHandleDown?.(rec, corner, ev);
        });
        wrap.appendChild(handle);
      }
    }
  }
}

export function refreshAreaItem(key) {
  const ref = state.itemRefs.get(key);
  const rec = state.areas.get(key);
  if (!ref || !rec) return;
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
  renderAreaItem(ref.wrap, ref.pageInfo, rec);
}

export function removeItemDOM(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
  state.itemRefs.delete(key);
}

// Yalnızca seçim/vurgu sınıfını tazeler (yeniden konumlamadan) — çoklu seçimde ucuz güncelleme için
export function refreshSelectionClass(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  const on = state.selected.has(key);
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.classList.toggle('selected', on));
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
