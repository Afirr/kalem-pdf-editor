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

- [x] **AI ile Düzenle** — yerel geliştirmede tamamlandı ve gerçek Chrome'da
      uçtan uca doğrulandı: `server/ai-proxy` (NVIDIA API anahtarını
      istemciden gizleyen vekil sunucu — origin allowlist, IP + günlük hız
      sınırı, genel hata maskeleme) + metin özellik çubuğundaki "✦" düğmesi.
      Anahtar yalnızca yerel, git-ignore'lu `server/ai-proxy/.env` dosyasında;
      commit'e hiç girmedi.
      **Kalan:** [ ] Üretime dağıtım — Kalem'in ilk backend bileşeni,
      paylaşımlı Windows Server'a mı yoksa ayrı bir servise mi
      konuşlandırılacağı kullanıcı onayı bekliyor.
  - OCR (metin katmanı olmayan taranmış PDF'ler)
  - PDF ↔ Office (Word/Excel/PowerPoint) dönüşümü
  - Gerçek HTML → PDF
  - Tam PDF/A uyumluluğu
  - Gerçek redaksiyon (içerik geri getirilemez silme)
