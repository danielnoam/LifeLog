# LifeLog — feature log

## Done (2026-06-13)

### 1. Tip to enable File System Access (Brave) ✅
Settings → Data file now shows step-by-step `brave://flags` instructions when the
File System Access API is unavailable, instead of a dead-end message.

### 2. Combine duplicate entries in Category view ✅
Same-title entries in a category collapse into one row with a `×N` badge and a
clickable date chip per occurrence (click a chip to edit that specific one).
- **Decision:** the category/stats counts still count each occurrence (so totals
  stay consistent with the sheet). The combining is display-only.

### 3. "Date added" on entries ✅
New entries get a `createdAt` timestamp. Shown as "Added …" in the edit modal,
included as an "Added" column in CSV export, preserved through JSON import.
(Imported sheet entries have no createdAt — that's expected.)

### 4. "+ Add" → Entry or Achievement ✅
The Add button is now a menu: **Add entry** / **Add achievement ★**.
Achievements (per-year ★ badges) can be added, and the timeline chips are
clickable to edit or delete them — previously they were import-only.

## Ideas / not started
- Sort options (e.g. "recently added") using createdAt.
- Auto-regenerate the original Google Sheet visual grid from the data.
- Revisit how `Other | <number>` entries (monthly misc counts) should be counted.
