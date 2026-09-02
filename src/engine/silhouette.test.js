import { describe, it, expect } from 'vitest';
import { computeBackgroundMask } from './silhouette.js';

function makeBuffer(width, height, fillFn) {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fillFn(x, y);
      const p = (y * width + x) * 4;
      buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255;
    }
  }
  return buf;
}

describe('computeBackgroundMask', () => {
  it('düz tek renkli dikdörtgende (gerçek bir arka plan sınırı yok) maskeleme uygulanmaz', () => {
    const W = 50, H = 50;
    const buf = makeBuffer(W, H, () => [230, 230, 230]);
    const result = computeBackgroundMask(buf, W, H);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('ratio-too-high'); // flood-fill her yeri "arka plan" bulur (>%97)
  });

  it('ortada dairesel farklı renk + tek düz köşe zemininde arka planı doğru tespit eder', () => {
    const W = 60, H = 60;
    const cx = W / 2, cy = H / 2, R = 20;
    const buf = makeBuffer(W, H, (x, y) => {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      return (dx * dx + dy * dy) <= R * R ? [200, 30, 30] : [245, 245, 245];
    });
    const result = computeBackgroundMask(buf, W, H);
    expect(result.applied).toBe(true);
    expect(result.refColor.r).toBeCloseTo(245, 0);
    // Beklenen arka plan oranı ~ 1 - (pi*R^2)/(W*H) = 1 - (pi*400)/3600 ≈ 0.651
    expect(result.backgroundRatio).toBeGreaterThan(0.55);
    expect(result.backgroundRatio).toBeLessThan(0.75);
    expect(result.mask[Math.round(cy) * W + Math.round(cx)]).toBe(0); // merkez: korunacak içerik
    expect(result.mask[0]).toBe(1); // köşe: arka plan/şeffaflaştırılacak
  });

  it('dört köşe birbirinden farklı renklerdeyse (güvenilmez) maskeleme uygulanmaz', () => {
    const W = 20, H = 20;
    const buf = makeBuffer(W, H, (x, y) => {
      if (x < W / 2 && y < H / 2) return [255, 0, 0];
      if (x >= W / 2 && y < H / 2) return [0, 255, 0];
      if (x < W / 2 && y >= H / 2) return [0, 0, 255];
      return [255, 255, 0];
    });
    const result = computeBackgroundMask(buf, W, H);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('corners-disagree');
  });

  it('bulunan arka plan oranı eşik altındaysa (ör. yalnızca ince bir kenarlık) maskeleme uygulanmaz', () => {
    // 2px kalınlığında bir kenarlık: cornerBlock=3 (yarı-genişlik 1) tam
    // olarak bu kenarlığın içinde kalır, iç bölgeye "sızmaz".
    const W = 300, H = 300;
    const buf = makeBuffer(W, H, (x, y) => {
      const border = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
      return border ? [250, 250, 250] : [40, 90, 160];
    });
    const result = computeBackgroundMask(buf, W, H);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('ratio-too-low');
    // Beklenen oran: (300*300 - 296*296) / (300*300) = 2384/90000 ≈ 0.0265
    expect(result.backgroundRatio).toBeCloseTo(0.0265, 3);
    expect(result.backgroundRatio).toBeLessThan(0.03);
  });
});
