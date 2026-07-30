// Kalem — arayüz bağlantıları: satır içi metin düzenleme, sürükle-taşı,
// köşeden yeniden boyutlandırma (metin + otomatik algılanan görsel), geri al/ileri al.
import {
  openPdf, renderAll, fitScale, sampleTextColors, sampleBgAround,
  cropToPng, refreshItem, renderTextItem, renderImageItem, textBoxScreenRect, imageBoxScreenRect,
} from './pdfview.js';
import {
  state, textKey, imageKey, syncText, syncImage, editCount, resetAll,
  pushUndo, undo, redo, canUndo, canRedo,
} from './state.js';
import { bake } from './export.js';
import { initSidebar, loadThumbnails, refreshLayers, moveLayer } from './sidebar.js';

const $ = (id) => document.getElementById(id);
const els = {
  workspace: $('workspace'), pages: $('pages'), empty: $('emptyState'), mainRow: $('mainRow'),
  dropCard: $('dropCard'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  filename: $('filename'), zoomGroup: $('zoomGroup'), toolGroup: $('toolGroup'),
  actionGroup: $('actionGroup'),
  sidebar: $('sidebar'), thumbStrip: $('thumbStrip'), layersList: $('layersList'), layersPageNum: $('layersPageNum'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), addTextBtn: $('addTextBtn'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), zoomLabel: $('zoomLabel'),
  editCount: $('editCount'), resetBtn: $('resetBtn'), newBtn: $('newBtn'), downloadBtn: $('downloadBtn'),
  propertyBar: $('propertyBar'),
  pbTextRow: $('pbTextRow'), pbSize: $('pbSize'), pbColor: $('pbColor'), pbBold: $('pbBold'), pbFont: $('pbFont'),
  pbAreaRow: $('pbAreaRow'), pbShrink: $('pbShrink'), pbGrow: $('pbGrow'), pbToggleHide: $('pbToggleHide'),
  pbMultiRow: $('pbMultiRow'), pbMultiLabel: $('pbMultiLabel'), pbMerge: $('pbMerge'),
  pbOrderRow: $('pbOrderRow'), pbBackward: $('pbBackward'), pbForward: $('pbForward'),
  pbToBack: $('pbToBack'), pbToFront: $('pbToFront'),
  pbRevert: $('pbRevert'), pbDelete: $('pbDelete'), pbClose: $('pbClose'),
  hint: $('hint'), hintClose: $('hintClose'), dragVeil: $('dragVeil'),
};

const round1 = (n) => Math.round(n * 10) / 10;
let activeTextDraft = null; // { key, rec } — seçili metnin özellik çubuğuna bağlı kaydı
let textUndoPushed = false; // bir düzenleme oturumunda geri-al kaydı yalnız ilk değişiklikte itilir
let editSnapshot = null;    // satır içi düzenleme başlarken kaydın durumu (Escape ile iptal için)

let lastLayerKey = null;
initSidebar({
  workspace: els.workspace,
  thumbs: els.thumbStrip,
  layers: els.layersList,
  layersTitle: els.layersPageNum,
  // Shift: aralık seçimi (son tıklanan katmandan buraya kadar); Ctrl/Cmd: tek
  // tek ekle-çıkar; düz tıklama: yalnız bunu seç — canvas'taki sürükleme
  // seçimiyle aynı davranış.
  onSelect: (key, ev, pageKeys) => {
    if (ev.shiftKey && lastLayerKey && pageKeys.includes(lastLayerKey)) {
      const i0 = pageKeys.indexOf(lastLayerKey);
      const i1 = pageKeys.indexOf(key);
      const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0];
      selectKeys(pageKeys.slice(a, b + 1));
    } else if (ev.metaKey || ev.ctrlKey) {
      toggleSelect(key);
    } else {
      selectOnly(key);
    }
    lastLayerKey = key;
  },
  onReorder: () => rerender(),
});

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
  els.sidebar.hidden = false;
  els.hint.hidden = localStorage.getItem('kalemHintSeen') === '1';
  closePropertyBar();
  state.scale = fitScale(els.workspace.clientWidth - 120);
  await rerender();
  loadThumbnails(state.doc);
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

// Sürükle-bırak (dosya açma) — giriş/çıkış sayacı yerine "son dragover'dan bu
// yana ne kadar geçti" tabanlı: enter/leave çiftleri alt öğe sınırlarını her
// geçişte tetiklendiği için (özellikle mobilde uygulamalar arası sürüklemede)
// simetrik gelmeyebiliyor ve perde hiç kapanmadan takılı kalabiliyordu. Ayrıca
// perde, tıklanınca da kapanır — sayaç yine de bir şekilde şaşarsa çıkış yolu olsun.
let dragHideTimer = null;
function showDragVeil() {
  clearTimeout(dragHideTimer);
  els.dragVeil.hidden = false;
  els.dropCard.classList.add('over');
  dragHideTimer = setTimeout(hideDragVeil, 300);
}
function hideDragVeil() {
  clearTimeout(dragHideTimer);
  els.dragVeil.hidden = true;
  els.dropCard.classList.remove('over');
}
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  showDragVeil();
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (![...e.dataTransfer.types].includes('Files')) return;
  showDragVeil();
});
window.addEventListener('dragend', hideDragVeil);
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  hideDragVeil();
  const file = [...e.dataTransfer.files].find((f) => /\.pdf$/i.test(f.name));
  if (file) loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
});
els.dragVeil.addEventListener('click', hideDragVeil);

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
  refreshLayers();
}
function toggleSelect(key) {
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.add(key);
  refreshItem(key);
  openPropertyBarForSelection();
  refreshLayers();
}
function clearSelectionUI() {
  if (state.editingKey) commitTextEditing();
  const prev = [...state.selected];
  state.selected.clear();
  prev.forEach(refreshItem);
  closePropertyBar();
  refreshLayers();
}
function selectKeys(keys) {
  const touched = new Set([...state.selected, ...keys]);
  state.selected.clear();
  keys.forEach((k) => state.selected.add(k));
  touched.forEach(refreshItem);
  openPropertyBarForSelection();
  refreshLayers();
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
  if (pruneIfEmptyCustom(key)) { closePropertyBar(); updateCount(); return; }
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
  if (pruneIfEmptyCustom(key)) { closePropertyBar(); updateCount(); return; }
  refreshItem(key);
  updateCount();
  if (state.selected.has(key)) openPropertyBarForSelection();
}

// ---------- Yeni metin ekleme ----------
// "Metin Ekle" ile PDF'in orijinal içeriğinde karşılığı olmayan, kullanıcının
// sayfaya tıklayarak oluşturduğu metin kutuları. state.customTexts'e kaydedilen
// taslak meta, gerçek metinlerle aynı renderTextItem/textEdits akışını kullanır.
let addTextMode = false;
function setAddTextMode(on) {
  addTextMode = on;
  els.addTextBtn.classList.toggle('on', on);
  els.workspace.classList.toggle('placing-text', on);
}
els.addTextBtn.addEventListener('click', () => setAddTextMode(!addTextMode));

function placeNewText(pageIdx, wrap, evt) {
  const pageInfo = state.pageInfos.get(pageIdx);
  if (!pageInfo) return;
  evt.preventDefault(); // varsayılan pointerdown odak davranışı, aşağıdaki .focus()'u hemen çalmasın
  setAddTextMode(false);
  const rect = wrap.getBoundingClientRect();
  const s = pageInfo.scale;
  const fs = 16;
  const x = (evt.clientX - rect.left) / s;
  const yBase = pageInfo.pdfH - (evt.clientY - rect.top) / s - fs * 0.87;
  const index = state.nextCustomTextIndex++;
  const meta = { page: pageIdx, index, str: '', x, yBase, w: 24, fs, bold: false, serif: false, custom: true };

  pushUndo();
  const list = state.customTexts.get(pageIdx) || [];
  list.push(meta);
  state.customTexts.set(pageIdx, list);

  renderTextItem(wrap, pageInfo, meta);
  startTextEditing(textKey(pageIdx, index), null);
}

// Düzenleme bittiğinde, kullanıcı hiçbir şey yazmadan bıraktığı yeni metin
// taslağını tamamen kaldırır — boş, görünmez bir kutu kalıcı olarak asılı kalmasın.
// Bir şey silindiyse true döner (çağıran normal yenileme/özellik-çubuğu akışını atlar).
function pruneIfEmptyCustom(key) {
  const ref = state.itemRefs.get(key);
  if (!ref || ref.kind !== 'text' || !ref.meta.custom || state.textEdits.has(key)) return false;
  const list = state.customTexts.get(ref.meta.page);
  if (list) {
    const idx = list.findIndex((m) => m.index === ref.meta.index);
    if (idx !== -1) list.splice(idx, 1);
  }
  state.itemRefs.delete(key);
  state.selected.delete(key);
  ref.wrap.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
  return true;
}

// ---------- Özellik çubuğu ----------
// Sabit (position:fixed) çubuk çalışma alanının üstünde yüzdüğü için, altındaki
// sayfa içeriğinin çubuğun arkasında gizlenmemesi adına .main-row'u çubuğun
// gerçek yüksekliği kadar aşağı iteriz. CSS'teki transition bu itmeyi
// yumuşatır (bkz. .main-row), böylece seçimde ani bir sıçrama olmaz.
function syncWorkspaceClearance() {
  els.mainRow.style.marginTop = els.propertyBar.hidden ? '0px' : `${els.propertyBar.offsetHeight}px`;
}

function openPropertyBarForSelection() {
  const sel = [...state.selected];
  if (!sel.length) { closePropertyBar(); return; }
  els.propertyBar.hidden = false;

  if (sel.length > 1) {
    activeTextDraft = null;
    els.pbTextRow.hidden = true;
    els.pbAreaRow.hidden = true;
    els.pbOrderRow.hidden = true;
    els.pbMultiRow.hidden = false;
    els.pbMultiLabel.textContent = `${sel.length} öğe seçili`;
    els.pbRevert.hidden = true;
    els.pbDelete.hidden = false;
    els.pbDelete.textContent = 'Seçilenleri sil';
    syncWorkspaceClearance();
    return;
  }

  const key = sel[0];
  const ref = state.itemRefs.get(key);
  if (!ref) { clearSelectionUI(); return; }
  els.pbMultiRow.hidden = true;
  els.pbOrderRow.hidden = false;

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
  syncWorkspaceClearance();
}

function closePropertyBar() {
  els.propertyBar.hidden = true;
  activeTextDraft = null;
  syncWorkspaceClearance();
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
    if (pruneIfEmptyCustom(key)) return;
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
    if (pruneIfEmptyCustom(key)) { closePropertyBar(); updateCount(); return; }
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
function recForItem(key, ref) {
  if (ref.kind === 'text') {
    return state.textEdits.get(key) || (state.editingKey === key ? state.editingDraft : null);
  }
  return state.areas.get(key);
}
function unionScreenRect(a, b) {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

// Seçili birden çok öğeyi (metin ve/veya görsel karışık olabilir), o an
// kapladıkları alanın anlık pikselini yakalayıp tek bir görsel bölgeye
// dönüştürür. Otomatik algılamanın parçalara ayırdığı bir görseli (ör. bir
// fotoğraf + ayrı algılanan bir süsleme) elle tek nesneye indirmek için —
// algılama hatalı kaldığında kullanıcının kendi düzelttiği bir kaçış yolu.
async function mergeSelected() {
  const keys = [...state.selected];
  if (keys.length < 2) return;
  const refs = keys.map((k) => [k, state.itemRefs.get(k)]).filter(([, r]) => r);
  if (refs.length < 2) return;
  const pageInfo = refs[0][1].pageInfo;
  if (!refs.every(([, r]) => r.pageInfo.page === pageInfo.page)) {
    alert('Yalnızca aynı sayfadaki öğeler birleştirilebilir.');
    return;
  }

  let rect = null;
  for (const [key, ref] of refs) {
    const r = itemScreenRect(ref, recForItem(key, ref));
    rect = rect ? unionScreenRect(rect, r) : { ...r };
  }
  const PAD = 3; // kenardaki ince çizgi/gölge de dahil olsun
  rect = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  pushUndo();

  const { bytes } = await cropToPng(pageInfo, rect.left, rect.top, rect.width, rect.height);
  const bg = sampleBgAround(pageInfo, rect.left, rect.top, rect.width, rect.height);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));

  keys.forEach((key) => deleteItem(key));

  const s = pageInfo.scale;
  const w = rect.width / s, h = rect.height / s;
  const x = rect.left / s;
  const topPdf = rect.top / s;
  const y = pageInfo.pdfH - topPdf - h;
  const index = state.nextCustomAreaIndex++;
  const meta = { page: pageInfo.page, index, x, y, w, h, custom: true };

  const list = state.customAreas.get(pageInfo.page) || [];
  list.push(meta);
  state.customAreas.set(pageInfo.page, list);

  const key = imageKey(pageInfo.page, index);
  state.areas.set(key, { meta, dx: 0, dy: 0, scale: 1, hidden: false, bg, png: bytes, url });
  renderImageItem(pageInfo.wrap, pageInfo, meta);
  selectOnly(key);
  updateCount();
}
els.pbMerge.addEventListener('click', mergeSelected);

function moveSelectedLayer(mode) {
  const key = [...state.selected][0];
  if (!key) return;
  pushUndo();
  moveLayer(key, mode);
  rerender();
}
els.pbBackward.addEventListener('click', () => moveSelectedLayer('backward'));
els.pbForward.addEventListener('click', () => moveSelectedLayer('forward'));
els.pbToBack.addEventListener('click', () => moveSelectedLayer('back'));
els.pbToFront.addEventListener('click', () => moveSelectedLayer('front'));

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
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
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
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
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
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) { updateCount(); openPropertyBarForSelection(); }
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------- Olay yönlendirme (pdfview.js -> main.js) ----------
state.onTextPointerDown = (fullMeta, key, el, evt) => {
  if (state.editingKey === key) return; // zaten düzenleniyor: doğal imleç davranışına izin ver
  beginItemGesture(key, evt);
};
state.onImagePointerDown = (meta, key, el, evt) => {
  beginItemGesture(key, evt);
};
state.onPageMouseDown = (pageIdx, wrap, evt) => {
  if (addTextMode) { placeNewText(pageIdx, wrap, evt); return; }
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
els.workspace.addEventListener('pointerdown', (e) => {
  if (e.target === els.workspace || e.target === els.pages) clearSelectionUI();
});

// ---------- Klavye ----------
window.addEventListener('keydown', (e) => {
  const inField = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)
    || document.activeElement?.isContentEditable;
  if (e.key === 'Escape') { setAddTextMode(false); clearSelectionUI(); return; }
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
  refreshLayers();
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
