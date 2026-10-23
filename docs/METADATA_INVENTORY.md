# Metadata inventory

Which metadata fields can carry personal or device information, per image format, and which of them Scrubit currently looks for.

Two things are tracked separately:

- **Stripping** removes everything, always. Every output is a fresh canvas re-encode, so every field below is gone from the exported file whether or not it is detected. See [HOW_IT_WORKS.md](HOW_IT_WORKS.md).
- **Detection** only decides what the UI *shows* before stripping. This document records what it can show.

When a parser in `script.js` changes, update the tables here in the same commit.

## Legend

**Category**

| Category | Meaning |
| --- | --- |
| Location | Where the photo was taken or where the subject is |
| Device | Identifies the camera, phone, lens or computer, including serial numbers |
| Person | Names, contact details, free text written by or about a person |
| Time | When the photo was taken, digitized or edited |
| Software | Editing or capture software, which can reveal workflow or OS |
| Content | A second copy of image data (thumbnails, extra images) that may be uncropped or unedited |
| Unique ID | Identifiers that can link files to each other or to a device or edit session |

**Detection status**

| Status | Meaning |
| --- | --- |
| Value | Parsed, and the actual value is shown |
| Present | Detected, but only the fact it exists (and usually its size) is shown |
| Segment | Not parsed, but the containing JPEG segment is listed as "Unrecognized data", so the file can't look clean |
| None | Not detected. Removed by stripping, never shown |

## Supported input formats

Only JPEG, PNG and WebP are accepted (`handleFiles` filters on MIME type). Other formats are listed at the end as follow-up candidates.

---

## JPEG

JPEG has the most detection because it is the format phones and cameras produce. A JPEG file is a list of marker segments before the image data; Scrub walks all of them (`inspectJpeg`), so any metadata segment is at least reported even when its contents are not understood.

### Segments

| Segment | Content | Category | Status |
| --- | --- | --- | --- |
| `APP0` `JFIF` | Version, pixel density | none | Ignored (harmless) |
| `APP0` `JFXX` | Extension thumbnail | Content | Present |
| `APP1` `Exif` | EXIF/TIFF block, see tables below | multiple | Value |
| `APP1` XMP (`http://ns.adobe.com/xap/1.0/`) | XML packet | multiple | Present, plus selected fields (see XMP) |
| `APP1` XMP extension | Overflow of a large XMP packet | multiple | Present |
| `APP2` `ICC_PROFILE` | Color profile | none | Ignored (harmless) |
| `APP2` `MPF` | Multi-picture index; secondary images (previews, depth/gain maps) may follow the main image | Content | Present |
| `APP11` `JP` (JUMBF) | Content Credentials / C2PA manifest: signer, edit history, device | Person, Software, Unique ID | Present |
| `APP13` `Photoshop 3.0` | Photoshop resources, including IPTC-IIM | Person, Location | Value for listed IPTC fields, else Present |
| `APP14` `Adobe` | Color transform flag | none | Ignored (harmless) |
| `COM` | Free-text comment | Person | Value |
| Any other `APPn` / `JPGn` | Vendor data (for example Samsung, Ricoh, Kodak, Qualcomm segments) | unknown | Segment |
| Bytes after `EOI` | Appended data: phone-attached audio or video, a trailing second image, leftovers from editing tools | Content, unknown | Present |

### EXIF IFD0 (main image tags)

| Tag | Name | Category | Status |
| --- | --- | --- | --- |
| `0x010E` | ImageDescription | Person | Value ("Description") |
| `0x010F` | Make | Device | Value ("Camera") |
| `0x0110` | Model | Device | Value ("Camera") |
| `0x0131` | Software | Software | Value |
| `0x0132` | DateTime (last modified) | Time | Value ("Date modified") |
| `0x013B` | Artist | Person | Value |
| `0x013C` | HostComputer | Device | Value ("Host device") |
| `0x8298` | Copyright | Person | Value |
| `0x9C9B` | XPTitle | Person | Value ("Windows title") |
| `0x9C9C` | XPComment | Person | Value ("Windows comment") |
| `0x9C9D` | XPAuthor | Person | Value ("Windows author") |
| `0x9C9E` | XPKeywords | Person | Value ("Windows keywords") |
| `0x9C9F` | XPSubject | Person | Value ("Windows subject") |
| `0x8769` | ExifIFD pointer | structural | Followed |
| `0x8825` | GPS IFD pointer | structural | Followed |
| `0x0112` | Orientation | none | Not reported; baked into the pixels during stripping |
| `0x010D` | DocumentName | Person | None |
| `0xC614`, `0xC62F` | UniqueCameraModel, CameraSerialNumber (DNG-derived files) | Device | None |

### EXIF sub-IFD (`0x8769`)

| Tag | Name | Category | Status |
| --- | --- | --- | --- |
| `0x9003` | DateTimeOriginal | Time | Value ("Date taken") |
| `0x9011` | OffsetTimeOriginal | Time, Location (time zone) | Value, appended to "Date taken" |
| `0x9004` | DateTimeDigitized | Time | Value ("Date digitized"), hidden if equal to Date taken |
| `0x9286` | UserComment | Person | Value when non-empty ("Comment") |
| `0x927C` | MakerNote | Device, Unique ID, Location (some vendors) | Present (size) |
| `0xA420` | ImageUniqueID | Unique ID | Value ("Image ID") |
| `0xA430` | CameraOwnerName | Person | Value ("Owner") |
| `0xA431` | BodySerialNumber | Device | Value ("Body serial") |
| `0xA433` | LensMake | Device | Value ("Lens") |
| `0xA434` | LensModel | Device | Value ("Lens") |
| `0xA435` | LensSerialNumber | Device | Value ("Lens serial") |
| `0x9010`, `0x9012` | OffsetTime, OffsetTimeDigitized | Time | None |
| `0x9290`-`0x9292` | SubSecTime fields | Time | None |
| `0xA004` | RelatedSoundFile (a file name) | Person | None |

### GPS IFD (`0x8825`)

| Tags | Name | Category | Status |
| --- | --- | --- | --- |
| `0x01`-`0x04` | Latitude and longitude, with N/S and E/W refs | Location | Value ("Location") |
| `0x05`, `0x06` | Altitude and its above/below sea-level ref | Location | Value ("Altitude") |
| `0x07`, `0x1D` | GPS time and date stamp (UTC) | Time, Location | Value ("GPS time") |
| `0x11` | Image direction (compass bearing) | Location | Value ("Direction") |
| other | Speed (`0x0D`), track (`0x0F`), map datum (`0x12`), destination coordinates (`0x14`-`0x17`), processing method (`0x1B`), area name (`0x1C`) | Location | Not shown individually. A "GPS data: present" row appears only when none of the rows above were found |

### EXIF IFD1 (thumbnail)

| Tags | Name | Category | Status |
| --- | --- | --- | --- |
| `0x0201`, `0x0202` | Embedded JPEG thumbnail and its length | Content | Present (size). Thumbnails often keep the uncropped original after the main image was cropped or redacted |

### XMP (`APP1`)

The packet is reported as "XMP data" with its size. These properties are additionally extracted (attribute or element form):

| Property | Category | Label |
| --- | --- | --- |
| `exif:GPSLatitude`, `exif:GPSLongitude` | Location | Location (XMP) |
| `dc:creator` | Person | Author |
| `xmp:CreateDate` | Time | Date taken (XMP) |
| `xmp:CreatorTool` | Software | Software |

Not extracted (covered only by the "XMP data" row): `xmpMM:DocumentID` / `InstanceID` / `OriginalDocumentID` (Unique ID), `xmpMM:History` (edit history, software, sometimes file paths), `photoshop:City` / `State` / `Country` (Location), `dc:rights` and `xmpRights:*` (Person), `aux:SerialNumber` and `aux:Lens` (Device), `crs:*` develop settings (Software), face and region tags such as `mwg-rs:Regions` (Person).

### IPTC-IIM (`APP13`, resource `0x0404`)

| Dataset | Name | Category | Status |
| --- | --- | --- | --- |
| `2:05` | Object name (title) | Person | Value ("Title") |
| `2:25` | Keywords | Person | Value |
| `2:80` | By-line (photographer) | Person | Value ("Photographer") |
| `2:90` | City | Location | Value |
| `2:92` | Sub-location | Location | Value |
| `2:95` | Province or state | Location | Value ("State/Province") |
| `2:101` | Country name | Location | Value |
| `2:110` | Credit | Person | Value |
| `2:115` | Source | Person | Value |
| `2:116` | Copyright notice | Person | Value |
| `2:120` | Caption or abstract | Person | Value ("Caption") |
| `2:55`, `2:60` | Date and time created | Time | None |
| `2:122` | Writer or editor | Person | None |
| `2:40` | Special instructions | Person | None |
| `2:85` | By-line title | Person | None |

If an `APP13` block holds no listed dataset, it is reported as "Photoshop data" with its size so it does not pass unnoticed. Datasets not in the table are only noticed this way when the listed ones are all absent.

---

## PNG

PNG detection is a chunk scan (`scanPngChunks`) and reports presence only. Unlike JPEG there is no inventory of unknown chunks, so an unlisted chunk is not reported.

| Chunk | Content | Category | Status |
| --- | --- | --- | --- |
| `tEXt`, `zTXt`, `iTXt` | Keyword/value text. Common keywords: `Author`, `Comment`, `Description`, `Copyright`, `Software`, `Source`, `Creation Time`; `XML:com.adobe.xmp` (a full XMP packet); `Raw profile type exif` / `xmp` / `iptc` (legacy encodings of full EXIF or IPTC, including GPS) | Person, Location, Device, Time, Software | Present ("Text fields"), keywords and values not shown |
| `eXIf` | A complete EXIF block | Location, Device, Time, Person | Present ("EXIF data"), not parsed |
| `tIME` | Last-modification time | Time | Present ("Timestamp") |
| `iCCP` | Color profile (profile name can identify a display or device) | Device | None |
| `caBX` | Content Credentials (C2PA) | Person, Software, Unique ID | None |
| Other ancillary chunks | Software-specific private chunks | unknown | None |

## WebP

WebP detection is a RIFF chunk scan (`scanWebpChunks`) and reports presence only.

| Chunk | Content | Category | Status |
| --- | --- | --- | --- |
| `EXIF` | A complete EXIF block | Location, Device, Time, Person | Present ("EXIF data"), not parsed |
| `XMP ` | A complete XMP packet | multiple | Present ("XMP data"), not parsed |
| `ICCP` | Color profile | Device | None |
| `C2PA` | Content Credentials | Person, Software, Unique ID | None |
| Other chunks | Unknown extensions | unknown | None |

---

## Identifying information outside metadata

Stripping cannot remove these, and they are not detected:

- **Image content**: visible faces, street signs, license plates, screens, reflections, documents in frame.
- **File name**: the output keeps the original name plus `-clean`. A name like `home-address.jpg` stays in the download.
- **Pixel-level fingerprints**: sensor noise patterns and invisible watermarks survive a re-encode.

## Formats not supported

These are rejected at intake today. They are the follow-up candidates, roughly by how likely users are to hit them:

| Format | Where the personal data lives |
| --- | --- |
| HEIC / HEIF | EXIF and XMP items inside the ISO-BMFF container; the default format for iPhone photos |
| AVIF | Same container family as HEIC |
| GIF | Comment extension and XMP in an application extension |
| TIFF and camera RAW | EXIF/TIFF IFDs, embedded previews, XMP, maker notes |
| BMP | Essentially none |

## Known gaps, in priority order

1. PNG and WebP: parse `eXIf` and `EXIF` with the existing TIFF reader, show text-chunk keywords and values, and add an unknown-chunk inventory like the JPEG one.
2. XMP: extract more properties, especially `xmpMM:History` and the ID fields.
3. IPTC: add date/time created, writer, and instructions.
4. EXIF: `SubSecTime*` and the remaining `OffsetTime*` tags, the non-coordinate GPS fields, and `RelatedSoundFile`.
5. HEIC / AVIF input.
