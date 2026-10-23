# How Scrubit works

This document describes what happens to an image between the moment it is dropped on the page and the moment the cleaned copy is downloaded. All of the logic lives in `script.js`; line references are approximate.

## Overview

Scrubit does two independent things for every file:

1. **Detect** (best effort, display only): read the original bytes and report what hidden metadata they appear to contain.
2. **Strip** (unconditional): decode the image to pixels and re-encode those pixels into a brand-new file.

```
 File ──┬─► arrayBuffer() ─► detectMetadata() ─► metadata card (display only)
        │
        └─► createImageBitmap() ─► <canvas> ─► toBlob() ─► clean Blob ─► download / zip
```

The two branches share nothing except the original `File`. The output never depends on what detection found, or on whether detection succeeded. Everything runs in the browser tab; no image data is sent anywhere.

## Step by step

### 1. Intake (`handleFiles`)

Files arrive from a drag-and-drop on `#dropzone` or from the hidden `<input type="file">` (opened by clicking the zone or pressing Enter/Space on it).

`handleFiles` keeps only files whose MIME type matches `image/(jpeg|png|webp)`. Anything else is silently ignored. Each accepted file is passed to `processFile`. A card appears immediately for each file with a "waiting…" status, but only 3 files are decoded and re-encoded at a time (`MAX_CONCURRENT`), so a large batch of big photos doesn't exhaust memory.

### 2. Card creation (`createCard`)

A card is added to the list straight away, showing a thumbnail (from `URL.createObjectURL(file)`, the *original* file), the name, the original size, and a `scrubbing…` status. A hidden `CLEARED` stamp is attached to the card and revealed on success.

### 3. Detection (`detectMetadata`)

The file is read with `file.arrayBuffer()` and dispatched by MIME type. The function has three possible outcomes, and the UI treats them differently:

| Return value | Meaning | UI message |
| --- | --- | --- |
| `null` | Could not check (parse error, unsupported type) | "Metadata check unavailable for this format. Stripping proceeds anyway." |
| `[]` | Checked, nothing found | "No known identifying metadata found." |
| `[{label, value}, ...]` | Items found | One row per item |

#### JPEG (`inspectJpeg`, `parseTiff`, `readIFD`)

A hand-written parser, with no external library. It walks every marker segment in the file, so metadata is reported even when its contents aren't understood:

1. Verify the `FFD8` (SOI) signature. Anything else returns `null` ("check unavailable").
2. Walk the segments. Standalone markers advance by 2 bytes; other segments advance by `2 + length`. At the start-of-scan marker (`DA`) the walker switches to skipping entropy-coded image data, handling `FF00` stuffing and restart markers, and keeps going so it can find the end-of-image marker (`D9`).
3. Each `APPn`, `JPGn` and `COM` segment is classified:
   - **Harmless, ignored:** JFIF, ICC profile, Adobe color transform.
   - **Parsed:** EXIF (`parseTiff`), XMP, IPTC inside Photoshop resources (`APP13`), JPEG comments.
   - **Named, not parsed:** JFXX thumbnail, Multi-Picture Format, Content Credentials (`APP11`).
   - **Everything else**, including EXIF that fails to parse, is reported as "Unrecognized data" with the segment name and size.
4. Bytes after the end-of-image marker are reported as "Trailing data".

Because of steps 3 and 4, an empty result means the file holds no metadata segments beyond the harmless ones, not merely that the tags we know about were absent.

`parseTiff` reads the byte-order mark, follows IFD0 to the Exif sub-IFD (`0x8769`), the GPS IFD (`0x8825`) and the thumbnail IFD (IFD1), and turns the tags into display rows. GPS coordinates are converted to decimal degrees as `d + m/60 + s/3600`, with the reference tags flipping the sign for `S` and `W`. `readIFD` decodes ASCII, BYTE, SHORT, LONG, RATIONAL and UNDEFINED entries, and skips entries whose data would fall outside the buffer.

The full list of tags and what category of information each one carries is in [METADATA_INVENTORY.md](METADATA_INVENTORY.md).

#### PNG (`scanPngChunks`)

After checking the 8-byte signature, the chunk stream is walked (`length`, 4-byte type, data, CRC) until `IEND`. Presence only is reported:

| Chunk | Label |
| --- | --- |
| `tEXt`, `zTXt`, `iTXt` | Text fields |
| `eXIf` | EXIF data |
| `tIME` | Timestamp |

#### WebP (`scanWebpChunks`)

After checking for the `RIFF` header, the chunk list is walked (4-byte type, little-endian size, data padded to an even length). Presence only is reported for `EXIF` and `XMP `.

### 4. Rendering what was found (`renderMetadata`)

Each item becomes a row with a label, the value, and a `.meta-bar` overlay. The values are always in the DOM; the "Show removed data" toggle adds the `reveal-metadata` class to `<body>`, which CSS uses to decide whether the values are visible or hidden behind the bars.

### 5. Choosing the output format

Read at the moment the file starts processing:

- `#formatSelect` is either `original` (use the file's own MIME type, falling back to `image/jpeg`) or an explicit `image/jpeg`, `image/png` or `image/webp`.
- `#qualitySlider` (percent) is divided by 100 and passed as the encoder quality.

Changing these controls affects only files processed afterwards; cards already on the page are not re-encoded.

### 6. Stripping (`stripMetadata`)

This is the step that actually removes the data:

```js
const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
const canvas = document.createElement('canvas');
canvas.width = bitmap.width;
canvas.height = bitmap.height;
canvas.getContext('2d').drawImage(bitmap, 0, 0);
bitmap.close();
canvas.toBlob(cb, mime, quality);
```

Why this works: a canvas holds only a grid of RGBA pixels. EXIF blocks, GPS, XMP, IPTC, maker notes, PNG text chunks, thumbnails, comments and ICC profiles are not part of that grid, so none of it can be carried across. `toBlob` then writes a fresh file with only the headers the browser's encoder chooses to emit.

Details worth knowing:

- **Orientation is baked in.** `imageOrientation: 'from-image'` makes the browser apply the EXIF rotation to the pixels while decoding. Because the orientation tag is then discarded with the rest of the EXIF, the image still displays upright.
- **Quality** applies only to JPEG and WebP. It is ignored for PNG.
- **Unsupported output type.** `toBlob` silently falls back to PNG when the browser can't encode the requested type (Safari cannot encode WebP). The code reads `blob.type` after encoding, names the file with the extension of what was actually produced, and shows a note on the card.
- **Failure** (undecodable file, encoder returns `null`) rejects the promise; the card shows "Could not process this file." and the file is not added to the download list.

### 7. Completion

On success, the card:

- shows `original size → cleaned size`,
- replaces the status with a **Download** link for the new Blob, named `<original-name>-clean.<ext>` (the extension follows the output MIME type),
- reveals the `CLEARED` stamp,
- plays the redaction animation, with each metadata row getting the `redacted` class on a 120 ms stagger,
- pushes `{ name, blob }` to `processedFiles`.

### 8. Batch download

Once two or more files have been processed, the "Download all as .zip" row appears. Clicking it builds a zip in memory with JSZip (loaded from a CDN with a Subresource Integrity hash, so a tampered copy is refused), containing every entry in `processedFiles`, and triggers a download named `scrubbed-images.zip`. The cleaned bytes are the same blobs offered individually. If zipping fails, the button says so and can be clicked again.

## What is and isn't guaranteed

**Guaranteed by design:** the output file is produced by the browser's image encoder from decoded pixels, so metadata from the original file cannot be copied into it. This holds for JPEG, PNG and WebP regardless of whether detection understood the file.

**Not guaranteed or not shown:**

- Detection is a convenience. For JPEG, every metadata segment is at least listed, and the common EXIF, GPS, XMP and IPTC fields are shown with their values. Fields not in [METADATA_INVENTORY.md](METADATA_INVENTORY.md) are removed by stripping but may only appear as part of a larger row ("XMP data", "Maker notes") or not individually at all.
- PNG and WebP detection reports presence only, not values, and has no inventory of unknown chunks, so a clean PNG or WebP result is weaker than a clean JPEG result.
- The result is not byte- or bit-identical to the input. It is a re-encode: for JPEG and WebP at less than 100% quality, the lossy step is applied again, which may change file size and introduce small differences. Converting PNG to JPEG also loses transparency, since JPEG has no alpha channel.
- Color profiles are dropped, so images with a wide-gamut ICC profile may look slightly different.
- Only the first frame is kept for animated images.
- Metadata that is *in the picture itself*, such as a visible street sign or a face, is of course untouched.
- The file name is not scrubbed beyond appending `-clean`; a name like `home-address.jpg` stays in the output name.

## Privacy properties

- The original `File` is only ever read locally (`arrayBuffer`, `createImageBitmap`, `createObjectURL`).
- The only network requests are for the JSZip script (integrity-checked against a pinned SHA-512) and the page fonts. No request carries image data.
- Object URLs are short-lived: a thumbnail's URL is revoked as soon as the image has loaded, and a download's URL is created when the link is clicked and revoked ten seconds later. They are local `blob:` URLs and are not reachable from other origins.

## Code map

| Concern | Function(s) |
| --- | --- |
| Intake and filtering | `handleFiles` |
| Per-file pipeline | `processFile` |
| JPEG detection | `inspectJpeg`, `parseTiff`, `readIFD`, `xmpItems`, `iptcItems` |
| PNG / WebP detection | `scanPngChunks`, `scanWebpChunks` |
| Detection dispatch | `detectMetadata` |
| Stripping | `stripMetadata` |
| UI | `createCard`, `renderMetadata`, `redactRows`, `updateZipVisibility` |
| Batch download | `zipBtn` click handler |
