// Kalem "AI ile Düzenle" vekil sunucusu. Tek görevi: NVIDIA API anahtarını
// istemciye hiç göstermeden, kullanıcının seçtiği metni verdiği talimata göre
// düzenletmek. Kalem'in geri kalanı %100 istemci taraflıdır — bu servis
// İSTEĞE BAĞLI bir eklentidir, ana PDF düzenleme akışı bu servis çalışmasa
// da çalışmaya devam eder.
import express from 'express';

const PORT = Number(process.env.PORT || 8787);
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5199,https://kalem.tuvalcreative.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!NVIDIA_API_KEY) {
  console.error('NVIDIA_API_KEY tanımlı değil. .env dosyasını kontrol et.');
  process.exit(1);
}

const MAX_TEXT_LEN = 4000;
const MAX_INSTRUCTION_LEN = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const UPSTREAM_TIMEOUT_MS = 30_000;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 300);

// Basit, tek-örnekli bellek-içi hız sınırlama. Dağıtık/çok-örnekli bir
// dağıtımda işe yaramaz ama bu servis tek bir küçük Windows sunucusunda tek
// süreç olarak çalışacağı için amaca yetiyor — asıl amaç NVIDIA kotasının
// tek bir kötü niyetli istemci tarafından tüketilmesini zorlaştırmak.
const hits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// CORS Origin kontrolü yalnızca TARAYICIDAN gelen istekleri süzer — bu uç
// nokta bir kez public'e çıktığında, Origin başlığı olmayan doğrudan bir
// script (curl, sunucudan sunucuya) CORS'u tamamen atlayabilir. Statik bir
// ön yüz zaten hiçbir "sırrı" gizleyemeyeceği için (kaynağı herkese açık),
// buradaki gerçek güvenlik sınırı IP başına hız sınırı + günlük genel kota —
// CORS yalnızca rastgele başka bir web sitesinin tarayıcıdan sessizce
// çağırmasını engelleyen ek bir katman.
let dailyCount = 0;
let dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
function isDailyLimitExceeded() {
  const now = Date.now();
  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  dailyCount += 1;
  return dailyCount > DAILY_LIMIT;
}

const app = express();
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'İzin verilmeyen kaynak.' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// NVIDIA'ya hiç istek atmaz; yalnızca servisin ayakta olduğunu doğrular
// (bkz. C:\kalem\health-check.ps1 deseniyle aynı amaç).
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/ai-edit', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Çok fazla istek. Biraz sonra tekrar dene.' });
    return;
  }
  if (isDailyLimitExceeded()) {
    res.status(429).json({ error: 'Günlük AI kullanım kotası doldu. Yarın tekrar dene.' });
    return;
  }

  const { text, instruction } = req.body || {};
  if (typeof text !== 'string' || typeof instruction !== 'string' || !text.trim() || !instruction.trim()) {
    res.status(400).json({ error: 'Eksik veya geçersiz istek: text ve instruction gerekli.' });
    return;
  }
  if (text.length > MAX_TEXT_LEN || instruction.length > MAX_INSTRUCTION_LEN) {
    res.status(413).json({ error: 'Metin ya da talimat çok uzun.' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Sen bir PDF metin düzenleme asistanısın. Sana bir metin ve bu metne uygulanacak bir talimat verilecek. ' +
              'YALNIZCA düzenlenmiş metni döndür — açıklama, tırnak işareti veya ek yorum EKLEME.',
          },
          { role: 'user', content: `Talimat: ${instruction}\n\nMetin:\n${text}` },
        ],
        temperature: 0.4,
        max_tokens: 2048,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      console.error('NVIDIA upstream hatası:', upstream.status, await upstream.text().catch(() => ''));
      res.status(502).json({ error: 'AI servisi şu an yanıt vermiyor.' });
      return;
    }

    const data = await upstream.json();
    const result = data?.choices?.[0]?.message?.content?.trim();
    if (!result) {
      res.status(502).json({ error: 'AI servisi boş yanıt döndürdü.' });
      return;
    }
    res.status(200).json({ result });
  } catch (err) {
    console.error('AI ile Düzenle isteği başarısız:', err.name === 'AbortError' ? 'zaman aşımı' : err.message);
    res.status(502).json({ error: 'AI servisine ulaşılamadı.' });
  } finally {
    clearTimeout(timeout);
  }
});

// Express'in varsayılan hata işleyicisi hatayı/stack trace'i istemciye
// geri yazar (ör. body-parser'ın "payload too large" hatası) — bunu 4
// parametreli bu ara katmanla eziyoruz ki hiçbir iç detay dışarı sızmasın.
app.use((err, _req, res, _next) => {
  console.error('Beklenmeyen hata:', err.message);
  res.status(err.status || 500).json({ error: 'İstek işlenemedi.' });
});

app.listen(PORT, () => {
  console.log(`kalem-ai-proxy dinliyor: http://localhost:${PORT}`);
});
