// Kalem — arayüz bağlantıları
import {
  state, openPdf, renderAll, fitScale, sampleColors,
  paintEdit, clearEditPaint, editKey,
} from './pdfview.js';
import { bake } from './export.js';

const $ = (id) => document.getElementById(id);
const els = {
  workspace: $('workspace'), pages: $('pages'), empty: $('emptyState'),
  dropCard: $('dropCard'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  filename: $('filename'), zoomGroup: $('zoomGroup'), actionGroup: $('actionGroup'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), zoomLabel: $('zoomLabel'),
  editCount: $('editCount'), resetBtn: $('resetBtn'), newBtn: $('newBtn'),
  downloadBtn: $('downloadBtn'), editor: $('editor'), editorText: $('editorText'),
  editorSize: $('editorSize'), editorColor: $('editorColor'), editorBold: $('editorBold'),
  editorFont: $('editorFont'), editorApply: $('editorApply'), editorCancel: $('editorCancel'),
  editorRevert: $('editorRevert'), hint: $('hint'), hintClose: $('hintClose'),
  dragVeil: $('dragVeil'),
};

let current = null; // { meta, box }

// ---------- PDF açma ----------
async function loadFile(bytes, name) {
  try {
    await openPdf(bytes, name);
  } catch (err) {
    alert('Bu dosya açılamadı. Şifreli ya da bozuk bir PDF olabilir.\n\n' + err.message);
    return;
  }
  els.empty.hidden = true;
  els.zoomGroup.hidden = false;
  els.actionGroup.hidden = false;
  els.filename.hidden = false;
  els.filename.textContent = name;
  els.hint.hidden = localStorage.getItem('kalemHintSeen') === '1';
  state.scale = fitScale(els.workspace.clientWidth - 120);
  await rerender();
}

async function rerender() {
  closeEditor();
  els.zoomLabel.textContent = Math.round(state.scale * 100) + '%';
  await renderAll(els.pages);
  updateCount();
}

els.pickBtn.addEventListener('click', () => els.fileInput.click());
els.newBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
  els.fileInput.value = '';
});

// Sürükle-bırak
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

// ---------- Düzenleme kutusu ----------
state.onItemClick = (meta, box) => {
  closeEditor();
  current = { meta, box };
  box.classList.add('active');

  const existing = state.edits.get(editKey(meta));
  const sampled = existing ? null : sampleColors(meta);

  els.editorText.value = existing ? existing.text : meta.str;
  els.editorSize.value = existing ? existing.size : +meta.fs.toFixed(1);
  els.editorColor.value = existing ? existing.color : sampled.color;
  els.editorBold.classList.toggle('on', existing ? existing.bold : meta.bold);
  els.editorFont.value = (existing ? existing.serif : meta.serif) ? 'serif' : 'sans';
  els.editor.dataset.bg = existing ? existing.bg : sampled.bg;
  els.editorRevert.hidden = !existing;

  els.editor.hidden = false;
  placeEditor(box);
  els.editorText.focus();
  els.editorText.select();
  autoGrow();
};

function placeEditor(box) {
  const r = box.getBoundingClientRect();
  const ew = els.editor.offsetWidth;
  const eh = els.editor.offsetHeight;
  let left = Math.min(Math.max(10, r.left), window.innerWidth - ew - 10);
  let top = r.bottom + 8;
  if (top + eh > window.innerHeight - 10) top = Math.max(10, r.top - eh - 8);
  els.editor.style.left = left + 'px';
  els.editor.style.top = top + 'px';
}

function autoGrow() {
  els.editorText.style.height = 'auto';
  els.editorText.style.height = Math.min(180, els.editorText.scrollHeight) + 'px';
}
els.editorText.addEventListener('input', autoGrow);

function closeEditor() {
  els.editor.hidden = true;
  if (current) current.box.classList.remove('active');
  current = null;
}

function applyEdit() {
  if (!current) return;
  const { meta, box } = current;
  const text = els.editorText.value;
  const edit = {
    text,
    size: parseFloat(els.editorSize.value) || meta.fs,
    color: els.editorColor.value,
    bold: els.editorBold.classList.contains('on'),
    serif: els.editorFont.value === 'serif',
    bg: els.editor.dataset.bg,
    meta,
  };
  if (text === meta.str) {
    // metin aynıysa ve stil de değişmediyse düzeltme sayma
    const styleSame =
      Math.abs(edit.size - meta.fs) < 0.05 && edit.bold === meta.bold && edit.serif === meta.serif;
    if (styleSame && !state.edits.has(editKey(meta))) { closeEditor(); return; }
  }
  state.edits.set(editKey(meta), edit);
  paintEdit(box, meta, edit);
  updateCount();
  closeEditor();
}

function revertEdit() {
  if (!current) return;
  state.edits.delete(editKey(current.meta));
  clearEditPaint(current.box);
  updateCount();
  closeEditor();
}

els.editorApply.addEventListener('click', applyEdit);
els.editorCancel.addEventListener('click', closeEditor);
els.editorRevert.addEventListener('click', revertEdit);
els.editorBold.addEventListener('click', () => els.editorBold.classList.toggle('on'));
els.editorText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyEdit(); }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeEditor();
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); download(); }
});
els.workspace.addEventListener('click', (e) => {
  if (!els.editor.hidden && !els.editor.contains(e.target)) closeEditor();
});

// ---------- Sayaç / sıfırla / indir ----------
function updateCount() {
  const n = state.edits.size;
  els.editCount.hidden = n === 0;
  els.editCount.textContent = n === 1 ? '1 düzeltme' : `${n} düzeltme`;
  els.downloadBtn.disabled = n === 0;
}

els.resetBtn.addEventListener('click', () => {
  if (!state.edits.size) return;
  if (!confirm('Tüm düzeltmeler silinsin mi?')) return;
  state.edits.clear();
  rerender();
});

async function download() {
  if (!state.edits.size || els.downloadBtn.disabled) return;
  els.downloadBtn.disabled = true;
  els.downloadBtn.textContent = 'Hazırlanıyor…';
  try {
    const out = await bake(state.bytes, state.edits);
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
  async previewBaked() {
    const out = await bake(state.bytes, state.edits);
    const edits = new Map(state.edits);
    await loadFile(new Uint8Array(out), 'önizleme.pdf');
    return edits.size;
  },
};
