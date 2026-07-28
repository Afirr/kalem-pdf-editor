// Kalem — arayüz bağlantıları: seçim, sürükle-taşı, sabit özellik çubuğu, alan yakalama
import {
  openPdf, renderAll, fitScale, sampleTextColors, sampleBgAround,
  screenRectToPdf, cropToPng, refreshTextItem, refreshAreaItem, renderAreaItem,
  refreshSelectionClass, removeItemDOM,
} from './pdfview.js';
import { state, textKey, areaKey, syncText, editCount, resetAll } from './state.js';
import { bake } from './export.js';

const $ = (id) => document.getElementById(id);
const els = {
  workspace: $('workspace'), pages: $('pages'), empty: $('emptyState'),
  dropCard: $('dropCard'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  filename: $('filename'), zoomGroup: $('zoomGroup'), toolGroup: $('toolGroup'),
  actionGroup: $('actionGroup'), areaToolBtn: $('areaToolBtn'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), zoomLabel: $('zoomLabel'),
  editCount: $('editCount'), resetBtn: $('resetBtn'), newBtn: $('newBtn'), downloadBtn: $('downloadBtn'),
  propertyBar: $('propertyBar'),
  pbTextRow: $('pbTextRow'), pbText: $('pbText'), pbSize: $('pbSize'), pbColor: $('pbColor'),
  pbBold: $('pbBold'), pbFont: $('pbFont'),
  pbAreaRow: $('pbAreaRow'), pbShrink: $('pbShrink'), pbGrow: $('pbGrow'), pbToggleHide: $('pbToggleHide'),
  pbMultiRow: $('pbMultiRow'), pbMultiLabel: $('pbMultiLabel'),
  pbRevert: $('pbRevert'), pbRemove: $('pbRemove'), pbDelete: $('pbDelete'), pbClose: $('pbClose'),
  hint: $('hint'), hintClose: $('hintClose'), dragVeil: $('dragVeil'),
};

const round1 = (n) => Math.round(n * 10) / 10;
let activeTextDraft = null; // { key, rec } — tek metin seçiliyken özellik çubuğuna bağlı taslak
let areaArmed = false;

// ---------- PDF açma ----------
async function loadFile(bytes, name) {
  try {
    await openPdf(bytes, name);
  } catch (err) {
    alert('Bu dosya açılamadı. Şifreli ya da bozuk bir PDF olabilir.\n\n' + err.message);
    return;
  }
  revokeAllAreaUrls();
  resetAll();
  setAreaArmed(false);
  els.empty.hidden = true;
  els.zoomGroup.hidden = false;
  els.toolGroup.hidden = false;
  els.actionGroup.hidden = false;
  els.filename.hidden = false;
  els.filename.textContent = name;
  els.hint.hidden = localStorage.getItem('kalemHintSeen') === '1';
  closePropertyBar();
  state.scale = fitScale(els.workspace.clientWidth - 120);
  await rerender();
}

async function rerender() {
  els.zoomLabel.textContent = Math.round(state.scale * 100) + '%';
  await renderAll(els.pages);
  updateCount();
  if (state.selected.size) openPropertyBarForSelection();
}

function revokeAllAreaUrls() {
  for (const rec of state.areas.values()) {
    if (rec.url) URL.revokeObjectURL(rec.url);
  }
}

els.pickBtn.addEventListener('click', () => els.fileInput.click());
els.newBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
  els.fileInput.value = '';
});

// Sürükle-bırak (dosya açma)
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  els.dragVeil.hidden = false;
  els.dropCard.classList.add('over');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; els.dragVeil.hidden = true; els.dropCard.classList.remove('over'); }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dragVeil.hidden = true;
  els.dropCard.classList.remove('over');
  const file = [...e.dataTransfer.files].find((f) => /\.pdf$/i.test(f.name));
  if (file) loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
});

// ---------- Yakınlaştırma ----------
function setScale(s) {
  state.scale = Math.min(3, Math.max(0.4, s));
  rerender();
}
els.zoomIn.addEventListener('click', () => setScale(state.scale + 0.15));
els.zoomOut.addEventListener('click', () => setScale(state.scale - 0.15));
els.zoomFit.addEventListener('click', () => setScale(fitScale(els.workspace.clientWidth - 120)));

// ---------- Seçim ----------
function selectOnly(key) {
  const touched = new Set([...state.selected, key]);
  state.selected.clear();
  state.selected.add(key);
  touched.forEach(refreshSelectionClass);
  openPropertyBarForSelection();
}
function toggleSelect(key) {
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.add(key);
  refreshSelectionClass(key);
  openPropertyBarForSelection();
}
function clearSelectionUI() {
  const prev = [...state.selected];
  state.selected.clear();
  prev.forEach(refreshSelectionClass);
  closePropertyBar();
}

function getOrCreateTextRecord(key) {
  const existing = state.textEdits.get(key);
  if (existing) return existing;
  const ref = state.itemRefs.get(key);
  const fm = ref.fullMeta;
  const { canvas, pxScale, pdfH, ...leanMeta } = fm;
  const sampled = sampleTextColors(fm);
  return {
    meta: leanMeta,
    text: fm.str,
    size: fm.fs,
    color: sampled.color,
    baseColor: sampled.color,
    bold: fm.bold,
    serif: fm.serif,
    bg: sampled.bg,
    dx: 0,
    dy: 0,
  };
}

function getRecordForDrag(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return null;
  return ref.kind === 'text' ? getOrCreateTextRecord(key) : state.areas.get(key);
}
function applyRecord(key, rec) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  if (ref.kind === 'text') {
    syncText(rec);
    refreshTextItem(key);
  } else {
    refreshAreaItem(key);
  }
  refreshSelectionClass(key);
}

// ---------- Özellik çubuğu ----------
function autoGrowPbText() {
  els.pbText.style.height = 'auto';
  els.pbText.style.height = Math.min(140, els.pbText.scrollHeight) + 'px';
}

function openPropertyBarForSelection() {
  const sel = [...state.selected];
  if (!sel.length) { closePropertyBar(); return; }
  els.propertyBar.hidden = false;

  if (sel.length > 1) {
    activeTextDraft = null;
    els.pbTextRow.hidden = true;
    els.pbAreaRow.hidden = true;
    els.pbMultiRow.hidden = false;
    els.pbMultiLabel.textContent = `${sel.length} öğe seçili`;
    els.pbRevert.hidden = true;
    els.pbRemove.hidden = true;
    els.pbDelete.hidden = false;
    els.pbDelete.textContent = 'Seçilenleri sil';
    return;
  }

  const key = sel[0];
  const ref = state.itemRefs.get(key);
  if (!ref) { clearSelectionUI(); return; }
  els.pbMultiRow.hidden = true;

  if (ref.kind === 'text') {
    els.pbAreaRow.hidden = true;
    els.pbTextRow.hidden = false;
    const rec = getOrCreateTextRecord(key);
    activeTextDraft = { key, rec };
    els.pbText.value = rec.text;
    els.pbSize.value = round1(rec.size);
    els.pbColor.value = rec.color;
    els.pbBold.classList.toggle('on', rec.bold);
    els.pbFont.value = rec.serif ? 'serif' : 'sans';
    autoGrowPbText();
    els.pbRevert.hidden = !state.textEdits.has(key);
    els.pbRemove.hidden = true;
    els.pbDelete.hidden = false;
    els.pbDelete.textContent = 'Sil';
  } else {
    activeTextDraft = null;
    els.pbTextRow.hidden = true;
    els.pbAreaRow.hidden = false;
    const rec = state.areas.get(key);
    els.pbToggleHide.textContent = rec.hidden ? 'Göster' : 'Gizle';
    const untouched = Math.abs(rec.dx) < 0.02 && Math.abs(rec.dy) < 0.02 && Math.abs(rec.scale - 1) < 0.001;
    els.pbRevert.hidden = untouched;
    els.pbRemove.hidden = false;
    els.pbDelete.hidden = true;
  }
}

function closePropertyBar() {
  els.propertyBar.hidden = true;
  activeTextDraft = null;
}

function onTextFieldChange() {
  if (!activeTextDraft) return;
  const { key, rec } = activeTextDraft;
  rec.text = els.pbText.value;
  rec.size = parseFloat(els.pbSize.value) || rec.meta.fs;
  rec.color = els.pbColor.value;
  rec.bold = els.pbBold.classList.contains('on');
  rec.serif = els.pbFont.value === 'serif';
  syncText(rec);
  refreshTextItem(key);
  refreshSelectionClass(key);
  els.pbRevert.hidden = !state.textEdits.has(key);
  updateCount();
}
els.pbText.addEventListener('input', () => { autoGrowPbText(); onTextFieldChange(); });
els.pbSize.addEventListener('input', onTextFieldChange);
els.pbColor.addEventListener('input', onTextFieldChange);
els.pbFont.addEventListener('change', onTextFieldChange);
els.pbBold.addEventListener('click', () => { els.pbBold.classList.toggle('on'); onTextFieldChange(); });

function deleteItem(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  if (ref.kind === 'text') {
    const rec = getOrCreateTextRecord(key);
    rec.text = '';
    syncText(rec);
    refreshTextItem(key);
  } else {
    const rec = state.areas.get(key);
    if (rec) { rec.hidden = true; refreshAreaItem(key); }
  }
  refreshSelectionClass(key);
}

els.pbDelete.addEventListener('click', () => {
  const sel = [...state.selected];
  if (!sel.length) return;
  sel.forEach(deleteItem);
  updateCount();
  openPropertyBarForSelection();
});

els.pbRevert.addEventListener('click', () => {
  const key = [...state.selected][0];
  if (!key) return;
  const ref = state.itemRefs.get(key);
  if (ref.kind === 'text') {
    state.textEdits.delete(key);
    refreshTextItem(key);
  } else {
    const rec = state.areas.get(key);
    rec.dx = 0; rec.dy = 0; rec.scale = 1;
    refreshAreaItem(key);
  }
  refreshSelectionClass(key);
  updateCount();
  openPropertyBarForSelection();
});

els.pbRemove.addEventListener('click', () => {
  const key = [...state.selected][0];
  const rec = key && state.areas.get(key);
  if (!rec) return;
  if (rec.url) URL.revokeObjectURL(rec.url);
  state.areas.delete(key);
  removeItemDOM(key);
  clearSelectionUI();
  updateCount();
});

els.pbToggleHide.addEventListener('click', () => {
  const key = [...state.selected][0];
  const rec = key && state.areas.get(key);
  if (!rec) return;
  rec.hidden = !rec.hidden;
  refreshAreaItem(key);
  refreshSelectionClass(key);
  updateCount();
  openPropertyBarForSelection();
});

function nudgeScale(delta) {
  const key = [...state.selected][0];
  const rec = key && state.areas.get(key);
  if (!rec) return;
  rec.scale = Math.min(3, Math.max(0.2, +(rec.scale + delta).toFixed(2)));
  refreshAreaItem(key);
  refreshSelectionClass(key);
  updateCount();
  openPropertyBarForSelection();
}
els.pbShrink.addEventListener('click', () => nudgeScale(-0.1));
els.pbGrow.addEventListener('click', () => nudgeScale(0.1));
els.pbClose.addEventListener('click', clearSelectionUI);

// ---------- Sürükleme (tek/çoklu seçim) ----------
function beginItemGesture(primaryKey, evt) {
  evt.preventDefault();
  if (evt.shiftKey) { toggleSelect(primaryKey); return; }

  const dragKeys = state.selected.has(primaryKey) && state.selected.size > 1
    ? [...state.selected]
    : [primaryKey];
  if (dragKeys.length === 1) selectOnly(primaryKey);

  const startX = evt.clientX;
  const startY = evt.clientY;
  const starts = new Map();
  for (const k of dragKeys) {
    const rec = getRecordForDrag(k);
    if (rec) starts.set(k, { dx0: rec.dx, dy0: rec.dy });
  }
  let dragging = false;

  function onMove(e) {
    const dxPx = e.clientX - startX;
    const dyPx = e.clientY - startY;
    if (!dragging && Math.hypot(dxPx, dyPx) < 3) return;
    dragging = true;
    for (const k of dragKeys) {
      const ref = state.itemRefs.get(k);
      const start = starts.get(k);
      if (!ref || !start) continue;
      const s = ref.pageInfo.scale;
      const rec = getRecordForDrag(k);
      rec.dx = start.dx0 + dxPx / s;
      rec.dy = start.dy0 - dyPx / s;
      applyRecord(k, rec);
    }
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (!dragging) {
      selectOnly(primaryKey);
    } else {
      updateCount();
      openPropertyBarForSelection();
    }
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---------- Alan (görsel/logo) yakalama ----------
function setAreaArmed(v) {
  areaArmed = v;
  els.areaToolBtn.classList.toggle('on', v);
  document.querySelectorAll('.page-wrap').forEach((w) => w.classList.toggle('arming', v));
}
els.areaToolBtn.addEventListener('click', () => setAreaArmed(!areaArmed));

function startMarquee(pageIdx, pageInfo, evt) {
  evt.preventDefault();
  const wrap = pageInfo.wrap;
  const wrapRect = wrap.getBoundingClientRect();
  const startX = Math.min(Math.max(evt.clientX - wrapRect.left, 0), wrapRect.width);
  const startY = Math.min(Math.max(evt.clientY - wrapRect.top, 0), wrapRect.height);

  const box = document.createElement('div');
  box.className = 'marquee';
  wrap.appendChild(box);
  const set = (l, t, w, h) => {
    box.style.left = `${l}px`; box.style.top = `${t}px`;
    box.style.width = `${w}px`; box.style.height = `${h}px`;
  };
  set(startX, startY, 0, 0);

  function onMove(e) {
    const curX = Math.min(Math.max(e.clientX - wrapRect.left, 0), wrapRect.width);
    const curY = Math.min(Math.max(e.clientY - wrapRect.top, 0), wrapRect.height);
    set(Math.min(startX, curX), Math.min(startY, curY), Math.abs(curX - startX), Math.abs(curY - startY));
  }
  async function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const l = parseFloat(box.style.left), t = parseFloat(box.style.top);
    const w = parseFloat(box.style.width), h = parseFloat(box.style.height);
    box.remove();
    setAreaArmed(false);
    if (w < 6 || h < 6) return;
    await captureArea(pageIdx, pageInfo, l, t, w, h);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

async function captureArea(pageIdx, pageInfo, l, t, w, h) {
  const { bytes } = await cropToPng(pageInfo, l, t, w, h);
  const pdfRect = screenRectToPdf(pageInfo, l, t, w, h);
  const bg = sampleBgAround(pageInfo, l, t, w, h);
  const id = state.nextAreaId++;
  const key = areaKey(id);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const rec = {
    key, page: pageIdx,
    x: pdfRect.x, y: pdfRect.y, w: pdfRect.w, h: pdfRect.h,
    dx: 0, dy: 0, scale: 1,
    bg, png: bytes, url, hidden: false,
  };
  state.areas.set(key, rec);
  renderAreaItem(pageInfo.wrap, pageInfo, rec); // ilk çizim: henüz itemRefs'te yok, refreshAreaItem çalışmaz
  selectOnly(key);
  updateCount();
}

// ---------- Olay yönlendirme (pdfview.js -> main.js) ----------
state.onTextPointerDown = (fullMeta, key, el, evt) => {
  if (areaArmed) { startMarquee(fullMeta.page, state.itemRefs.get(key).pageInfo, evt); return; }
  beginItemGesture(key, evt);
};
state.onAreaPointerDown = (rec, el, evt) => {
  if (areaArmed) { startMarquee(rec.page, state.itemRefs.get(rec.key).pageInfo, evt); return; }
  beginItemGesture(rec.key, evt);
};
state.onPageMouseDown = (pageIdx, wrap, evt) => {
  if (areaArmed) {
    const pageInfo = state.pageInfos.get(pageIdx);
    if (pageInfo) startMarquee(pageIdx, pageInfo, evt);
    return;
  }
  clearSelectionUI();
};
els.workspace.addEventListener('mousedown', (e) => {
  if (e.target === els.workspace || e.target === els.pages) clearSelectionUI();
});

// ---------- Klavye ----------
window.addEventListener('keydown', (e) => {
  const inField = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (areaArmed) setAreaArmed(false);
    else clearSelectionUI();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); download(); return; }
  if (inField || !state.selected.size) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    [...state.selected].forEach(deleteItem);
    updateCount();
    openPropertyBarForSelection();
    return;
  }
  const step = e.shiftKey ? 10 : 1;
  let dxPt = 0, dyPt = 0;
  if (e.key === 'ArrowLeft') dxPt = -step;
  else if (e.key === 'ArrowRight') dxPt = step;
  else if (e.key === 'ArrowUp') dyPt = step;
  else if (e.key === 'ArrowDown') dyPt = -step;
  else return;
  e.preventDefault();
  for (const key of state.selected) {
    const rec = getRecordForDrag(key);
    if (!rec) continue;
    rec.dx += dxPt;
    rec.dy += dyPt;
    applyRecord(key, rec);
  }
  updateCount();
});

// ---------- Sayaç / sıfırla / indir ----------
function updateCount() {
  const n = editCount();
  els.editCount.hidden = n === 0;
  els.editCount.textContent = n === 1 ? '1 düzeltme' : `${n} düzeltme`;
  els.downloadBtn.disabled = n === 0;
}

els.resetBtn.addEventListener('click', () => {
  if (!editCount()) return;
  if (!confirm('Tüm düzeltmeler silinsin mi?')) return;
  revokeAllAreaUrls();
  resetAll();
  closePropertyBar();
  rerender();
});

async function download() {
  if (!editCount() || els.downloadBtn.disabled) return;
  els.downloadBtn.disabled = true;
  els.downloadBtn.textContent = 'Hazırlanıyor…';
  try {
    const out = await bake(state.bytes, state.textEdits, state.areas);
    const blob = new Blob([out], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.name.replace(/\.pdf$/i, '') + '-duzenlenmis.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) {
    alert('PDF oluşturulamadı: ' + err.message);
  } finally {
    els.downloadBtn.textContent = "PDF'i İndir";
    updateCount();
  }
}
els.downloadBtn.addEventListener('click', download);

els.hintClose.addEventListener('click', () => {
  els.hint.hidden = true;
  localStorage.setItem('kalemHintSeen', '1');
});

// ---------- Otomatik açılış (?pdf=...) ve test kancaları ----------
const params = new URLSearchParams(location.search);
if (params.get('pdf')) {
  fetch(params.get('pdf'))
    .then((r) => r.arrayBuffer())
    .then((b) => loadFile(new Uint8Array(b), params.get('pdf').split('/').pop()));
}

window.__kalem = {
  state,
  selectOnly,
  clearSelectionUI,
  async previewBaked() {
    const out = await bake(state.bytes, state.textEdits, state.areas);
    const n = editCount();
    await loadFile(new Uint8Array(out), 'önizleme.pdf');
    return n;
  },
};
