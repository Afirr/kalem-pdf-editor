// Uygulama durumu: PDF, metin düzeltmeleri, taşınan/gizlenen görsel alanlar, seçim.
export const state = {
  doc: null,
  bytes: null,
  name: '',
  scale: 1.3,

  textEdits: new Map(), // "t:sayfa:indeks" -> kayıt (yalnızca değiştirilmiş öğeler)
  areas: new Map(),     // "a:id" -> kayıt (yakalanmış görsel/logo alanları)
  selected: new Set(),  // seçili anahtarlar (metin + alan karışık olabilir)
  nextAreaId: 1,

  // Son çizimde her anahtarın hangi sayfa/kutuya ait olduğunu tutar (main.js sürükleme
  // ve düzenleme sırasında bu kayıtlardan sayfa bilgisine ulaşır).
  itemRefs: new Map(),
  // Sayfa indeksi -> {canvas, dpr, pdfH, scale, wrap, page} — metin öğesi olmayan
  // sayfalarda bile alan yakalama aracının çalışabilmesi için.
  pageInfos: new Map(),

  // main.js tarafından atanan olay geri çağrıları
  onTextPointerDown: null, // (fullMeta, key, el, evt) => void
  onAreaPointerDown: null, // (rec, el, evt) => void
  onPageMouseDown: null,   // (pageIndex, wrapEl, evt) => void
};

export function textKey(page, index) {
  return `t:${page}:${index}`;
}
export function areaKey(id) {
  return `a:${id}`;
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

export function editCount() {
  return state.textEdits.size + state.areas.size;
}

export function resetAll() {
  state.textEdits.clear();
  state.areas.clear();
  state.selected.clear();
  state.itemRefs.clear();
  state.pageInfos.clear();
  state.nextAreaId = 1;
}
