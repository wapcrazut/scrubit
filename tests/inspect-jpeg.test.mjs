import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectJpeg } from './load.mjs';
import { ascii, seg, iptc, jpeg, jfif, icc, exifSeg, xmpSeg } from './fixtures.mjs';

const find = (items, label) => items.filter(i => i.label === label).map(i => i.value);
const has = (items, label, sub) => find(items, label).some(v => v.includes(sub));

for (const le of [true, false]) {
  const order = le ? 'little-endian' : 'big-endian';

  test(`full metadata JPEG (${order})`, () => {
    const items = inspectJpeg(jpeg([
      jfif, exifSeg(le, true), xmpSeg,
      seg(0xED, iptc([[80, 'Photo Grapher'], [90, 'Paris'], [25, 'kw1'], [25, 'kw2'], [120, 'A caption']])),
      seg(0xFE, ascii('secret comment')), seg(0xE5, ascii('mystery')), icc
    ], [1, 2, 3]));

    assert.deepEqual(find(items, 'Location')[0], '48.8583° N, 2.2944° W');
    assert.ok(has(items, 'Altitude', '35 m'));
    assert.ok(has(items, 'Direction', '90°'));
    assert.ok(has(items, 'GPS time', '2025:08:14 14:02:11 UTC'));
    assert.ok(has(items, 'Camera', 'Acme PhoneX 3'));
    assert.ok(has(items, 'Lens', 'Lens 24mm'));
    assert.ok(has(items, 'Body serial', 'SN123456'));
    assert.ok(has(items, 'Artist', 'Jane Doe'));
    assert.ok(has(items, 'Software', 'PhotoApp 1.2'));
    assert.ok(has(items, 'Comment', 'hello comment'));
    assert.ok(has(items, 'Maker notes', '40 B'));
    assert.ok(has(items, 'Windows author', 'Win Author'));
    assert.ok(has(items, 'Thumbnail', '4.9 KB'));
    assert.ok(has(items, 'XMP data', 'B'));
    assert.ok(has(items, 'Location', '(XMP)'));
    assert.ok(has(items, 'Photographer', 'Photo Grapher'));
    assert.ok(has(items, 'City', 'Paris'));
    assert.ok(has(items, 'Keywords', 'kw1, kw2'));
    assert.ok(has(items, 'Caption', 'A caption'));
    assert.ok(has(items, 'JPEG comment', 'secret comment'));
    assert.ok(has(items, 'Unrecognized data', 'APP5'));
    assert.ok(has(items, 'Trailing data', '3 B'));
  });

  test(`Date taken is DateTimeOriginal plus offset, modified date is separate (${order})`, () => {
    const items = inspectJpeg(jpeg([exifSeg(le, false)]));
    assert.ok(has(items, 'Date taken', '2025:08:14 16:02:11 +02:00'));
    assert.ok(has(items, 'Date modified', '2025:08:15 10:00:00'));
  });

  test(`no thumbnail row when IFD1 is absent (${order})`, () => {
    assert.equal(find(inspectJpeg(jpeg([exifSeg(le, false)])), 'Thumbnail').length, 0);
  });
}

test('harmless segments only: empty result', () => {
  assert.deepEqual(inspectJpeg(jpeg([jfif, icc])), []);
});

test('Adobe APP14 colour transform is ignored', () => {
  assert.deepEqual(inspectJpeg(jpeg([jfif, seg(0xEE, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1])])), []);
});

test('EXIF block with no tags: empty result', () => {
  const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(inspectJpeg(jpeg([seg(0xE1, [...ascii('Exif\0\0'), ...tiff])])), []);
});

test('corrupt EXIF is reported, not hidden', () => {
  const items = inspectJpeg(jpeg([seg(0xE1, [...ascii('Exif\0\0'), 1, 2, 3, 4, 5, 6, 7, 8])]));
  assert.ok(has(items, 'Unrecognized data', 'APP1'));
});

test('unknown APPn segments are aggregated by name', () => {
  const items = inspectJpeg(jpeg([seg(0xE5, [1, 2, 3]), seg(0xE5, [4, 5]), seg(0xE9, [6])]));
  assert.deepEqual(find(items, 'Unrecognized data'), ['APP5 segment, 5 B', 'APP9 segment, 1 B']);
});

test('APP13 without IPTC fields is still reported', () => {
  const items = inspectJpeg(jpeg([seg(0xED, [...ascii('Photoshop 3.0\0')])]));
  assert.ok(has(items, 'Photoshop data', 'B'));
});

test('Content Credentials (APP11 JUMBF) is reported', () => {
  assert.ok(has(inspectJpeg(jpeg([seg(0xEB, [...ascii('JP'), 0, 0, 0, 0])])), 'Content credentials', 'B'));
});

test('empty JPEG comment is still reported', () => {
  assert.ok(has(inspectJpeg(jpeg([seg(0xFE, [0, 0])])), 'JPEG comment', 'present'));
});

test('bytes after EOI are reported; entropy data with FF00 and RSTn is not mistaken for markers', () => {
  assert.equal(find(inspectJpeg(jpeg([jfif], [])), 'Trailing data').length, 0);
  assert.ok(has(inspectJpeg(jpeg([jfif], [9, 9, 9, 9])), 'Trailing data', '4 B'));
});

test('non-JPEG input returns null ("check unavailable")', () => {
  assert.equal(inspectJpeg(new Uint8Array([1, 2, 3, 4, 5]).buffer), null);
});

test('truncated and garbage input never throws', () => {
  const full = new Uint8Array(jpeg([jfif, exifSeg(true, true), xmpSeg]));
  for (let n = 0; n <= full.length; n += 7) {
    assert.doesNotThrow(() => inspectJpeg(full.slice(0, n).buffer), `truncated at ${n}`);
  }
  for (let i = 0; i < 300; i++) {
    const copy = full.slice();
    for (let k = 0; k < 8; k++) copy[Math.floor(Math.random() * copy.length)] = Math.floor(Math.random() * 256);
    assert.doesNotThrow(() => inspectJpeg(copy.buffer));
  }
});
