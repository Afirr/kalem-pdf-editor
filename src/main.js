// Kalem — arayüz bağlantıları: satır içi metin düzenleme, sürükle-taşı,
// köşeden yeniden boyutlandırma (metin + otomatik algılanan görsel), geri al/ileri al.
import {
  openPdf, renderAll, fitScale, sampleTextColors, sampleBgAround,
  cropToPng, refreshItem, textBoxScreenRect, imageBoxScreenRect,
} from './pdfview.js';
import {
  state, syncText, syncImage, editCount, resetAll,
  pushUndo, undo, redo, canUndo, canRedo,
} from './state.js';
import { bake } from './export.js';

const $ = (id) => document.getElementById(id);
const els = {
  workspace: $('workspace'), pages: $('pages'), empty: $('emptyState'),
  dropCard: $('dropCard'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  filename: $('filename'), zoomGroup: $('zoomGroup'), toolGroup: $('toolGroup'),
  actionGroup: $('actionGroup'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), zoomLabel: $('zoomLabel'),
  editCount: $('editCount'), resetBtn: $('resetBtn'), newBtn: $('newBtn'), downloadBtn: $('downloadBtn'),
  propertyBar: $('propertyBar'),
  pbTextRow: $('pbTextRow'), pbSize: $('pbSize'), pbColor: $('pbColor'), pbBold: $('pbBold'), pbFont: $('pbFont'),
  pbAreaRow: $('pbAreaRow'), pbShrink: $('pbShrink'), pbGrow: $('pbGrow'), pbToggleHide: $('pbToggleHide'),
  pbMultiRow: $('pbMultiRow'), pbMultiLabel: $('pbMultiLabel'),
  pbRevert: $('pbRevert'), pbDelete: $('pbDelete'), pbClose: $('pbClose'),
  hint: $('hint'), hintClose: $('hintClose'), dragVeil: $('dragVeil'),
};

const round1 = (n) => Math.round(n * 10) / 10;
let activeTextDraft = null; // { key, rec } — seçili metnin özellik çubuğuna bağlı kaydı
let textUndoPushed = false; // bir düzenleme oturumunda geri-al kaydı yalnız ilk değişiklikte itilir
let editSnapshot = null;    // satır içi düzenleme başlarken kaydın durumu (Escape ile iptal için)

// ---------- PDF açma ----------
async function loadFile(bytes, name) {
  try {
    await openPdf(bytes, name);
  } catch (err) {
    alert('Bu dosya açılamadı. Şifreli ya da bozuk bir PDF olabilir.\n\n' + err.message);
    return;
  }
  revokeAllImageUrls();
  resetAll();
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

function revokeAllImageUrls() {
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

// ---------- Kayıt oluşturma (tembel) ----------
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

// Görsel kaydı senkron döner; PNG kırpma/örnekleme arka planda tamamlanıp
// hazır olduğunda ilgili öğeyi kendiliğinden tazeler.
function getOrCreateImageRecord(key) {
  const existing = state.areas.get(key);
  if (existing) return existing;
  const ref = state.itemRefs.get(key);
  const meta = ref.meta;
  const rec = { meta, dx: 0, dy: 0, scale: 1, hidden: false, bg: '#ffffff', png: null, url: null };
  populateImageAssets(key, rec, ref);
  return rec;
}

async function populateImageAssets(key, rec, ref) {
  const s = ref.pageInfo.scale;
  const l = rec.meta.x * s;
  const t = (ref.pageInfo.pdfH - rec.meta.y - rec.meta.h) * s;
  const w = rec.meta.w * s;
  const h = rec.meta.h * s;
  const { bytes } = await cropToPng(ref.pageInfo, l, t, w, h);
  rec.png = bytes;
  rec.bg = sampleBgAround(ref.pageInfo, l, t, w, h);
  rec.url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  if (state.itemRefs.has(key)) refreshItem(key);
}

function getRecordForDrag(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return null;
  return ref.kind === 'text' ? getOrCreateTextRecord(key) : getOrCreateImageRecord(key);
}
function applyRecord(key, rec) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  if (ref.kind === 'text') syncText(rec); else syncImage(rec);
  refreshItem(key);
}

// ---------- Seçim ----------
function selectOnly(key) {
  const touched = new Set([...state.selected, key]);
  state.selected.clear();
  state.selected.add(key);
  touched.forEach(refreshItem);
  openPropertyBarForSelection();
}
function toggleSelect(key) {
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.add(key);
  refreshItem(key);
  openPropertyBarForSelection();
}
function clearSelectionUI() {
  if (state.editingKey) commitTextEditing();
  const prev = [...state.selected];
  state.selected.clear();
  prev.forEach(refreshItem);
  closePropertyBar();
}

// ---------- Satır içi metin düzenleme ----------
function placeCaretAt(el, evt) {
  el.focus();
  if (!evt) return;
  let range = null;
  try {
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(evt.clientX, evt.clientY);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(evt.clientX, evt.clientY);
    }
  } catch { /* konum imleç yerleşimi için kritik değil */ }
  if (range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function onEditableInput(e) {
  const rec = state.editingDraft;
  if (!rec) return;
  if (!textUndoPushed) { pushUndo(); textUndoPushed = true; }
  rec.text = e.target.textContent;
  syncText(rec); // yalnız veri; DOM'a dokunmaz (imleç korunur)
  els.pbRevert.hidden = !state.textEdits.has(state.editingKey);
  updateCount();
}
function onEditableKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelTextEditing(); }
}
function onEditableBlur() {
  commitTextEditing();
}

function startTextEditing(key, evt) {
  if (state.editingKey && state.editingKey !== key) commitTextEditing();
  const rec = getOrCreateTextRecord(key);
  editSnapshot = { ...rec };
  textUndoPushed = false;
  state.editingKey = key;
  state.editingDraft = rec;

  selectOnly(key); // seçim + özellik çubuğu; editingKey ayarlı olduğundan içerik contentEditable çizilir

  const ref = state.itemRefs.get(key);
  const contentEl = ref?.wrap.querySelector(`.titem.edited[data-key="${CSS.escape(key)}"]`);
  if (!contentEl) return;
  placeCaretAt(contentEl, evt);
  contentEl.addEventListener('input', onEditableInput);
  contentEl.addEventListener('keydown', onEditableKeydown);
  contentEl.addEventListener('blur', onEditableBlur);
}

function commitTextEditing() {
  const key = state.editingKey;
  const rec = state.editingDraft;
  if (!key || !rec) return;
  state.editingKey = null;
  state.editingDraft = null;
  editSnapshot = null;
  syncText(rec);
  refreshItem(key);
  updateCount();
  if (state.selected.has(key)) openPropertyBarForSelection();
}

function cancelTextEditing() {
  const key = state.editingKey;
  const rec = state.editingDraft;
  if (!key || !rec || !editSnapshot) return;
  Object.assign(rec, editSnapshot);
  state.editingKey = null;
  state.editingDraft = null;
  editSnapshot = null;
  syncText(rec);
  refreshItem(key);
  updateCount();
  if (state.selected.has(key)) openPropertyBarForSelection();
}

// ---------- Özellik çubuğu ----------
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
    const rec = (state.editingKey === key && state.editingDraft) ? state.editingDraft : getOrCreateTextRecord(key);
    activeTextDraft = { key, rec };
    els.pbSize.value = round1(rec.size);
    els.pbColor.value = rec.color;
    els.pbBold.classList.toggle('on', rec.bold);
    els.pbFont.value = rec.serif ? 'serif' : 'sans';
    els.pbRevert.hidden = !state.textEdits.has(key);
    els.pbDelete.hidden = false;
    els.pbDelete.textContent = 'Sil';
  } else {
    activeTextDraft = null;
    els.pbTextRow.hidden = true;
    els.pbAreaRow.hidden = false;
    const rec = state.areas.get(key);
    els.pbToggleHide.textContent = rec?.hidden ? 'Göster' : 'Gizle';
    els.pbRevert.hidden = !rec;
    els.pbDelete.hidden = true;
  }
}

function closePropertyBar() {
  els.propertyBar.hidden = true;
  activeTextDraft = null;
}

function onTextStyleChange() {
  if (!activeTextDraft) return;
  if (!textUndoPushed) { pushUndo(); textUndoPushed = true; }
  const { key, rec } = activeTextDraft;
  rec.size = parseFloat(els.pbSize.value) || rec.meta.fs;
  rec.color = els.pbColor.value;
  rec.bold = els.pbBold.classList.contains('on');
  rec.serif = els.pbFont.value === 'serif';
  syncText(rec);
  refreshItem(key);
  els.pbRevert.hidden = !state.textEdits.has(key);
  updateCount();
}
els.pbSize.addEventListener('input', onTextStyleChange);
els.pbColor.addEventListener('input', onTextStyleChange);
els.pbFont.addEventListener('change', onTextStyleChange);
els.pbBold.addEventListener('click', () => { els.pbBold.classList.toggle('on'); onTextStyleChange(); });

function deleteItem(key) {
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  if (ref.kind === 'text') {
    if (state.editingKey === key) { state.editingKey = null; state.editingDraft = null; editSnapshot = null; }
    const rec = getOrCreateTextRecord(key);
    rec.text = '';
    syncText(rec);
  } else {
    const rec = getOrCreateImageRecord(key);
    rec.hidden = true;
    syncImage(rec);
  }
  refreshItem(key);
}

els.pbDelete.addEventListener('click', () => {
  const sel = [...state.selected];
  if (!sel.length) return;
  pushUndo();
  sel.forEach(deleteItem);
  updateCount();
  openPropertyBarForSelection();
});

els.pbRevert.addEventListener('click', () => {
  const key = [...state.selected][0];
  if (!key) return;
  pushUndo();
  const ref = state.itemRefs.get(key);
  if (ref.kind === 'text') {
    if (state.editingKey === key) { state.editingKey = null; state.editingDraft = null; editSnapshot = null; }
    state.textEdits.delete(key);
  } else {
    state.areas.delete(key);
  }
  refreshItem(key);
  updateCount();
  openPropertyBarForSelection();
});

els.pbToggleHide.addEventListener('click', () => {
  const key = [...state.selected][0];
  if (!key) return;
  pushUndo();
  const rec = getOrCreateImageRecord(key);
  rec.hidden = !rec.hidden;
  syncImage(rec);
  refreshItem(key);
  updateCount();
  openPropertyBarForSelection();
});

function nudgeScale(delta) {
  const key = [...state.selected][0];
  if (!key) return;
  pushUndo();
  const rec = getOrCreateImageRecord(key);
  rec.scale = Math.min(3, Math.max(0.2, +(rec.scale + delta).toFixed(2)));
  syncImage(rec);
  refreshItem(key);
  updateCount();
  openPropertyBarForSelection();
}
els.pbShrink.addEventListener('click', () => nudgeScale(-0.1));
els.pbGrow.addEventListener('click', () => nudgeScale(0.1));
els.pbClose.addEventListener('click', clearSelectionUI);

// ---------- Hizalama kılavuzları (sayfa merkezi + diğer öğeler) ----------
const SNAP_PX = 6;
let guideElV = null, guideElH = null;

function itemScreenRect(ref, rec) {
  return ref.kind === 'text'
    ? textBoxScreenRect(ref.meta, rec, ref.pageInfo)
    : imageBoxScreenRect(ref.meta, rec, ref.pageInfo);
}

// Aynı sayfadaki (sürüklenenler hariç) tüm öğelerin kenar/merkez konumlarını toplar.
function collectGuideCandidates(pageIdx, excludeKeys) {
  const xs = new Set();
  const ys = new Set();
  for (const [key, ref] of state.itemRefs) {
    if (ref.pageInfo.page !== pageIdx || excludeKeys.has(key)) continue;
    let rec;
    if (ref.kind === 'text') {
      rec = state.textEdits.get(key);
    } else {
      rec = state.areas.get(key);
      if (rec?.hidden) continue;
    }
    const r = itemScreenRect(ref, rec);
    xs.add(r.left); xs.add(r.left + r.width); xs.add(r.left + r.width / 2);
    ys.add(r.top); ys.add(r.top + r.height); ys.add(r.top + r.height / 2);
  }
  return { xs: [...xs], ys: [...ys] };
}

// rec.dx/dy'yi, eşiğin altındaysa en yakın aday değere kilitler; hangi kılavuzun
// çizileceğini (ve katı mı kesikli mi olduğunu) döndürür.
function applySnapAndGuides(ref, rec, candidates) {
  const s = ref.pageInfo.scale;
  const rect = itemScreenRect(ref, rec);
  const left = rect.left, right = rect.left + rect.width, centerX = rect.left + rect.width / 2;
  const top = rect.top, bottom = rect.top + rect.height, centerY = rect.top + rect.height / 2;
  const pageCX = (ref.pageInfo.pdfW * s) / 2;
  const pageCY = (ref.pageInfo.pdfH * s) / 2;

  let guideX = null, solidX = false;
  if (Math.abs(centerX - pageCX) < SNAP_PX) {
    rec.dx += (pageCX - centerX) / s;
    guideX = pageCX; solidX = true;
  } else {
    outerX: for (const cx of candidates.xs) {
      for (const val of [left, right, centerX]) {
        if (Math.abs(val - cx) < SNAP_PX) { rec.dx += (cx - val) / s; guideX = cx; break outerX; }
      }
    }
  }

  let guideY = null, solidY = false;
  if (Math.abs(centerY - pageCY) < SNAP_PX) {
    rec.dy += (centerY - pageCY) / s;
    guideY = pageCY; solidY = true;
  } else {
    outerY: for (const cy of candidates.ys) {
      for (const val of [top, bottom, centerY]) {
        if (Math.abs(val - cy) < SNAP_PX) { rec.dy += (val - cy) / s; guideY = cy; break outerY; }
      }
    }
  }
  return { guideX, solidX, guideY, solidY };
}

function ensureGuideEls(wrap) {
  if (!guideElV) { guideElV = document.createElement('div'); }
  if (!guideElH) { guideElH = document.createElement('div'); }
  if (guideElV.parentNode !== wrap) wrap.appendChild(guideElV);
  if (guideElH.parentNode !== wrap) wrap.appendChild(guideElH);
}
function renderGuides(wrap, g) {
  ensureGuideEls(wrap);
  if (g.guideX != null) {
    guideElV.className = 'align-guide v ' + (g.solidX ? 'solid' : 'dashed');
    guideElV.style.left = `${g.guideX}px`;
    guideElV.style.display = '';
  } else {
    guideElV.style.display = 'none';
  }
  if (g.guideY != null) {
    guideElH.className = 'align-guide h ' + (g.solidY ? 'solid' : 'dashed');
    guideElH.style.top = `${g.guideY}px`;
    guideElH.style.display = '';
  } else {
    guideElH.style.display = 'none';
  }
}
function removeGuides() {
  guideElV?.remove();
  guideElH?.remove();
}

// ---------- Sürükleme (tek/çoklu seçim) ----------
function beginItemGesture(primaryKey, evt) {
  evt.preventDefault();
  if (evt.shiftKey) { toggleSelect(primaryKey); return; }

  const dragKeys = state.selected.has(primaryKey) && state.selected.size > 1
    ? [...state.selected]
    : [primaryKey];
  if (dragKeys.length === 1 && !state.selected.has(primaryKey)) selectOnly(primaryKey);

  const startX = evt.clientX;
  const startY = evt.clientY;
  const starts = new Map();
  for (const k of dragKeys) {
    const rec = getRecordForDrag(k);
    if (rec) starts.set(k, { dx0: rec.dx, dy0: rec.dy });
  }
  let dragging = false;
  let guideCandidates = null;

  function onMove(e) {
    const dxPx = e.clientX - startX;
    const dyPx = e.clientY - startY;
    if (!dragging && Math.hypot(dxPx, dyPx) < 3) return;
    if (!dragging) {
      pushUndo();
      if (dragKeys.length === 1) {
        const ref0 = state.itemRefs.get(dragKeys[0]);
        guideCandidates = collectGuideCandidates(ref0.pageInfo.page, new Set(dragKeys));
      }
    }
    dragging = true;
    for (const k of dragKeys) {
      const ref = state.itemRefs.get(k);
      const start = starts.get(k);
      if (!ref || !start) continue;
      const s = ref.pageInfo.scale;
      const rec = getRecordForDrag(k);
      rec.dx = start.dx0 + dxPx / s;
      rec.dy = start.dy0 - dyPx / s;
      if (dragKeys.length === 1) {
        const g = applySnapAndGuides(ref, rec, guideCandidates);
        renderGuides(ref.pageInfo.wrap, g);
      }
      applyRecord(k, rec);
    }
  }
  function onUp(e) {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    removeGuides();
    if (!dragging) {
      const ref = state.itemRefs.get(primaryKey);
      if (ref?.kind === 'text') startTextEditing(primaryKey, e);
      else selectOnly(primaryKey);
    } else {
      updateCount();
      openPropertyBarForSelection();
    }
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---------- Köşeden sürükleyerek yeniden boyutlandırma (metin + görsel) ----------
function beginResizeGesture(key, evt) {
  evt.preventDefault();
  const ref = state.itemRefs.get(key);
  if (!ref) return;
  const kind = ref.kind;
  const existingRec = kind === 'text' ? state.textEdits.get(key) : state.areas.get(key);
  const rect = kind === 'text'
    ? textBoxScreenRect(ref.meta, existingRec, ref.pageInfo)
    : imageBoxScreenRect(ref.meta, existingRec, ref.pageInfo);
  const wrapBox = ref.wrap.getBoundingClientRect();
  const centerX = wrapBox.left + rect.left + rect.width / 2;
  const centerY = wrapBox.top + rect.top + rect.height / 2;
  const d0 = Math.hypot(evt.clientX - centerX, evt.clientY - centerY) || 1;
  let moved = false;
  let rec = null;
  let base = 1;

  function onMove(e) {
    const d1 = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    if (!moved && Math.abs(d1 - d0) < 2) return;
    if (!moved) {
      pushUndo();
      rec = getRecordForDrag(key);
      base = kind === 'text' ? rec.size : rec.scale;
    }
    moved = true;
    const ratio = d1 / d0;
    if (kind === 'text') {
      rec.size = Math.min(140, Math.max(4, +(base * ratio).toFixed(2)));
      syncText(rec);
    } else {
      rec.scale = Math.min(3, Math.max(0.2, +(base * ratio).toFixed(3)));
      syncImage(rec);
    }
    refreshItem(key);
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (moved) { updateCount(); openPropertyBarForSelection(); }
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---------- Olay yönlendirme (pdfview.js -> main.js) ----------
state.onTextPointerDown = (fullMeta, key, el, evt) => {
  if (state.editingKey === key) return; // zaten düzenleniyor: doğal imleç davranışına izin ver
  beginItemGesture(key, evt);
};
state.onImagePointerDown = (meta, key, el, evt) => {
  beginItemGesture(key, evt);
};
state.onPageMouseDown = () => {
  clearSelectionUI();
};
state.onResizeHandleDown = (key, evt) => {
  beginResizeGesture(key, evt);
};
state.onDeleteClick = (key) => {
  pushUndo();
  deleteItem(key);
  updateCount();
  if (state.selected.has(key)) openPropertyBarForSelection();
};
els.workspace.addEventListener('mousedown', (e) => {
  if (e.target === els.workspace || e.target === els.pages) clearSelectionUI();
});

// ---------- Klavye ----------
window.addEventListener('keydown', (e) => {
  const inField = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)
    || document.activeElement?.isContentEditable;
  if (e.key === 'Escape') { clearSelectionUI(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); download(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if (inField || !state.selected.size) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    pushUndo();
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
  pushUndo();
  for (const key of state.selected) {
    const rec = getRecordForDrag(key);
    if (!rec) continue;
    rec.dx += dxPt;
    rec.dy += dyPt;
    applyRecord(key, rec);
  }
  updateCount();
});

// ---------- Sayaç / geri-al-ileri-al / sıfırla / indir ----------
function updateCount() {
  const n = editCount();
  els.editCount.hidden = n === 0;
  els.editCount.textContent = n === 1 ? '1 düzeltme' : `${n} düzeltme`;
  els.downloadBtn.disabled = n === 0;
  els.undoBtn.disabled = !canUndo();
  els.redoBtn.disabled = !canRedo();
}

function doUndo() {
  if (!undo()) return;
  state.selected.clear();
  closePropertyBar();
  rerender();
}
function doRedo() {
  if (!redo()) return;
  state.selected.clear();
  closePropertyBar();
  rerender();
}
els.undoBtn.addEventListener('click', doUndo);
els.redoBtn.addEventListener('click', doRedo);

els.resetBtn.addEventListener('click', () => {
  if (!editCount()) return;
  if (!confirm('Tüm düzeltmeler silinsin mi? Bu işlem geri alınamaz.')) return;
  revokeAllImageUrls();
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
