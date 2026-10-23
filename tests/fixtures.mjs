// Hand-built JPEG byte structures, so tests need no binary fixture files.
const u16 = (n, le) => le ? [n & 255, n >> 8] : [n >> 8, n & 255];
const u32 = (n, le) => le
  ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
  : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
export const ascii = s => [...s].map(c => c.charCodeAt(0));

// TIFF block with IFD0, Exif sub-IFD, GPS IFD and (optionally) an IFD1 thumbnail.
export function buildTiff(le, withThumbnail = true) {
  const pool = [];
  const E = (tag, type, count, bytes) => ({ tag, type, count, bytes });
  const S = (tag, s) => E(tag, 2, s.length + 1, [...ascii(s), 0]);
  const R = (tag, pairs) => E(tag, 5, pairs.length, pairs.flatMap(([n, d]) => [...u32(n, le), ...u32(d, le)]));
  const L = (tag, v) => E(tag, 4, 1, u32(v, le));
  const B = (tag, type, bytes) => E(tag, type, bytes.length, bytes);

  const ifd0 = [
    S(0x010F, 'Acme'), S(0x0110, 'PhoneX 3'), S(0x0131, 'PhotoApp 1.2'), S(0x0132, '2025:08:15 10:00:00'),
    S(0x013B, 'Jane Doe'), L(0x8769, 0), L(0x8825, 0),
    B(0x9C9D, 1, [...Buffer.from('Win Author\0', 'utf16le')])
  ];
  const exif = [
    S(0x9003, '2025:08:14 16:02:11'), S(0x9011, '+02:00'), S(0xA431, 'SN123456'), S(0xA434, 'Lens 24mm'),
    B(0x9286, 7, [...ascii('ASCII\0\0\0'), ...ascii('hello comment')]),
    B(0x927C, 7, new Array(40).fill(7))
  ];
  const gps = [
    B(0, 1, [2, 3, 0, 0]), S(1, 'N'), R(2, [[48, 1], [51, 1], [30, 1]]), S(3, 'W'), R(4, [[2, 1], [17, 1], [40, 1]]),
    E(5, 1, 1, [0]), R(6, [[35, 1]]), R(7, [[14, 1], [2, 1], [11, 1]]), S(0x1D, '2025:08:14'), R(0x11, [[90, 1]])
  ];
  const ifd1 = withThumbnail ? [L(0x0201, 1000), L(0x0202, 5000)] : null;

  const sizeOf = ifd => 2 + ifd.length * 12 + 4;
  const offExif = 8 + sizeOf(ifd0);
  const offGps = offExif + sizeOf(exif);
  const offIfd1 = offGps + sizeOf(gps);
  const poolBase = offIfd1 + (ifd1 ? sizeOf(ifd1) : 0);
  ifd0.find(e => e.tag === 0x8769).bytes = u32(offExif, le);
  ifd0.find(e => e.tag === 0x8825).bytes = u32(offGps, le);

  const emit = (ifd, next) => {
    const out = [...u16(ifd.length, le)];
    for (const e of ifd) {
      out.push(...u16(e.tag, le), ...u16(e.type, le), ...u32(e.count, le));
      if (e.bytes.length <= 4) out.push(...e.bytes, ...new Array(4 - e.bytes.length).fill(0));
      else { out.push(...u32(poolBase + pool.length, le)); pool.push(...e.bytes); if (pool.length % 2) pool.push(0); }
    }
    out.push(...u32(next, le));
    return out;
  };
  const body = [...emit(ifd0, ifd1 ? offIfd1 : 0), ...emit(exif, 0), ...emit(gps, 0), ...(ifd1 ? emit(ifd1, 0) : [])];
  return [...ascii(le ? 'II' : 'MM'), ...u16(42, le), ...u32(8, le), ...body, ...pool];
}

export const seg = (marker, payload) => [0xFF, marker, ...u16(payload.length + 2, false), ...payload];

export function iptc(records) {
  const data = records.flatMap(([ds, s]) => [0x1C, 2, ds, ...u16(s.length, false), ...ascii(s)]);
  const block = [...ascii('8BIM'), ...u16(0x0404, false), 0, 0, ...u32(data.length, false), ...data];
  if (data.length % 2) block.push(0);
  return [...ascii('Photoshop 3.0\0'), ...block];
}

export const xmpPacket = '<x:xmpmeta><rdf:Description xmp:CreateDate="2025-08-14T16:02:11" xmp:CreatorTool="EditorX" ' +
  'exif:GPSLatitude="48,51.5N" exif:GPSLongitude="2,17.6E"><dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator></rdf:Description></x:xmpmeta>';

// Fake DQT/SOF/SOS followed by entropy data containing FF00 stuffing and a restart marker.
const imageData = [0xFF, 0xDB, 0, 4, 0, 0, 0xFF, 0xC0, 0, 4, 0, 0, 0xFF, 0xDA, 0, 4, 0, 0, 0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56];

export function jpeg(parts, trailing = []) {
  return new Uint8Array([0xFF, 0xD8, ...parts.flat(), ...imageData, 0xFF, 0xD9, ...trailing]).buffer;
}

export const jfif = seg(0xE0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const icc = seg(0xE2, [...ascii('ICC_PROFILE\0'), 1, 1, 9, 9, 9]);
export const exifSeg = (le, withThumbnail) => seg(0xE1, [...ascii('Exif\0\0'), ...buildTiff(le, withThumbnail)]);
export const xmpSeg = seg(0xE1, [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii(xmpPacket)]);
