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

- [x] **AI ile Düzenle** — üretimde canlı (4 Eyl 2026). `server/ai-proxy`
      NVIDIA API anahtarını istemciden gizleyen vekil sunucu (origin
      allowlist, IP + günlük hız sınırı, genel hata maskeleme) +
      metin özellik çubuğundaki "✦" düğmesi. Anahtar yalnızca sunucudaki
      git-ignore'lu `.env` dosyalarında; hiçbir commit'e girmedi.
      Dağıtım: paylaşımlı Windows Server'da `kalem-ai-proxy` NSSM servisi
      (yalnız `127.0.0.1:8790`'ı dinler — 8787 DEĞİL, çünkü agency-backend
      o portu kendi iç amacıyla zaten kullanıyordu, çakışma kurulum
      sırasında tespit edilip agency-backend'e dokunmadan çözüldü),
      Caddy'nin `handle /api/*` bloğuyla genel adrese bağlandı. Tuval
      paneli ve IsTakip dağıtım sırasında ve sonrasında doğrulandı,
      etkilenmediler.
      **14 Eyl 2026 — alan adı taşındı:** artık `https://kalem.tuvalcreative.com`
      (Turhost DNS, aynı sunucu IP'si `45.43.154.40`'a A kaydıyla
      yönlendirildi). Eski `kalem-pdf.duckdns.org` kullanıcı talebiyle
      tamamen kapatıldı — Caddy'de o bloğu kaldırıldı, artık yanıt
      vermiyor.
  - OCR (metin katmanı olmayan taranmış PDF'ler)
  - PDF ↔ Office (Word/Excel/PowerPoint) dönüşümü
  - Gerçek HTML → PDF
  - Tam PDF/A uyumluluğu
  - Gerçek redaksiyon (içerik geri getirilemez silme)
