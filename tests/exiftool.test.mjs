// Cross-checks inspectJpeg against files written by exiftool. Skipped when exiftool is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectJpeg, toArrayBuffer } from './load.mjs';

const hasExiftool = spawnSync('exiftool', ['-ver']).status === 0;
const opts = { skip: hasExiftool ? false : 'exiftool is not installed' };

// 1x1 baseline JPEG; the trailing FFD9 is added so it has a proper end-of-image marker.
const BASE = Buffer.concat([Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'), Buffer.from([0xFF, 0xD9])]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-exiftool-'));
const exiftool = (...args) => execFileSync('exiftool', ['-overwrite_original', '-q', ...args]);
function make(name, args) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, BASE);
  exiftool(...args, file);
  return inspect(file);
}
const inspect = file => inspectJpeg(toArrayBuffer(fs.readFileSync(file)));
const values = (items, label) => items.filter(i => i.label === label).map(i => i.value);

test('baseline file has no metadata', opts, () => {
  const file = path.join(dir, 'base.jpg');
  fs.writeFileSync(file, BASE);
  assert.deepEqual(inspect(file), []);
});

for (const order of ['Little-endian', 'Big-endian']) {
  test(`EXIF, GPS, XMP, IPTC and comment written by exiftool (${order})`, opts, () => {
    const items = make(`full-${order}.jpg`, [
      `-ExifByteOrder=${order}`,
      '-Make=Acme', '-Model=PhoneX 3', '-Software=PhotoApp 1.2', '-Artist=Jane Doe', '-Copyright=(c) Jane',
      '-ImageDescription=Beach day', '-DateTimeOriginal=2025:08:14 16:02:11', '-OffsetTimeOriginal=+02:00',
      '-CreateDate=2025:08:14 16:02:12', '-SerialNumber=SN123', '-LensSerialNumber=LS9', '-LensModel=Lens 24mm',
      '-OwnerName=Jane D', '-ImageUniqueID=abc123', '-UserComment=note to self',
      '-GPSLatitude=48.8584', '-GPSLatitudeRef=N', '-GPSLongitude=2.2945', '-GPSLongitudeRef=E',
      '-GPSAltitude=35', '-GPSAltitudeRef=0', '-GPSImgDirection=90', '-GPSImgDirectionRef=T',
      '-GPSTimeStamp=14:02:11', '-GPSDateStamp=2025:08:14', '-XPAuthor=Win Author',
      '-XMP-dc:Creator=Jane Doe', '-XMP-xmp:CreatorTool=EditorX', '-XMP-xmp:CreateDate=2025-08-14T16:02:11',
      '-IPTC:By-line=Photo Grapher', '-IPTC:City=Paris', '-IPTC:Keywords=kw1', '-IPTC:Keywords=kw2',
      '-IPTC:Caption-Abstract=A caption', '-IPTC:Country-PrimaryLocationName=France', '-Comment=jpeg comment'
    ]);
    assert.deepEqual(values(items, 'Location')[0], '48.8584° N, 2.2945° E');
    assert.deepEqual(values(items, 'Altitude'), ['35 m']);
    assert.deepEqual(values(items, 'Direction'), ['90°']);
    assert.deepEqual(values(items, 'GPS time'), ['2025:08:14 14:02:11 UTC']);
    assert.deepEqual(values(items, 'Camera'), ['Acme PhoneX 3']);
    assert.deepEqual(values(items, 'Lens'), ['Lens 24mm']);
    assert.deepEqual(values(items, 'Body serial'), ['SN123']);
    assert.deepEqual(values(items, 'Lens serial'), ['LS9']);
    assert.deepEqual(values(items, 'Owner'), ['Jane D']);
    assert.deepEqual(values(items, 'Artist'), ['Jane Doe']);
    assert.deepEqual(values(items, 'Copyright'), ['(c) Jane']);
    assert.deepEqual(values(items, 'Description'), ['Beach day']);
    assert.deepEqual(values(items, 'Comment'), ['note to self']);
    assert.deepEqual(values(items, 'Image ID'), ['abc123']);
    assert.deepEqual(values(items, 'Windows author'), ['Win Author']);
    assert.ok(values(items, 'Date taken').includes('2025:08:14 16:02:11 +02:00'));
    assert.deepEqual(values(items, 'Date digitized'), ['2025:08:14 16:02:12']);
    assert.deepEqual(values(items, 'Photographer'), ['Photo Grapher']);
    assert.deepEqual(values(items, 'City'), ['Paris']);
    assert.deepEqual(values(items, 'Country'), ['France']);
    assert.deepEqual(values(items, 'Keywords'), ['kw1, kw2']);
    assert.deepEqual(values(items, 'Caption'), ['A caption']);
    assert.deepEqual(values(items, 'Author'), ['Jane Doe']);
    assert.deepEqual(values(items, 'JPEG comment'), ['jpeg comment']);
    assert.equal(values(items, 'XMP data').length, 1);
  });
}

test('southern/western hemisphere GPS and XMP GPS', opts, () => {
  const items = make('sw.jpg', [
    '-GPSLatitude=10.5', '-GPSLatitudeRef=S', '-GPSLongitude=20.25', '-GPSLongitudeRef=W',
    '-XMP-exif:GPSLatitude=10,30S', '-XMP-exif:GPSLongitude=20,15W'
  ]);
  assert.ok(values(items, 'Location').includes('10.5000° S, 20.2500° W'));
  assert.ok(values(items, 'Location').some(v => v.endsWith('(XMP)')));
});

test('embedded thumbnail', opts, () => {
  const thumb = path.join(dir, 'thumb.jpg');
  fs.writeFileSync(thumb, BASE);
  const items = make('withthumb.jpg', ['-Make=Acme', `-ThumbnailImage<=${thumb}`]);
  assert.equal(values(items, 'Thumbnail').length, 1);
});

test('after exiftool -all= the file reports nothing', opts, () => {
  const file = path.join(dir, 'wiped.jpg');
  make('wiped.jpg', ['-Make=Acme', '-GPSLatitude=1', '-GPSLatitudeRef=N', '-Artist=X', '-IPTC:City=Paris']);
  exiftool('-all=', file);
  assert.deepEqual(inspect(file), []);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
