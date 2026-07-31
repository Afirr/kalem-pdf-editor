// Sol panel: sayfa küçük resimleri (tıklayınca o sayfaya kaydırır) + geçerli
// sayfanın katman listesi (metin/görsel öğeler, tıklayınca seçer). Katman
// listesi kasıtlı olarak yalnızca ekrandaki geçerli sayfayı gösterir — tüm
// sayfaların katmanlarını aynı anda listelemek karmaşıklaşır.
import { state, setZOrder } from './state.js';

let workspaceEl = null;
let thumbEl = null;
let layersEl = null;
let layersTitleEl = null;
let onSelectLayer = null;
let onReorderLayers = null;
let currentPage = 0;
let dragKey = null;

export function initSidebar({ workspace, thumbs, layers, layersTitle, onSelect, onReorder }) {
  workspaceEl = workspace;
  thumbEl = thumbs;
  layersEl = layers;
  layersTitleEl = layersTitle;
  onSelectLayer = onSelect;
  onReorderLayers = onReorder;
  workspaceEl.addEventListener('scroll', () => {
    const p = computeCurrentPage();
    if (p !== currentPage) {
      currentPage = p;
      syncActiveThumb();
      refreshLayers();
    }
  });
}

export async function loadThumbnails(doc) {
  thumbEl.innerHTML = '';
  currentPage = 0;
  const THUMB_W = 148;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = THUMB_W / vp1.width;
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb' + (p - 1 === currentPage ? ' active' : '');
    btn.dataset.page = String(p - 1);
    btn.appendChild(canvas);
    const label = document.createElement('span');
    label.className = 'thumb-num';
    label.textContent = String(p);
    btn.appendChild(label);
    btn.addEventListener('click', () => scrollToPage(p - 1));
    thumbEl.appendChild(btn);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }
}

function scrollToPage(pageIdx) {
  const wrap = workspaceEl.querySelectorAll('.page-wrap')[pageIdx];
  if (!wrap) return;
  wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
  currentPage = pageIdx;
  syncActiveThumb();
  refreshLayers();
}

function computeCurrentPage() {
  const wraps = [...workspaceEl.querySelectorAll('.page-wrap')];
  if (!wraps.length) return 0;
  const target = workspaceEl.getBoundingClientRect().top + workspaceEl.clientHeight * 0.25;
  let best = 0;
  let bestDist = Infinity;
  wraps.forEach((w, i) => {
    const dist = Math.abs(w.getBoundingClientRect().top - target);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

function syncActiveThumb() {
  thumbEl.querySelectorAll('.thumb').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.page) === currentPage);
  });
}

// Geçerli sayfanın metin/görsel öğelerini katman listesine, en öndeki (üstteki)
// katman listenin BAŞINDA olacak şekilde çizer — Canva/Figma kuralı. Herhangi
// bir düzenleme, seçim ya da sayfa değişiminden sonra çağrılır. Satırlar
// sürükle-bırak ile yeniden sıralanabilir; bu, state.zOrder'ı günceller ve
// sayfanın gerçek yığılma (z) sırasını da değiştirir.
export function refreshLayers() {
  if (!layersEl) return;
  layersTitleEl.textContent = String(currentPage + 1);
  layersEl.innerHTML = '';

  const order = state.zOrder.get(currentPage) || [];
  const entries = order
    .map((key) => [key, state.itemRefs.get(key)])
    .filter(([, ref]) => ref && ref.pageInfo.page === currentPage)
    .reverse();

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'layers-empty';
    empty.textContent = 'Bu sayfada öğe yok';
    layersEl.appendChild(empty);
    return;
  }

  const pageKeys = entries.map(([k]) => k);

  for (const [key, ref] of entries) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (state.selected.has(key) ? ' selected' : '');
    row.dataset.key = key;
    row.tabIndex = 0;
    row.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'layer-handle';
    handle.textContent = '⋮⋮';
    row.appendChild(handle);

    const icon = document.createElement('span');
    icon.className = 'layer-icon';
    icon.textContent = ref.kind === 'text' ? 'T' : '▧';
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'layer-label';
    label.textContent = labelFor(key, ref);
    row.appendChild(label);

    row.addEventListener('click', (ev) => {
      onSelectLayer?.(key, ev, pageKeys);
      document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    });

    row.addEventListener('dragstart', (ev) => {
      dragKey = key;
      ev.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragKey = null;
      layersEl.querySelectorAll('.layer-row.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (ev) => {
      if (!dragKey || dragKey === key) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('drag-over');
      if (!dragKey || dragKey === key) return;
      reorderWithinPage(currentPage, dragKey, key);
      dragKey = null;
      onReorderLayers?.();
    });

    layersEl.appendChild(row);
  }
}

// Sürüklenen katmanı, hedef katmanın GÖRÜNÜR (üstten alta) konumuna yerleştirir
// — hedef bir alt sıraya kayar. zOrder dizisi alttan üste tutulduğundan burada
// önce ters çevrilip (görünür sıra), işlem sonrası tekrar ters çevrilir.
function reorderWithinPage(pageIdx, movedKey, targetKey) {
  const order = state.zOrder.get(pageIdx);
  if (!order) return;
  const display = [...order].reverse();
  const fromIdx = display.indexOf(movedKey);
  if (fromIdx === -1 || display.indexOf(targetKey) === -1) return;
  display.splice(fromIdx, 1);
  const toIdx = display.indexOf(targetKey);
  display.splice(toIdx, 0, movedKey);
  setZOrder(pageIdx, display.reverse());
}

// Seçili tek katmanı bir öne/arkaya ya da en öne/arkaya taşır.
export function moveLayer(key, mode) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  const pageIdx = ref.pageInfo.page;
  const order = state.zOrder.get(pageIdx);
  if (!order) return;
  const i = order.indexOf(key);
  if (i === -1) return;
  const next = [...order];
  next.splice(i, 1);
  if (mode === 'front') next.push(key);
  else if (mode === 'back') next.unshift(key);
  else if (mode === 'forward') next.splice(Math.min(next.length, i + 1), 0, key);
  else if (mode === 'backward') next.splice(Math.max(0, i - 1), 0, key);
  setZOrder(pageIdx, next);
}

function labelFor(key, ref) {
  if (ref.kind === 'text') {
    const rec = state.textEdits.get(key) || (state.editingKey === key ? state.editingDraft : null);
    const text = (rec ? rec.text : ref.meta.str) || '';
    const trimmed = text.trim();
    return trimmed ? trimmed.slice(0, 30) : '(boş metin)';
  }
  return 'Görsel / logo';
}

// Bir öğe programatik olarak seçildiğinde (ör. yeni metin eklenince) katman
// listesinin o sayfayı gösterdiğinden emin olur.
export function ensureLayersShowPage(pageIdx) {
  if (pageIdx === currentPage) { refreshLayers(); return; }
  currentPage = pageIdx;
  syncActiveThumb();
  refreshLayers();
}
