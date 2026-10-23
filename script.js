(function(){
  "use strict";

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const chooseBtn = document.getElementById('chooseBtn');
  const fileListEl = document.getElementById('fileList');
  const formatSelect = document.getElementById('formatSelect');
  const qualitySlider = document.getElementById('qualitySlider');
  const qualityValue = document.getElementById('qualityValue');
  const zipRow = document.getElementById('zipRow');
  const zipBtn = document.getElementById('zipBtn');
  const revealToggle = document.getElementById('revealToggle');

  const processedFiles = []; // { name, blob }

  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value + '%';
  });

  revealToggle.addEventListener('change', () => {
    document.body.classList.toggle('reveal-metadata', revealToggle.checked);
  });

  // ---------- drop zone wiring ----------
  chooseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter','dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave','drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  function handleFiles(fileListObj){
    const files = Array.from(fileListObj).filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
    files.forEach(processFile);
  }

  // ---------- helpers ----------
  function formatBytes(bytes){
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/(1024*1024)).toFixed(2) + ' MB';
  }

  function suggestFilename(originalName, mime){
    const base = originalName.replace(/\.[^./\\]+$/, '');
    const extMap = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' };
    const ext = extMap[mime] || (originalName.split('.').pop() || 'img');
    return base + '-clean.' + ext;
  }

  function mimeLabel(mime){
    return { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' }[mime] || mime;
  }

  function formatGPS(lat, lon){
    const latRef = lat >= 0 ? 'N' : 'S';
    const lonRef = lon >= 0 ? 'E' : 'W';
    return Math.abs(lat).toFixed(4) + '\u00b0 ' + latRef + ', ' + Math.abs(lon).toFixed(4) + '\u00b0 ' + lonRef;
  }

  // ---------- JPEG inspection (read-only, for display) ----------
  const IPTC_FIELDS = {
    5: 'Title', 25: 'Keywords', 80: 'Photographer', 90: 'City', 92: 'Sub-location',
    95: 'State/Province', 101: 'Country', 110: 'Credit', 115: 'Source', 116: 'Copyright', 120: 'Caption'
  };

  function asciiAt(view, pos, str){
    if (pos + str.length > view.byteLength) return false;
    for (let i = 0; i < str.length; i++) if (view.getUint8(pos + i) !== str.charCodeAt(i)) return false;
    return true;
  }

  function clip(str){
    return str.length > 120 ? str.slice(0, 120) + '…' : str;
  }

  function bytesAt(view, pos, length){
    return new Uint8Array(view.buffer, view.byteOffset + pos, length);
  }

  function xmpItems(view, segStart, segEnd){
    const text = new TextDecoder('utf-8').decode(bytesAt(view, segStart, segEnd - segStart));
    const items = [{ label: 'XMP data', value: formatBytes(segEnd - segStart) }];
    const field = (name) => {
      const attr = new RegExp(name + '="([^"]*)"').exec(text);
      if (attr) return attr[1].trim();
      const el = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>').exec(text);
      return el ? el[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
    };
    const lat = field('exif:GPSLatitude'), lon = field('exif:GPSLongitude');
    if (lat && lon) items.push({ label: 'Location', value: lat + ', ' + lon + ' (XMP)' });
    const author = field('dc:creator');
    if (author) items.push({ label: 'Author', value: clip(author) });
    const created = field('xmp:CreateDate');
    if (created) items.push({ label: 'Date taken', value: created + ' (XMP)' });
    const tool = field('xmp:CreatorTool');
    if (tool) items.push({ label: 'Software', value: clip(tool) });
    return items;
  }

  // Photoshop "8BIM" resource blocks; resource 0x0404 holds the IPTC records.
  function iptcItems(view, segStart, segEnd){
    const decoder = new TextDecoder('utf-8');
    const found = {};
    let pos = segStart + 14; // after "Photoshop 3.0\0"
    while (pos + 12 <= segEnd && asciiAt(view, pos, '8BIM')) {
      const id = view.getUint16(pos + 4, false);
      const nameLen = view.getUint8(pos + 6);
      let p = pos + 7 + nameLen + ((1 + nameLen) % 2); // pascal string, padded to even length
      if (p + 4 > segEnd) break;
      const size = view.getUint32(p, false);
      p += 4;
      if (id === 0x0404) {
        const end = Math.min(p + size, segEnd);
        let r = p;
        while (r + 5 <= end && view.getUint8(r) === 0x1C) {
          const record = view.getUint8(r + 1);
          const dataset = view.getUint8(r + 2);
          const n = view.getUint16(r + 3, false);
          if ((n & 0x8000) || r + 5 + n > end) break; // extended-length datasets are not supported
          if (record === 2 && IPTC_FIELDS[dataset]) {
            const value = decoder.decode(bytesAt(view, r + 5, n)).trim();
            if (value) (found[dataset] = found[dataset] || []).push(value);
          }
          r += 5 + n;
        }
      }
      pos = p + size + (size % 2);
    }
    const items = Object.keys(found).map(ds => ({ label: IPTC_FIELDS[ds], value: clip(found[ds].join(', ')) }));
    if (!items.length) items.push({ label: 'Photoshop data', value: formatBytes(segEnd - segStart) });
    return items;
  }

  // Walks every marker segment. Known-harmless segments (JFIF, ICC profile, Adobe
  // color transform) are skipped; every other APPn/COM segment is either parsed or
  // reported as unrecognized, so an empty result means no metadata segments exist.
  function inspectJpeg(buffer){
    const view = new DataView(buffer);
    const len = view.byteLength;
    if (len < 4 || view.getUint16(0, false) !== 0xFFD8) return null;
    const items = [];
    const unknown = {}; // segment name -> bytes
    let offset = 2;
    let inScan = false;
    let eoiEnd = -1;

    function readSegment(marker, segStart, segEnd){
      const size = segEnd - segStart;
      const name = marker === 0xFE ? 'COM'
        : marker >= 0xF0 ? 'JPG' + (marker - 0xF0)
        : 'APP' + (marker - 0xE0);
      const is = (str) => asciiAt(view, segStart, str);
      try {
        if (marker === 0xE0 && is('JFIF\0')) return;
        if (marker === 0xE0 && is('JFXX\0')) { items.push({ label: 'Thumbnail', value: formatBytes(size) }); return; }
        if (marker === 0xE1 && is('Exif\0')) {
          const exif = parseTiff(view, segStart + 6);
          if (exif) { items.push(...exif); return; }
        }
        if (marker === 0xE1 && is('http://ns.adobe.com/xap/1.0/\0')) { items.push(...xmpItems(view, segStart, segEnd)); return; }
        if (marker === 0xE1 && is('http://ns.adobe.com/xmp/extension/\0')) {
          items.push({ label: 'XMP data', value: 'extended packet, ' + formatBytes(size) });
          return;
        }
        if (marker === 0xE2 && is('ICC_PROFILE\0')) return;
        if (marker === 0xE2 && is('MPF\0')) { items.push({ label: 'Multi-picture data', value: formatBytes(size) }); return; }
        if (marker === 0xEB && is('JP')) { items.push({ label: 'Content credentials', value: formatBytes(size) }); return; }
        if (marker === 0xED && is('Photoshop 3.0\0')) { items.push(...iptcItems(view, segStart, segEnd)); return; }
        if (marker === 0xEE && is('Adobe')) return;
        if (marker === 0xFE) {
          const comment = new TextDecoder('utf-8').decode(bytesAt(view, segStart, size)).replace(/\0/g, '').trim();
          items.push({ label: 'JPEG comment', value: comment ? clip(comment) : 'present' });
          return;
        }
      } catch (e) { /* fall through: report as unrecognized */ }
      unknown[name] = (unknown[name] || 0) + size;
    }

    while (offset + 1 < len) {
      if (view.getUint8(offset) !== 0xFF) {
        if (inScan) { offset++; continue; } // entropy-coded image data
        break;
      }
      const marker = view.getUint8(offset + 1);
      if (marker === 0xFF) { offset++; continue; } // fill byte
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { offset += 2; continue; }
      if (marker === 0xD9) { eoiEnd = offset + 2; break; }
      if (offset + 4 > len) break;
      const segLength = view.getUint16(offset + 2, false);
      if (segLength < 2) break;
      const segEnd = Math.min(offset + 2 + segLength, len);
      if (marker === 0xDA) inScan = true;
      else if (marker >= 0xE0 && marker !== 0xFF) readSegment(marker, offset + 4, segEnd);
      offset += 2 + segLength;
    }

    Object.keys(unknown).forEach(name => {
      items.push({ label: 'Unrecognized data', value: name + ' segment, ' + formatBytes(unknown[name]) });
    });
    if (eoiEnd > 0 && eoiEnd < len) {
      items.push({ label: 'Trailing data', value: formatBytes(len - eoiEnd) + ' after image end' });
    }
    return items;
  }

  function readIFD(view, tiffStart, ifdOffset, little){
    const tags = {};
    if (ifdOffset + 2 > view.byteLength) return tags;
    const count = view.getUint16(ifdOffset, little);
    const typeSizes = {1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
    for (let i = 0; i < count; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;
      const tag = view.getUint16(entryOffset, little);
      const type = view.getUint16(entryOffset + 2, little);
      const num = view.getUint32(entryOffset + 4, little);
      const size = (typeSizes[type] || 1) * num;
      const valuePos = entryOffset + 8;
      const dataPos = size <= 4 ? valuePos : tiffStart + view.getUint32(valuePos, little);
      if (dataPos + size > view.byteLength) continue;

      let value = null;
      try {
        if (type === 2) { // ASCII
          let str = '';
          for (let j = 0; j < num - 1; j++) str += String.fromCharCode(view.getUint8(dataPos + j));
          value = str.replace(/\0/g, '').trim();
        } else if (type === 3) { // SHORT
          value = view.getUint16(dataPos, little);
        } else if (type === 4) { // LONG
          value = view.getUint32(dataPos, little);
        } else if (type === 5) { // RATIONAL
          const vals = [];
          for (let j = 0; j < num; j++) {
            const n = view.getUint32(dataPos + j*8, little);
            const d = view.getUint32(dataPos + j*8 + 4, little);
            vals.push(d ? n / d : 0);
          }
          value = num === 1 ? vals[0] : vals;
        } else if (type === 1 || type === 7) { // BYTE / UNDEFINED
          value = type === 1 && num === 1 ? view.getUint8(dataPos) : bytesAt(view, dataPos, num);
        }
      } catch (e) { value = null; }

      tags[tag] = value;
    }
    return tags;
  }

  // Returns display items for an EXIF/TIFF block, or null if it isn't one.
  function parseTiff(view, tiffStart){
    const bo = view.getUint16(tiffStart, false);
    if (bo !== 0x4949 && bo !== 0x4D4D) return null;
    const little = bo === 0x4949;
    const ifd0Pos = tiffStart + view.getUint32(tiffStart + 4, little);
    const ifd0 = readIFD(view, tiffStart, ifd0Pos, little);
    const exif = ifd0[0x8769] ? readIFD(view, tiffStart, tiffStart + ifd0[0x8769], little) : {};
    const gps = ifd0[0x8825] ? readIFD(view, tiffStart, tiffStart + ifd0[0x8825], little) : {};

    const text = (tags, tag) => (typeof tags[tag] === 'string' && tags[tag]) || null;
    const bytesText = (tags, tag, encoding, skip) => {
      const raw = tags[tag];
      if (!(raw instanceof Uint8Array) || raw.length <= skip) return null;
      return new TextDecoder(encoding).decode(raw.subarray(skip)).replace(/\0/g, '').trim() || null;
    };
    const dms = (v) => Array.isArray(v) && v.length >= 3 ? v[0] + v[1]/60 + v[2]/3600 : null;
    const items = [];

    // GPS
    const lat = dms(gps[2]), lon = dms(gps[4]);
    if (lat !== null && lon !== null) {
      items.push({ label: 'Location', value: formatGPS(gps[1] === 'S' ? -lat : lat, gps[3] === 'W' ? -lon : lon) });
    }
    if (typeof gps[6] === 'number') items.push({ label: 'Altitude', value: (gps[5] === 1 ? '-' : '') + Math.round(gps[6]) + ' m' });
    if (typeof gps[0x11] === 'number') items.push({ label: 'Direction', value: Math.round(gps[0x11]) + '°' });
    if (Array.isArray(gps[7]) && gps[7].length >= 3) {
      const time = gps[7].map(n => String(Math.floor(n)).padStart(2, '0')).join(':') + ' UTC';
      items.push({ label: 'GPS time', value: [text(gps, 0x1D), time].filter(Boolean).join(' ') });
    }
    if (!items.length && Object.keys(gps).some(k => k !== '0')) items.push({ label: 'GPS data', value: 'present' });

    // Device, person, time, software
    const taken = text(exif, 0x9003);
    const digitized = text(exif, 0x9004);
    const modified = text(ifd0, 0x0132);
    const offsetTime = text(exif, 0x9011);
    const userComment = exif[0x9286] instanceof Uint8Array && asciiAt(view, exif[0x9286].byteOffset, 'UNICODE\0')
      ? bytesText(exif, 0x9286, little ? 'utf-16le' : 'utf-16be', 8)
      : bytesText(exif, 0x9286, 'utf-8', 8);
    const rows = [
      ['Camera', [text(ifd0, 0x010F), text(ifd0, 0x0110)].filter(Boolean).join(' ')],
      ['Lens', [text(exif, 0xA433), text(exif, 0xA434)].filter(Boolean).join(' ')],
      ['Body serial', text(exif, 0xA431)],
      ['Lens serial', text(exif, 0xA435)],
      ['Owner', text(exif, 0xA430)],
      ['Artist', text(ifd0, 0x013B)],
      ['Date taken', taken && (offsetTime ? taken + ' ' + offsetTime : taken)],
      ['Date digitized', digitized !== taken ? digitized : null],
      ['Date modified', modified !== taken ? modified : null],
      ['Software', text(ifd0, 0x0131)],
      ['Host device', text(ifd0, 0x013C)],
      ['Description', text(ifd0, 0x010E)],
      ['Copyright', text(ifd0, 0x8298)],
      ['Comment', userComment],
      ['Image ID', text(exif, 0xA420)],
      ['Windows title', bytesText(ifd0, 0x9C9B, 'utf-16le', 0)],
      ['Windows comment', bytesText(ifd0, 0x9C9C, 'utf-16le', 0)],
      ['Windows author', bytesText(ifd0, 0x9C9D, 'utf-16le', 0)],
      ['Windows keywords', bytesText(ifd0, 0x9C9E, 'utf-16le', 0)],
      ['Windows subject', bytesText(ifd0, 0x9C9F, 'utf-16le', 0)]
    ];
    rows.forEach(([label, value]) => { if (value) items.push({ label, value: clip(value) }); });

    if (exif[0x927C] instanceof Uint8Array && exif[0x927C].length) {
      items.push({ label: 'Maker notes', value: formatBytes(exif[0x927C].length) });
    }

    // Embedded thumbnail (IFD1), which can hold an uncropped copy of the photo
    if (ifd0Pos + 2 <= view.byteLength) {
      const nextPos = ifd0Pos + 2 + view.getUint16(ifd0Pos, little) * 12;
      if (nextPos + 4 <= view.byteLength) {
        const ifd1Offset = view.getUint32(nextPos, little);
        if (ifd1Offset) {
          const ifd1 = readIFD(view, tiffStart, tiffStart + ifd1Offset, little);
          if (0x0201 in ifd1) {
            items.push({ label: 'Thumbnail', value: typeof ifd1[0x0202] === 'number' ? formatBytes(ifd1[0x0202]) : 'present' });
          }
        }
      }
    }
    return items;
  }

  // ---------- lightweight PNG / WebP chunk scan (detection only) ----------
  function scanPngChunks(buffer){
    const view = new DataView(buffer);
    if (view.byteLength < 8) return [];
    const sig = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    for (let i = 0; i < 8; i++) if (view.getUint8(i) !== sig[i]) return [];
    let offset = 8;
    const found = new Set();
    while (offset + 8 <= view.byteLength) {
      const length = view.getUint32(offset, false);
      let type = '';
      for (let j = 0; j < 4; j++) type += String.fromCharCode(view.getUint8(offset + 4 + j));
      if (['tEXt','zTXt','iTXt'].includes(type)) found.add('Text fields');
      if (type === 'eXIf') found.add('EXIF data');
      if (type === 'tIME') found.add('Timestamp');
      if (type === 'IEND') break;
      offset += 8 + length + 4;
    }
    return Array.from(found).map(label => ({ label, value: 'present' }));
  }

  function scanWebpChunks(buffer){
    const view = new DataView(buffer);
    if (view.byteLength < 12) return [];
    if (view.getUint32(0, false) !== 0x52494646) return []; // 'RIFF'
    const found = new Set();
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      let type = '';
      for (let j = 0; j < 4; j++) type += String.fromCharCode(view.getUint8(offset + j));
      const size = view.getUint32(offset + 4, true);
      if (type === 'EXIF') found.add('EXIF data');
      if (type === 'XMP ') found.add('XMP data');
      offset += 8 + size + (size % 2);
    }
    return Array.from(found).map(label => ({ label, value: 'present' }));
  }

  function detectMetadata(file, buffer){
    try {
      if (file.type === 'image/jpeg') return inspectJpeg(buffer);
      if (file.type === 'image/png') return scanPngChunks(buffer);
      if (file.type === 'image/webp') return scanWebpChunks(buffer);
    } catch (e) { /* non-fatal, treat as unknown */ }
    return null; // null = "couldn't check", [] = "checked, found nothing"
  }

  // ---------- canvas re-encode (actually strips everything, always) ----------
  async function stripMetadata(file, mime, quality){
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode failed')), mime, quality);
    });
  }

  // ---------- card rendering ----------
  function createCard(file){
    const card = document.createElement('div');
    card.className = 'card file-card';

    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.textContent = 'CLEARED';
    card.appendChild(stamp);

    const top = document.createElement('div');
    top.className = 'file-top';

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.alt = '';
    const objectUrl = URL.createObjectURL(file);
    const releaseThumb = () => URL.revokeObjectURL(objectUrl);
    thumb.addEventListener('load', releaseThumb, { once: true });
    thumb.addEventListener('error', releaseThumb, { once: true });
    thumb.src = objectUrl;

    const info = document.createElement('div');
    info.className = 'file-info';

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;

    const sizes = document.createElement('div');
    sizes.className = 'file-sizes';
    sizes.textContent = formatBytes(file.size);

    const status = document.createElement('div');
    status.className = 'file-status';
    status.textContent = 'waiting…';

    info.appendChild(name);
    info.appendChild(sizes);
    info.appendChild(status);

    top.appendChild(thumb);
    top.appendChild(info);
    card.appendChild(top);

    const metaList = document.createElement('div');
    metaList.className = 'meta-list';
    card.appendChild(metaList);

    return { card, thumb, sizes, status, metaList, stamp };
  }

  function renderMetadata(refs, items){
    refs.metaList.innerHTML = '';
    if (items === null) {
      const p = document.createElement('div');
      p.className = 'meta-unknown';
      p.textContent = 'Metadata check unavailable for this format. Stripping proceeds anyway.';
      refs.metaList.appendChild(p);
      return;
    }
    if (items.length === 0) {
      const p = document.createElement('div');
      p.className = 'meta-clean';
      p.textContent = 'No known identifying metadata found.';
      refs.metaList.appendChild(p);
      return;
    }
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'meta-row';

      const label = document.createElement('div');
      label.className = 'meta-label';
      label.textContent = item.label;

      const wrap = document.createElement('div');
      wrap.className = 'meta-value-wrap';

      const value = document.createElement('span');
      value.className = 'meta-value';
      value.textContent = item.value;

      const bar = document.createElement('div');
      bar.className = 'meta-bar';

      wrap.appendChild(value);
      wrap.appendChild(bar);
      row.appendChild(label);
      row.appendChild(wrap);
      refs.metaList.appendChild(row);
    });
  }

  function redactRows(refs){
    const rows = refs.metaList.querySelectorAll('.meta-row');
    rows.forEach((row, i) => {
      setTimeout(() => row.classList.add('redacted'), 120 * i);
    });
  }

  function updateZipVisibility(){
    zipRow.classList.toggle('visible', processedFiles.length >= 2);
  }

  // Saves a blob through a temporary link. The object URL only lives long enough
  // for the download to start, so nothing stays pinned in memory.
  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Decoding and re-encoding large photos is memory-heavy, so only a few run at once.
  const MAX_CONCURRENT = 3;
  const pending = [];
  let running = 0;

  function pump(){
    while (running < MAX_CONCURRENT && pending.length) {
      const job = pending.shift();
      running++;
      job().catch(() => {}).finally(() => { running--; pump(); });
    }
  }

  function processFile(file){
    const refs = createCard(file);
    fileListEl.appendChild(refs.card);
    pending.push(() => scrubFile(file, refs));
    pump();
  }

  async function scrubFile(file, refs){
    refs.status.textContent = 'scrubbing…';

    let items = null;
    try {
      const buf = await file.arrayBuffer();
      items = detectMetadata(file, buf);
    } catch (e) { items = null; }

    renderMetadata(refs, items);

    const outSelection = formatSelect.value;
    const mime = outSelection === 'original' ? (file.type || 'image/jpeg') : outSelection;
    const quality = parseInt(qualitySlider.value, 10) / 100;

    try {
      const cleanedBlob = await stripMetadata(file, mime, quality);
      // toBlob silently falls back to PNG when the browser can't encode the requested type
      const actualMime = cleanedBlob.type || mime;
      const outName = suggestFilename(file.name, actualMime);

      refs.sizes.innerHTML =
        formatBytes(file.size) +
        '<span class="arrow">→</span><span class="cleaned">' + formatBytes(cleanedBlob.size) + '</span>';

      refs.status.innerHTML = '';
      const link = document.createElement('a');
      link.className = 'download-link';
      link.href = '#';
      link.textContent = 'Download';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        downloadBlob(cleanedBlob, outName);
      });
      refs.status.appendChild(link);
      if (actualMime !== mime) {
        const note = document.createElement('div');
        note.className = 'meta-unknown';
        note.textContent = 'This browser can’t encode ' + mimeLabel(mime) + ', so the file was saved as ' + mimeLabel(actualMime) + '.';
        refs.status.appendChild(note);
      }

      refs.stamp.classList.add('show');
      if (items && items.length) redactRows(refs);

      processedFiles.push({ name: outName, blob: cleanedBlob });
      updateZipVisibility();
    } catch (e) {
      refs.status.textContent = 'Could not process this file.';
    }
  }

  zipBtn.addEventListener('click', async () => {
    zipBtn.disabled = true;
    zipBtn.textContent = 'Zipping…';
    let failed = false;
    try {
      const zip = new JSZip();
      processedFiles.forEach(f => zip.file(f.name, f.blob));
      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, 'scrubbed-images.zip');
    } catch (e) {
      failed = true;
    } finally {
      zipBtn.disabled = false;
      zipBtn.textContent = failed ? 'Zip failed, click to retry' : 'Download all as .zip';
    }
  });

})();
