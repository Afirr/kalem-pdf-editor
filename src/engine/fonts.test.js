import { describe, it, expect } from 'vitest';
import { FONTS, detectFontKey, prettyFontName } from './fonts.js';

describe('detectFontKey — kayıtlı 7 aile', () => {
  const cases = [
    ['ABCDEF+Montserrat-Bold', 'sans-serif', 'montserrat'],
    ['Futura-Medium', 'sans-serif', 'montserrat'],
    ['OpenSans-Regular', 'sans-serif', 'opensans'],
    ['Segoe UI', 'sans-serif', 'opensans'],
    ['TimesNewRomanPSMT', 'serif', 'times'],
    ['Georgia-Bold', 'serif', 'times'],
    ['PlayfairDisplay-Bold', 'serif', 'playfair'],
    ['Garamond', 'serif', 'playfair'],
    ['CourierNewPSMT', 'monospace', 'cousine'],
    ['Consolas', 'monospace', 'cousine'],
    ['DancingScript-Regular', 'cursive', 'script'],
    ['Pacifico', 'cursive', 'script'],
    ['Arial-BoldMT', 'sans-serif', 'arial'],
    ['Helvetica', 'sans-serif', 'arial'],
  ];

  it.each(cases)('detectFontKey(%s, %s) -> %s', (raw, generic, expected) => {
    expect(detectFontKey(raw, generic)).toBe(expected);
  });

  it('tüm beklenen anahtarlar FONTS kaydında gerçekten var', () => {
    for (const [, , expected] of cases) {
      expect(FONTS[expected]).toBeDefined();
    }
  });
});

describe('detectFontKey — bilinmeyen font / genel aile yedeği', () => {
  it('ham ad yoksa ve genel aile serif ise times döner', () => {
    expect(detectFontKey('', 'serif')).toBe('times');
  });

  it('ham ad yoksa ve genel aile sans-serif ise arial döner', () => {
    expect(detectFontKey('', 'sans-serif')).toBe('arial');
  });

  it('hiçbir aileyle eşleşmeyen tamamen bilinmeyen ad + boş genel aile -> arial', () => {
    expect(detectFontKey('XyzCustomFont123', '')).toBe('arial');
  });

  it('bilinmeyen ama adında "serif" geçen (ve "sans" geçmeyen) font -> times', () => {
    expect(detectFontKey('SomeCustomSerifFace', '')).toBe('times');
  });
});

describe('prettyFontName', () => {
  it('alt küme önekini (ör. ABCDEF+) atar', () => {
    expect(prettyFontName('ABCDEF+Montserrat-Bold')).toBe('Montserrat-Bold');
  });

  it('önek yoksa adı değiştirmez', () => {
    expect(prettyFontName('Arial')).toBe('Arial');
  });

  it('boş/undefined için boş dize döner', () => {
    expect(prettyFontName('')).toBe('');
    expect(prettyFontName(undefined)).toBe('');
  });
});
