import { describe, it, expect } from 'vitest';
import { rectIou, unionRect, mergeOverlapping, splitRegionAroundText } from './regions.js';

describe('rectIou', () => {
  it('döner 0, örtüşme yoksa', () => {
    expect(rectIou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(0);
  });

  it('döner 1, tamamen aynı dikdörtgenler için', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectIou(r, { ...r })).toBe(1);
  });

  it('döner 0, yalnızca kenarları değen dikdörtgenler için (alan örtüşmesi yok)', () => {
    expect(rectIou({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
  });

  it('kesişim/birleşim oranını doğru hesaplar', () => {
    // a: x[0,3] b: x[1,4], y tam örtüşür (h=5) -> inter=2*5=10, union=15+15-10=20 -> 0.5
    const a = { x: 0, y: 0, w: 3, h: 5 };
    const b = { x: 1, y: 0, w: 3, h: 5 };
    expect(rectIou(a, b)).toBeCloseTo(0.5, 10);
  });
});

describe('unionRect', () => {
  it('iki dikdörtgenin dış sınır kutusunu hesaplar', () => {
    const u = unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 });
    expect(u).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });
});

describe('mergeOverlapping — 0.5 IOU eşiği', () => {
  // a sabit {x:0,y:0,w:3,h:5}; b'nin x konumu IOU'yu hassas kontrol eder (bkz. rectIou testindeki formül).
  const a = { x: 0, y: 0, w: 3, h: 5 };

  it('IOU tam 0.5 iken birleştirir (>= eşiği kapsayıcı)', () => {
    const b = { x: 1, y: 0, w: 3, h: 5 };
    expect(rectIou(a, b)).toBeCloseTo(0.5, 10);
    const merged = mergeOverlapping([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(unionRect(a, b));
  });

  it('IOU 0.5 üstündeyken birleştirir', () => {
    const b = { x: 0.99, y: 0, w: 3, h: 5 };
    expect(rectIou(a, b)).toBeGreaterThan(0.5);
    expect(mergeOverlapping([a, b])).toHaveLength(1);
  });

  it('IOU 0.5 altındayken birleştirmez (hâlâ örtüşse bile)', () => {
    const b = { x: 1.01, y: 0, w: 3, h: 5 };
    expect(rectIou(a, b)).toBeLessThan(0.5);
    const merged = mergeOverlapping([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('örtüşmeyen dikdörtgenleri olduğu gibi bırakır', () => {
    const rects = [{ x: 0, y: 0, w: 5, h: 5 }, { x: 100, y: 100, w: 5, h: 5 }];
    expect(mergeOverlapping(rects)).toHaveLength(2);
  });

  it('tek dikdörtgeni değiştirmeden döner', () => {
    const rects = [{ x: 0, y: 0, w: 5, h: 5 }];
    expect(mergeOverlapping(rects)).toEqual(rects);
  });
});

describe('splitRegionAroundText', () => {
  const region = { x: 0, y: 0, w: 100, h: 100 };

  it('metin kutusu yoksa bölgeyi olduğu gibi döner', () => {
    expect(splitRegionAroundText(region, [])).toEqual([region]);
  });

  it('örtüşmeyen metin bölgeyi etkilemez', () => {
    const text = { x: 200, y: 200, w: 10, h: 10 };
    expect(splitRegionAroundText(region, [text])).toEqual([region]);
  });

  it('bölgeyi enine kesen metni üst/alt parçaya böler', () => {
    const text = { x: 0, y: 40, w: 100, h: 20 };
    const pieces = splitRegionAroundText(region, [text]);
    expect(pieces).toHaveLength(2);
    expect(pieces).toContainEqual({ x: 0, y: 60, w: 100, h: 40 });
    expect(pieces).toContainEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  it('bölgeyi boyuna kesen metni sol/sağ parçaya böler', () => {
    const narrowRegion = { x: 0, y: 0, w: 100, h: 50 };
    const text = { x: 40, y: 0, w: 20, h: 50 };
    const pieces = splitRegionAroundText(narrowRegion, [text]);
    expect(pieces).toHaveLength(2);
    expect(pieces).toContainEqual({ x: 60, y: 0, w: 40, h: 50 });
    expect(pieces).toContainEqual({ x: 0, y: 0, w: 40, h: 50 });
  });

  it('bölgeyi tamamen kaplayan metin bölgeyi tümüyle tüketir (parça kalmaz)', () => {
    const small = { x: 0, y: 0, w: 10, h: 10 };
    const text = { x: -5, y: -5, w: 20, h: 20 };
    expect(splitRegionAroundText(small, [text])).toEqual([]);
  });

  it('4pt veya daha küçük kalıntı parçaları eler', () => {
    const thin = { x: 0, y: 0, w: 100, h: 10 };
    const text = { x: 0, y: 2, w: 100, h: 10 }; // alt kalıntı yalnız 2pt
    expect(splitRegionAroundText(thin, [text])).toEqual([]);
  });
});
