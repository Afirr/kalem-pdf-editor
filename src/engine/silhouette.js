// Kırpılmış bir görsel PNG'sinin köşelerinden başlayan bir "sihirli değnek"
// (flood-fill) ile ARKA PLANI bulur — fotoğrafın kendisini "tanımaya"
// ÇALIŞMAZ, yalnızca köşelerdeki düz zemin rengine bitişik-ve-benzer
// pikselleri işaretler. Böylece PDF'teki dairesel/keyfi kırpmanın PDF'te
// clip/SMask/image-mask'ten HANGİSİYLE kodlandığı hiç bilinmeden, zaten
// pdf.js'in render ettiği PİKSELDEN yola çıkarak bir alfa maskesi üretilebilir.
//
// document/window KULLANILMAZ (regions.js ile aynı saflık kuralı) — girdi düz
// bir RGBA piksel tamponu (canvas'tan gelmiş olabilir, ama bu modül canvas'ı
// hiç bilmez), böylece Vitest'te gerçek bir DOM/canvas olmadan test edilebilir.
//
// NOT: Eşik değerleri (tolerance, min/maxBackgroundRatio) yalnızca TEK bir
// sentetik senaryoyla (düz panel + dokulu daire) ampirik olarak kalibre
// edildi — GERÇEK PDF'lerle (farklı ışıklandırma/gradyan zeminler, JPEG
// sıkıştırma gürültüsü) yeniden kalibre edilmesi gerekir.

const DEFAULTS = {
  tolerance: 40,                 // köşe rengine Öklid uzaklığı bu değerin altındaysa "arka plan" sayılır
  cornerAgreementTolerance: 40,  // 4 köşenin renkleri birbirinden bu kadardan FAZLA uzaksa güvenilmez say
  cornerBlock: 3,                // köşe rengini örneklerken kullanılan NxN blok (anti-alias/gürültü payı)
  minBackgroundRatio: 0.03,      // bulunan "arka plan" oranı bunun altındaysa gerçek bir kırpma yok say
  maxBackgroundRatio: 0.97,      // bunun üstündeyse (hemen hemen her şey "arka plan") güvenilmez say
  maxPixels: 6_000_000,          // bundan büyük kırpmalarda flood-fill'i hiç çalıştırma (performans)
};

function averageBlock(rgba, width, height, cx, cy, block) {
  const half = Math.floor(block / 2);
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.max(0, cx - half), x1 = Math.min(width - 1, cx + half);
  const y0 = Math.max(0, cy - half), y1 = Math.min(height - 1, cy + half);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * width + x) * 4;
      r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; n++;
    }
  }
  return [r / n, g / n, b / n];
}

function distSq3(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * @param {Uint8ClampedArray|Uint8Array} rgba - width*height*4 boyutunda düz RGBA tamponu
 * @param {number} width
 * @param {number} height
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{
 *   applied: boolean,
 *   mask: Uint8Array|null,   // width*height, 1 = arka plan (şeffaflaştırılacak), 0 = korunacak içerik
 *   backgroundRatio: number, // 0-1
 *   refColor: {r:number,g:number,b:number}|null, // tespit edilen zemin rengi
 *   reason: string|null,     // applied=false ise neden: 'too-small'|'too-large'|'corners-disagree'|'ratio-too-low'|'ratio-too-high'|null
 * }}
 */
export function computeBackgroundMask(rgba, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const total = width * height;

  if (width < 3 || height < 3) {
    return { applied: false, mask: null, backgroundRatio: 0, refColor: null, reason: 'too-small' };
  }
  if (total > opts.maxPixels) {
    return { applied: false, mask: null, backgroundRatio: 0, refColor: null, reason: 'too-large' };
  }

  const c0 = averageBlock(rgba, width, height, 0, 0, opts.cornerBlock);
  const c1 = averageBlock(rgba, width, height, width - 1, 0, opts.cornerBlock);
  const c2 = averageBlock(rgba, width, height, 0, height - 1, opts.cornerBlock);
  const c3 = averageBlock(rgba, width, height, width - 1, height - 1, opts.cornerBlock);
  const corners = [c0, c1, c2, c3];
  const agreeSq = opts.cornerAgreementTolerance * opts.cornerAgreementTolerance;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const [r1, g1, b1] = corners[i];
      const [r2, g2, b2] = corners[j];
      if (distSq3(r1, g1, b1, r2, g2, b2) > agreeSq) {
        return { applied: false, mask: null, backgroundRatio: 0, refColor: null, reason: 'corners-disagree' };
      }
    }
  }
  const refR = (c0[0] + c1[0] + c2[0] + c3[0]) / 4;
  const refG = (c0[1] + c1[1] + c2[1] + c3[1]) / 4;
  const refB = (c0[2] + c1[2] + c2[2] + c3[2]) / 4;

  // 4-komşuluklu, özyinelemesiz (yığın taşmasını önlemek için) çoklu-kaynaklı
  // flood-fill: yalnızca 4 köşeden başlar, HER pikseli sabit refColor'a göre
  // değerlendirir (komşu piksele göre DEĞİL — bu, gerçek fotoğrafların kendi
  // içindeki dokusal varyansın "arka plan" sanılmasını engelleyen asıl kilit
  // nokta: bir piksel yalnızca refColor'a yakınsa VE oraya sürekli refColor'a-
  // yakın bir yoldan ulaşılabiliyorsa "arka plan" sayılır).
  const mask = new Uint8Array(total);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let sp = 0;
  for (const idx of [0, width - 1, (height - 1) * width, total - 1]) {
    if (!seen[idx]) { seen[idx] = 1; queue[sp++] = idx; }
  }

  const tolSq = opts.tolerance * opts.tolerance;
  let bgCount = 0;
  let qi = 0;
  while (qi < sp) {
    const idx = queue[qi++];
    const p = idx * 4;
    if (distSq3(rgba[p], rgba[p + 1], rgba[p + 2], refR, refG, refB) > tolSq) continue; // arka plan değil: işaretleme, komşuya yayma
    mask[idx] = 1;
    bgCount++;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) { const n = idx - 1; if (!seen[n]) { seen[n] = 1; queue[sp++] = n; } }
    if (x < width - 1) { const n = idx + 1; if (!seen[n]) { seen[n] = 1; queue[sp++] = n; } }
    if (y > 0) { const n = idx - width; if (!seen[n]) { seen[n] = 1; queue[sp++] = n; } }
    if (y < height - 1) { const n = idx + width; if (!seen[n]) { seen[n] = 1; queue[sp++] = n; } }
  }

  const backgroundRatio = bgCount / total;
  const refColor = { r: refR, g: refG, b: refB };
  if (backgroundRatio < opts.minBackgroundRatio) {
    return { applied: false, mask: null, backgroundRatio, refColor, reason: 'ratio-too-low' };
  }
  if (backgroundRatio > opts.maxBackgroundRatio) {
    return { applied: false, mask: null, backgroundRatio, refColor, reason: 'ratio-too-high' };
  }
  return { applied: true, mask, backgroundRatio, refColor, reason: null };
}

export const SILHOUETTE_DEFAULTS = DEFAULTS;
