// Araç çubuğu taşma menüsü: sabit bir breakpoint yerine ResizeObserver ile
// gerçek taşmayı (scrollWidth > clientWidth) ölçer — Capacitor WKWebView'in
// iPad Split View/Slide Over gibi öngörülemeyen genişliklerini de kapsar.
// Taşınca zoomGroup + resetBtn + newBtn "..." panele alınır (brand, undo/redo/
// metin ekle ve indirme her zaman görünür kalır).
export function initToolbarOverflow({ toolbar, moreBtn, overflowPanel, zoomGroup, zoomGroupAnchor, actionGroup, resetBtn, newBtn, reinsertBefore }) {
  const movable = [zoomGroup, resetBtn, newBtn];
  let collapsed = false;

  function apply(shouldCollapse) {
    if (shouldCollapse === collapsed) return;
    collapsed = shouldCollapse;
    if (collapsed) {
      movable.forEach((el) => overflowPanel.appendChild(el));
      moreBtn.hidden = false;
    } else {
      toolbar.insertBefore(zoomGroup, zoomGroupAnchor); // orijinal sırada zoomGroup, toolGroup'tan hemen önce
      reinsertBefore.before(resetBtn, newBtn);
      moreBtn.hidden = true;
      overflowPanel.hidden = true;
    }
  }

  const ro = new ResizeObserver(() => {
    // Önce genişlet (gerçek taşmayı ölçebilmek için), sonra AYNI mikro-görevde
    // scrollWidth'i oku — bu, tarayıcıyı senkron bir layout hesaplamaya
    // zorlar (forced reflow) ve gerçek taşmayı boyanmış bir kare beklemeden
    // verir. requestAnimationFrame'e kasıtlı olarak GÜVENİLMİYOR: sekme
    // arka planda/görünür değilken (document.hidden) rAF hiç tetiklenmez,
    // bu da taşma menüsünü kalıcı olarak yanlış durumda bırakırdı.
    apply(false);
    apply(toolbar.scrollWidth > toolbar.clientWidth + 1);
  });
  // Yalnızca toolbar'ın KENDİ kutusu değil (bu yalnız pencere yeniden
  // boyutlanınca değişir), zoomGroup/actionGroup'un hidden->görünür geçişi de
  // (main.js'te loadFile() PDF açılınca bunları unhide ediyor) bir boyut
  // değişikliği olarak izlenmeli — aksi hâlde PDF yüklenip toolbar içeriği
  // taştığında toolbar'ın kendi genişliği (viewport'a sabit) değişmediği
  // için ResizeObserver hiç tetiklenmez.
  [toolbar, zoomGroup, actionGroup].forEach((el) => ro.observe(el));

  moreBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    overflowPanel.hidden = !overflowPanel.hidden;
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!overflowPanel.hidden && !overflowPanel.contains(ev.target) && ev.target !== moreBtn) {
      overflowPanel.hidden = true;
    }
  });
}
