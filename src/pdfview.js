// PDF görüntüleme: pdf.js ile sayfa çizimi + tıklanabilir metin katmanı
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const state = {
  doc: null,
  bytes: null,      // orijinal bayt kopyası (pdf-lib için saklanır)
  name: '',
  scale: 1.3,
  edits: new Map(), // "sayfa:indeks" -> düzeltme
  onItemClick: null,
};

export function editKey(meta) {
  return `${meta.page}:${meta.index}`;
}

export async function openPdf(bytes, name) {
  // pdf.js buffer'ı worker'a devrettiği için kopyayla çalış
  if (state.doc) {
    try { await state.doc.destroy(); } catch { /* önemsiz */ }
  }
  state.bytes = new Uint8Array(bytes);
  state.name = name;
  state.edits.clear();
  state.doc = await pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
}

export function fitScale(containerWidth) {
  // İlk sayfa A4 varsayımıyla değil, gerçek genişlikle hesaplanır (renderAll içinde ayarlanır)
  return Math.min(1.6, Math.max(0.5, containerWidth / 630));
}

let renderGen = 0; // üst üste çağrılar yarışmasın diye
export async function renderAll(container) {
  const gen = ++renderGen;
  const doc = state.doc;
  container.innerHTML = '';
  for (let p = 1; p <= doc.numPages; p++) {
    if (gen !== renderGen || doc !== state.doc) return; // yeni bir çizim başladı
    await renderPage(p, container, doc);
  }
}

async function renderPage(num, container, doc) {
  const page = await doc.getPage(num);
  const vp = page.getViewport({ scale: state.scale });
  const pdfH = page.getViewport({ scale: 1 }).height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
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
  container.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;

  const tc = await page.getTextContent();

  // Font bilgisi: kalınlık gerçek font adından, serif/sans pdf.js stilinden
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
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) return; // döndürülmüş metin: v1'de atla
    const fs = Math.abs(d) || Math.abs(a);
    if (!fs || !it.width) return;

    const meta = {
      page: num - 1,
      index,
      str: it.str,
      x: e,
      yBase: f,
      w: it.width,
      fs,
      bold: fontInfo[it.fontName]?.bold || false,
      serif: fontInfo[it.fontName]?.serif || false,
      canvas,
      pxScale: state.scale * dpr,
      pdfH,
    };

    const box = document.createElement('div');
    box.className = 'titem';
    box.title = 'Düzenlemek için tıkla';
    positionBox(box, meta);
    box.addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.onItemClick?.(meta, box);
    });

    const existing = state.edits.get(editKey(meta));
    if (existing) { existing.meta = { ...existing.meta, canvas, pxScale: meta.pxScale }; paintEdit(box, meta, existing); }
    wrap.appendChild(box);
  });
}

function positionBox(box, meta) {
  const s = state.scale;
  box.style.left = `${meta.x * s - 2}px`;
  box.style.top = `${(meta.pdfH - meta.yBase - meta.fs * 0.87) * s - 1}px`;
  box.style.minWidth = `${meta.w * s + 4}px`;
  box.style.minHeight = `${meta.fs * 1.16 * s + 2}px`;
  box.style.paddingBottom = `${meta.fs * 0.18 * s}px`;
  box.style.paddingLeft = '2px';
}

// Düzeltilen kutuyu sayfa üzerinde canlı önizle
export function paintEdit(box, meta, edit) {
  box.classList.add('edited');
  box.style.background = edit.bg;
  box.style.color = edit.color;
  box.style.fontSize = `${edit.size * state.scale}px`;
  box.style.fontFamily = edit.serif
    ? 'Georgia, "Times New Roman", serif'
    : 'Arial, Helvetica, sans-serif';
  box.style.fontWeight = edit.bold ? '700' : '400';
  box.style.width = 'max-content';
  box.textContent = edit.text;
}

export function clearEditPaint(box) {
  box.classList.remove('edited');
  box.textContent = '';
  ['background', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'width'].forEach(
    (p) => (box.style[p] = ''),
  );
}

// Zemin ve yazı rengini tuvalden örnekle
export function sampleColors(meta) {
  const k = meta.pxScale;
  const ctx = meta.canvas.getContext('2d');
  const bx = meta.x * k;
  const by = (meta.pdfH - meta.yBase - meta.fs * 0.85) * k;
  const bw = Math.max(2, meta.w * k);
  const bh = Math.max(2, meta.fs * 1.1 * k);

  const px = (x, y) => {
    x = Math.max(0, Math.min(meta.canvas.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(meta.canvas.height - 1, Math.round(y)));
    return ctx.getImageData(x, y, 1, 1).data;
  };

  // Zemin: kutunun hemen dışından örnekler, en yaygın olanı seç
  const pts = [
    [bx - 5, by + bh / 2], [bx + bw + 5, by + bh / 2],
    [bx + bw / 2, by - 5], [bx + bw / 2, by + bh + 5],
    [bx - 5, by - 5], [bx + bw + 5, by + bh + 5],
  ];
  const counts = new Map();
  for (const [x, y] of pts) {
    const [r, g, b] = px(x, y);
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const cur = counts.get(key) || { n: 0, r, g, b };
    cur.n++;
    counts.set(key, cur);
  }
  const bg = [...counts.values()].sort((p, q) => q.n - p.n)[0];

  // Yazı rengi: kutu içinde zeminden en uzak piksel
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

  const hex = (r, g, b) =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { bg: hex(bg.r, bg.g, bg.b), color: hex(...textColor) };
}
