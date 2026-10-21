# Changelog

Features and fixes, newest first. Each entry names its commit. For how a feature works, see [EDITING_GUIDE.md](EDITING_GUIDE.md); for how it's built and which editor it follows, see [ARCHITECTURE.md](ARCHITECTURE.md).

Status of the remaining gaps is tracked at the bottom.

---

## 2026-10-21

### Track lock and track height
- **Lock** (padlock in the track header): a locked track's clips can't be selected, moved, trimmed, split or deleted. Nothing can be dropped, pasted or moved onto it, and range edits, close gaps and split-all skip it. Locked tracks are striped. This follows Premiere's track lock.
- **Height** (↕ in the track header): cycles normal, tall and compact for each track. Thumbnails, waveforms and labels fit the row, and the setting is saved with the project.

### JKL shuttle playback — `5680cff`
- **L** plays forward and **J** plays in reverse. Press again for 2×, 4× and 8×. **K** stops, and **K + J / L** steps one frame. This follows Premiere, FCP and Resolve.
- **Space** always plays at 1×. A speed badge (for example "▶▶ 4×") shows on the transport bar while shuttling.
- In reverse the picture follows the playhead by seeking, with no sound, because browsers can't play media backwards.

### Zoom & pan keyframes — `e4b71ca`
- Keyframed zoom (1–5×) and view center on V1 clips, like Camtasia's Zoom-n-Pan. Values ease between keyframes and hold outside them. Keyframes stay attached to the footage through moves, trims, splits and speed changes.
- Set in Properties: the sliders edit the keyframe at the playhead or add one there, with previous/next and delete buttons. Diamonds on the clip jump to a keyframe.
- Fix: scrubbing the ruler no longer clears the clip selection.

### Preview audio follows mute / solo — `b9a20f2`
- Fix: the preview played V1 clip audio even when the track was muted or "Has audio" was off. It now follows the export's rules, including fades.

### Fades for text and annotations — `e7a3d4d`
- Fade in/out on every text overlay and annotation, 0.3 s by default for new ones. Sliders are in Properties, and the overlay lane shows the ramps.

### Annotations and the overlay lane — `f0d6554`
- Callout, arrow, rectangle and ellipse annotations. Drag and resize them in the preview; style them in Properties.
- A timeline lane showing every text overlay, caption and annotation. Drag a bar to move it and its edges to trim it.

### Still images, transitions, working export — `7ed4d51`
- Import images (PNG, JPEG, WebP; other formats are converted). They go on video tracks, and transparency is kept on V2 and above.
- V1 transitions: dissolve, fade through black, wipes, slides. They're centered on the cut and don't change the video's length.
- Fix: export never worked. Four problems stopped it: the worker path in dev, the core build, the multi-threaded core hanging, and silent videos crashing the export.
- Fix: fades on V2 and above went to black instead of transparent, and started at the wrong time.

### Picture-in-picture drag, `.srt` import — `5d0f026`
- Drag and corner-resize PiP layers in the preview.
- Import `.srt` subtitle files as captions; no API key needed.

### Media library and core editing — `655a41b`
- Media library: import, add to the timeline, rename, remove, remove unused. Media is stored once per file, and older projects convert on load.
- Moving clips into free slots, drag to reorder, multi-select moves, trim to playhead (Q/W), join, close gaps, multi-clip delete, right-click menu, resizable panels, many new shortcuts, and a **?** shortcut sheet.
- Fixes: clicking a clip never selected it (so deleting after a split did nothing); autosave failed in a fresh browser; selecting several clips crashed the app; cross-track drag; trimming at non-1× speed; ruler labels.

---

## Before this changelog

`c403927` and earlier: the original MVP. Projects, V1/A1 timeline, trim and split, fades, speed, effects, PiP transform sliders, text overlays, auto captions, archives, MP4 export, and the marketing site.

---

## Remaining gaps

| Gap | Status |
|---|---|
| JKL playback | Done (this release) |
| Track lock and track height | Done (this release) |
| Text styling (font, weight, alignment, background, outline) | Planned next |
| Keyframes for PiP and annotations | Not started |
| Deployment of the editor and marketing site | Needs a decision on where to host |
