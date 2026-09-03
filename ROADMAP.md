# Kalem — iLovePDF özellik yol haritası

Kalem'in çekirdek ilkesi: %100 istemci taraflı, sunucu yok, dosya hiç
cihazdan çıkmıyor. Bu ilkeyi bozan her madde (Faz 3) kullanıcı onayı
olmadan başlatılmaz.

## Faz 1 — pdf-lib/pdf.js ile doğrudan yapılabilenler

- [x] Sayfaları Düzenle (döndür/sil/yeniden sırala) — `src/pageOrganize.js`,
      `src/engine/pages.js`
- [ ] Birleştir (Merge)
- [ ] Böl/Ayıkla (Split/Extract)
- [ ] Sayfa numarası ekle
- [ ] Filigran (Watermark)
- [ ] Kırp (Crop)
- [ ] PDF → JPG
- [ ] JPG → PDF
- [ ] Basit imza (çizim/metin damgası)

## Faz 2 — pdf-lib ile mümkün ama daha riskli/kısıtlı

- [ ] Şifre koy/kaldır (pdf-lib'in desteği araştırılacak)

## Faz 3 — mimariyi bozan, ONAY GEREKTİREN maddeler

Bunların hiçbiri "sıradaki iş" olarak otonom başlatılmaz; her biri için
önce kullanıcıyla mimari karar netleşmeli.

- [ ] **AI ile Düzenle** — NVIDIA API (`nvidia/nemotron-3-super-120b-a12b`,
      OpenAI-uyumlu `integrate.api.nvidia.com`) kullanılacak.
      **Engel:** API anahtarı istemci tarafına asla gömülemez (herkese açık
      JS paketinde/ağ sekmesinde görünür, kota çalınabilir). Bu, Kalem'in
      ilk backend bileşeni olacak — küçük bir vekil (proxy) sunucu
      gerektiriyor. Kullanıcının paylaştığı anahtar sohbette açığa çıktığı
      için ROTATE edilmeli; yeni anahtar asla koda/commit'e yazılmayacak,
      yalnızca sunucu ortam değişkeni olarak saklanacak. Nereye
      konuşlandırılacağı (mevcut paylaşımlı Windows Server mı, ayrı bir
      servis mi) kullanıcı onayı bekliyor.
  - OCR (metin katmanı olmayan taranmış PDF'ler)
  - PDF ↔ Office (Word/Excel/PowerPoint) dönüşümü
  - Gerçek HTML → PDF
  - Tam PDF/A uyumluluğu
  - Gerçek redaksiyon (içerik geri getirilemez silme)
