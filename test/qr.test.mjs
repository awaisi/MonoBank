import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrToSvg, gfMultiply, reedSolomonDivisor, reedSolomonRemainder, numRawDataModules, numDataCodewords, MAX_VERSION } from '../public/qr.js';

const GAME_URL = 'https://monobank.divviq.app/game/0123456789abcdef';

// Reads the 15-bit format information next to the top-left finder and
// returns [error-correction bits, mask] after removing the XOR mask.
function readFormat(qr) {
  const m = qr.modules;
  const bits = [];
  for (let i = 0; i <= 5; i++) bits.push(m[i][8]);
  bits.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) bits.push(m[8][14 - i]);
  const value = bits.reduce((acc, bit, i) => acc | (Number(bit) << i), 0) ^ 0x5412;
  return [(value >>> 13) & 3, (value >>> 10) & 7];
}

test('GF(256) arithmetic matches known values', () => {
  assert.equal(gfMultiply(0, 0x53), 0);
  assert.equal(gfMultiply(1, 0x53), 0x53);
  assert.equal(gfMultiply(2, 0x80), 0x1d, 'reduction by the QR polynomial');
  assert.equal(gfMultiply(0x53, 0xca), gfMultiply(0xca, 0x53), 'commutative');
});

test('Reed–Solomon matches the ISO 18004 worked example (1-M "01234567")', () => {
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  const ecc = reedSolomonRemainder(data, reedSolomonDivisor(10));
  assert.deepEqual(ecc, [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test('capacity tables agree with the specification', () => {
  assert.equal(numRawDataModules(1), 208);
  assert.equal(numRawDataModules(7), 1568);
  assert.equal(numDataCodewords(1, 'M'), 16);
  assert.equal(numDataCodewords(4, 'M'), 64);
  assert.equal(numDataCodewords(10, 'L'), 274);
});

test('encodes a game link with finder, timing and dark-module structure', () => {
  const qr = encodeQr(GAME_URL);
  assert.equal(qr.version, 4);
  assert.equal(qr.size, 33);
  const m = qr.modules;
  for (const [x, y] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(m[y][x + i], true, 'finder top edge');
      assert.equal(m[y + 6][x + i], true, 'finder bottom edge');
    }
    assert.equal(m[y + 1][x + 1], false, 'finder ring');
    assert.equal(m[y + 3][x + 3], true, 'finder centre');
  }
  for (let i = 8; i < qr.size - 8; i++) assert.equal(m[6][i], i % 2 === 0, 'timing pattern');
  assert.equal(m[qr.size - 8][8], true, 'dark module');
  assert.deepEqual(readFormat(qr), [0 /* M */, qr.mask]);
});

test('chooses the smallest version and honours the error-correction level', () => {
  assert.equal(encodeQr('A').version, 1);
  assert.equal(encodeQr('x'.repeat(14), { ecl: 'M' }).version, 1);
  assert.equal(encodeQr('x'.repeat(15), { ecl: 'M' }).version, 2);
  assert.equal(encodeQr(GAME_URL, { ecl: 'L' }).version, 3);
  assert.equal(encodeQr(GAME_URL, { ecl: 'H' }).version, 6);
  const levels = { L: 1, M: 0, Q: 3, H: 2 };
  for (const [ecl, bits] of Object.entries(levels)) assert.equal(readFormat(encodeQr('MonoBank', { ecl }))[0], bits);
});

test('adds version information from version 7 and supports the maximum version', () => {
  const qr = encodeQr('y'.repeat(150), { ecl: 'L' });
  assert.ok(qr.version >= 7 && qr.version <= MAX_VERSION);
  const size = qr.size;
  // Version 7 information block is 0x07C94 per the specification.
  if (qr.version === 7) {
    const bits = [];
    for (let i = 0; i < 18; i++) bits.push(qr.modules[Math.floor(i / 3)][size - 11 + (i % 3)]);
    assert.equal(bits.reduce((acc, bit, i) => acc | (Number(bit) << i), 0), 0x07c94);
  }
  assert.equal(encodeQr('z'.repeat(271), { ecl: 'L' }).version, 10);
});

test('encodes UTF-8 and rejects text that is too long or an unknown level', () => {
  assert.ok(encodeQr('Café ✓').size > 0);
  assert.throws(() => encodeQr('x'.repeat(400)), /too long/);
  assert.throws(() => encodeQr('x', { ecl: 'Z' }), /Unknown error correction level/);
});

test('every mask choice is deterministic', () => {
  assert.deepEqual(encodeQr(GAME_URL).modules, encodeQr(GAME_URL).modules);
});

test('renders an accessible SVG with a quiet zone and escaped label', () => {
  const qr = encodeQr('hi');
  const svg = qrToSvg(qr, { label: 'Join "Ana & Ben"' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 29 29"/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Join &#34;Ana &#38; Ben&#34;"/);
  assert.match(svg, /<path d="M4 4h1v1h-1z/);
  assert.doesNotMatch(svg, /style=/, 'no inline styles (CSP)');
});
