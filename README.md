# Scrubit

A browser-based tool that strips hidden metadata: GPS coordinates, camera make/model, timestamps, embedded text fields, out of photos before you share them. No server, no upload, no build step: open the page and it runs entirely on your device.

## Features

- **Drag-and-drop or file picker** for JPEG, PNG, and WebP images, one or many at a time
- **Shows you what's hidden** before removing it: location, camera details, date taken, and software tags are parsed out of JPEG EXIF data and displayed, each with a brief redaction animation as it's cleared
- **"Show removed data" toggle** to reveal the exact values that were stripped, for anyone who wants to double-check
- **Always strips everything**, even for formats where full metadata parsing isn't implemented; the removal step doesn't depend on the detection step being complete
- **Format conversion** to JPEG, PNG, or WebP, with an adjustable quality setting for lossy formats
- **Batch download** as a `.zip` once more than one file has been processed
- **Zero network dependency for the actual work**: the only external requests are for the JSZip library and the page's fonts, both loaded once from a CDN, with the script integrity-checked; no image data ever leaves the browser tab

## How it works

Every file, regardless of what metadata is found or not found in it, is redrawn onto an in-memory `<canvas>` element and re-exported as a new image. A canvas has no concept of EXIF or embedded metadata chunks, so the exported copy looks the same but carries none of the original file's hidden data. It is a re-encode, not a byte copy: lossy formats (JPEG, WebP below 100% quality) are compressed again, color profiles are dropped, and transparency is lost when converting to JPEG. This is the actual removal mechanism, and it's unconditional.

The metadata *shown* in the UI beforehand is a separate, best-effort read of the original file, used only for display:

- **JPEG**: a small hand-written parser walks every metadata segment and reads EXIF (including GPS, camera, lens, serial numbers and timestamps), XMP, IPTC and comments directly, with no external EXIF library. Any segment it doesn't understand is still listed, so a JPEG can't look clean while carrying hidden data.
- **PNG**: the file's chunk stream is scanned for `tEXt`, `zTXt`, `iTXt`, `eXIf`, and `tIME` chunks, and their presence is reported.
- **WebP**: the RIFF chunk list is scanned for `EXIF` and `XMP ` chunks.

If a file's metadata can't be parsed for display, the tool says so explicitly rather than claiming the file is clean, but it still strips it via the canvas step above.

For a step-by-step walkthrough, including limitations, see [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md). For which fields are looked for in each format, see [docs/METADATA_INVENTORY.md](docs/METADATA_INVENTORY.md).

## Getting started

No dependencies to install and nothing to build. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static file server, e.g.:

  ```bash
  npx serve .
  # or
  python3 -m http.server
  ```

An internet connection is only needed to load the page's font and the JSZip library from a CDN on first load; image processing itself works offline.

## Project structure

```
.
├── index.html    # Markup
├── styles.css    # All styling
├── script.js     # Metadata parsing, canvas-based stripping, UI logic
├── docs/         # How Scrubit works, metadata inventory
├── tests/        # Detection tests (Node's built-in test runner)
└── README.md
```

## Tests

The metadata detection code is covered by tests that need no installed dependencies, only Node 20 or newer:

```bash
node --test 'tests/*.test.mjs'
```

`tests/inspect-jpeg.test.mjs` builds JPEG byte structures by hand and runs everywhere. `tests/exiftool.test.mjs` writes real files with [ExifTool](https://exiftool.org) and checks the parser's output against them; it skips itself if `exiftool` is not installed (for example `sudo apt install libimage-exiftool-perl`).

## Browser support

Requires a browser with `createImageBitmap`, `canvas.toBlob`, and `File.prototype.arrayBuffer`: all current versions of Chrome, Firefox, Safari, and Edge.

## Privacy

Images are never uploaded, transmitted, or sent to any server. All parsing and processing happens locally in the browser using the Canvas API and typed arrays.

## License

MIT, see [LICENSE](LICENSE).
