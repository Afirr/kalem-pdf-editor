// pdfjs-dist yalnızca OPS sabitleri için import edilse bile, kütüphanenin
// canvas görüntüleme modülü üst düzeyde `new DOMMatrix()` çalıştırıyor —
// Node test ortamında bu tarayıcı global'i yok. jsdom gibi ağır bir DOM
// simülasyonu kurmak yerine (bu proje DOM/dokunmatik davranışını yalnız
// gerçek tarayıcı/simülatörde doğruluyor), ithalatın çökmemesi için gereken
// tek global'i buradan sağlıyoruz.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {};
}
