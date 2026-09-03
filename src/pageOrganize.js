// PDF açıldığında, metin/görsel düzenlemesi BAŞLAMADAN ÖNCE gösterilen sayfa
// düzenleme ekranı: sürükleyerek sırala, döndür, sil. "Devam Et" ile onaylanan
// sıra src/engine/pages.js'teki applyPageOperations()'a verilip PDF baytları
// YENİDEN üretiliyor — asıl editör (pdfview.js/state.js) bu YENİ baytları
// açıyor, dolayısıyla meta.page indekslerinin sayfa silme/taşımadan sonra
// yeniden hesaplanması hiç gerekmiyor (bkz. pages.js başındaki not).
//
// Sürükle-sırala: main.js'teki beginItemGesture ile aynı 3px eşiği kullanır,
// ama TEK BOYUTLU liste yerine 2 BOYUTLU (satır saran) bir ızgarada — hedef
// konum, imlecin diğer küçük resimlerin MERKEZİNE göre en yakın olduğu
// komşu ile belirlenir (sidebar.js'teki lineer rowAfterPoint'in ızgara
// karşılığı).

const THUMB_W = 150;

export async function showPageOrganizer(doc, container) {
  return new Promise((resolve) => {
    const grid = container.querySelector('#poGrid');
    grid.innerHTML = '';

    (async () => {
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);

        const thumb = document.createElement('div');
        thumb.className = 'po-thumb';
        thumb.dataset.originalIndex = String(i);
        thumb.dataset.rotate = '0';

        const canvas = document.createElement('canvas');
        thumb.appendChild(canvas);

        // CSS transform:rotate ile döndürmek yerine pdf.js'in KENDİ rotation
        // parametresiyle her döndürmede yeniden çiziyoruz — böylece 90/270'te
        // genişlik/yükseklik doğru yer değiştiriyor ve küçük resim kutusu
        // (overflow:hidden) döndürülmüş içeriği KIRPMIYOR.
        async function renderAtDelta(delta) {
          const totalRotation = (page.rotate + delta + 360) % 360;
          const unscaled = page.getViewport({ scale: 1, rotation: totalRotation });
          const scale = THUMB_W / unscaled.width;
          const vp = page.getViewport({ scale, rotation: totalRotation });
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        }

        const num = document.createElement('span');
        num.className = 'po-thumb-num';
        num.textContent = String(i + 1);
        thumb.appendChild(num);

        const actions = document.createElement('div');
        actions.className = 'po-thumb-actions';
        const rotateBtn = document.createElement('button');
        rotateBtn.type = 'button';
        rotateBtn.title = 'Döndür';
        rotateBtn.textContent = '↻';
        rotateBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const next = (Number(thumb.dataset.rotate) + 90) % 360;
          thumb.dataset.rotate = String(next);
          renderAtDelta(next);
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.title = 'Sil';
        delBtn.textContent = '×';
        delBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (grid.querySelectorAll('.po-thumb:not(.removing)').length <= 1) {
            alert('En az bir sayfa kalmalı.');
            return;
          }
          thumb.classList.toggle('removing');
        });
        actions.appendChild(rotateBtn);
        actions.appendChild(delBtn);
        thumb.appendChild(actions);

        thumb.addEventListener('pointerdown', (ev) => beginDragGesture(thumb, ev));
        grid.appendChild(thumb);

        await renderAtDelta(0);
      }
    })();

    function beginDragGesture(thumb, evt) {
      if (evt.target.closest('.po-thumb-actions')) return; // buton tıklamasıyla çakışmasın
      evt.preventDefault();
      const startX = evt.clientX;
      const startY = evt.clientY;
      let dragging = false;

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < 3) return;
        if (!dragging) { dragging = true; thumb.classList.add('dragging'); }
        const target = closestOtherThumb(e.clientX, e.clientY, thumb);
        if (target) {
          const rect = target.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          grid.insertBefore(thumb, before ? target : target.nextSibling);
        }
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        thumb.classList.remove('dragging');
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    function closestOtherThumb(x, y, exclude) {
      let best = null;
      let bestDist = Infinity;
      for (const el of grid.querySelectorAll('.po-thumb')) {
        if (el === exclude) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestDist) { bestDist = d; best = el; }
      }
      return best;
    }

    function finish(order) {
      container.hidden = true;
      resolve(order);
    }

    container.querySelector('#poSkip').onclick = () => finish(null);
    container.querySelector('#poApply').onclick = () => {
      const order = [...grid.querySelectorAll('.po-thumb:not(.removing)')].map((el) => ({
        originalIndex: Number(el.dataset.originalIndex),
        rotate: Number(el.dataset.rotate),
      }));
      if (!order.length) { alert('En az bir sayfa kalmalı.'); return; }
      finish(order);
    };

    container.hidden = false;
  });
}
