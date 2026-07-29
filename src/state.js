// Uygulama durumu: PDF, metin düzeltmeleri, otomatik algılanan görsellerdeki
// değişiklikler, seçim, satır içi düzenleme ve geri al/ileri al geçmişi.
export const state = {
  doc: null,
  bytes: null,
  name: '',
  scale: 1.3,

  textEdits: new Map(), // "t:sayfa:indeks" -> kayıt (yalnızca değiştirilmiş metinler)
  areas: new Map(),     // "i:sayfa:indeks" -> kayıt (yalnızca değiştirilmiş/taşınmış görseller)
  selected: new Set(),  // seçili anahtarlar (metin + görsel karışık olabilir)
  history: { undo: [], redo: [] }, // geri al / ileri al yığınları (bkz. pushUndo/undo/redo)

  // Kullanıcının "Metin Ekle" ile sayfaya eklediği, PDF'in orijinal içeriğinde
  // karşılığı olmayan metin kutularının taslak (meta) listesi: sayfa indeksi ->
  // meta[]. Her render'da gerçek metinlerle birlikte yeniden çizilir.
  customTexts: new Map(),
  nextCustomTextIndex: 1000000,

  // Kullanıcının katman panelinden birden çok öğeyi "Birleştir" ile tek bir
  // görsele dönüştürdüğü, PDF'in orijinal içeriğinde karşılığı olmayan
  // bölgelerin taslak (meta) listesi: sayfa indeksi -> meta[].
  customAreas: new Map(),
  nextCustomAreaIndex: 2000000,

  // Katman (yığılma/z) sırası: sayfa indeksi -> anahtar[] (alttan üste).
  // Katman panelinden sürükleyerek yeniden sıralanabilir; boşsa renderPage
  // doğal algılama sırasını kullanıp burayı doldurur.
  zOrder: new Map(),

  // Son çizimde her anahtarın hangi sayfa/kutuya ait olduğunu tutar (main.js sürükleme,
  // yeniden boyutlandırma ve düzenleme sırasında bu kayıtlardan sayfa bilgisine ulaşır).
  itemRefs: new Map(),
  // Sayfa indeksi -> {canvas, dpr, pdfH, scale, wrap, page}
  pageInfos: new Map(),

  // Şu an satır içi (imleçle) düzenlenen metin öğesinin anahtarı, yoksa null.
  editingKey: null,
  // editingKey doluyken, henüz "dirty" olmadığı için textEdits'e eklenmemiş taslak kayıt.
  editingDraft: null,

  // main.js tarafından atanan olay geri çağrıları
  onTextPointerDown: null,   // (fullMeta, key, el, evt) => void
  onImagePointerDown: null,  // (meta, key, el, evt) => void
  onPageMouseDown: null,     // (pageIndex, wrapEl, evt) => void
  onResizeHandleDown: null,  // (key, evt) => void
  onDeleteClick: null,       // (key) => void
};

export function textKey(page, index) {
  return `t:${page}:${index}`;
}
export function imageKey(page, index) {
  return `i:${page}:${index}`;
}

const EPS = 0.02;

export function isTextDirty(rec) {
  return (
    rec.text !== rec.meta.str ||
    Math.abs(rec.size - rec.meta.fs) > EPS ||
    rec.bold !== rec.meta.bold ||
    rec.serif !== rec.meta.serif ||
    rec.color !== rec.baseColor ||
    Math.abs(rec.dx) > EPS ||
    Math.abs(rec.dy) > EPS
  );
}

// Kaydı, değişmişse haritaya ekler; değişmemişse haritadan çıkarır.
export function syncText(rec) {
  const key = textKey(rec.meta.page, rec.meta.index);
  if (isTextDirty(rec)) state.textEdits.set(key, rec);
  else state.textEdits.delete(key);
  return key;
}

export function isImageDirty(rec) {
  return (
    rec.meta.custom || // "Birleştir" ile oluşturulan bölgenin orijinali yok, her zaman gerçek bir düzeltmedir
    Math.abs(rec.dx) > EPS ||
    Math.abs(rec.dy) > EPS ||
    Math.abs(rec.scale - 1) > EPS ||
    rec.hidden
  );
}

export function syncImage(rec) {
  const key = imageKey(rec.meta.page, rec.meta.index);
  if (isImageDirty(rec)) state.areas.set(key, rec);
  else state.areas.delete(key);
  return key;
}

export function editCount() {
  return state.textEdits.size + state.areas.size;
}

export function resetAll() {
  state.textEdits.clear();
  state.areas.clear();
  state.selected.clear();
  state.itemRefs.clear();
  state.pageInfos.clear();
  state.customTexts.clear();
  state.nextCustomTextIndex = 1000000;
  state.customAreas.clear();
  state.nextCustomAreaIndex = 2000000;
  state.zOrder.clear();
  state.editingKey = null;
  state.editingDraft = null;
  state.history.undo.length = 0;
  state.history.redo.length = 0;
}

// ---------- Geri al / ileri al ----------
// png/url/meta gibi hiç mutasyona uğramayan alanlar referansla paylaşılır;
// yalnızca değişebilen alanların sığ kopyası alınır.
function snapshot() {
  return {
    textEdits: [...state.textEdits.entries()].map(([k, r]) => [k, { ...r }]),
    areas: [...state.areas.entries()].map(([k, r]) => [k, { ...r }]),
    customTexts: [...state.customTexts.entries()].map(([k, list]) => [k, list.map((m) => ({ ...m }))]),
    customAreas: [...state.customAreas.entries()].map(([k, list]) => [k, list.map((m) => ({ ...m }))]),
    zOrder: [...state.zOrder.entries()].map(([k, list]) => [k, [...list]]),
  };
}

function restoreSnapshot(snap) {
  state.textEdits = new Map(snap.textEdits.map(([k, r]) => [k, { ...r }]));
  state.areas = new Map(snap.areas.map(([k, r]) => [k, { ...r }]));
  state.customTexts = new Map(snap.customTexts.map(([k, list]) => [k, list.map((m) => ({ ...m }))]));
  state.customAreas = new Map(snap.customAreas.map(([k, list]) => [k, list.map((m) => ({ ...m }))]));
  state.zOrder = new Map((snap.zOrder || []).map(([k, list]) => [k, [...list]]));
}

const HISTORY_LIMIT = 60;

// Bir değişiklikten HEMEN ÖNCE çağrılır: mevcut durumu geri al yığınına iter.
export function pushUndo() {
  state.history.undo.push(snapshot());
  if (state.history.undo.length > HISTORY_LIMIT) state.history.undo.shift();
  state.history.redo.length = 0;
}

export function canUndo() {
  return state.history.undo.length > 0;
}
export function canRedo() {
  return state.history.redo.length > 0;
}

export function undo() {
  if (!canUndo()) return false;
  const cur = snapshot();
  const prev = state.history.undo.pop();
  state.history.redo.push(cur);
  restoreSnapshot(prev);
  return true;
}

export function redo() {
  if (!canRedo()) return false;
  const cur = snapshot();
  const next = state.history.redo.pop();
  state.history.undo.push(cur);
  restoreSnapshot(next);
  return true;
}
