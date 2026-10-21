# Editing Guide

This guide describes the editing features supported in the web video editor. Use it as a reference for what you can do today and how to do it. For how the editor is built, and which established editor (Camtasia, Premiere, Final Cut Pro…) each behavior comes from, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

1. Create or open a project.
2. Import media with **File → Import Media…**, or drop files on the **Media** tab. Files go into the media library.
3. Drag items from **Media** onto the timeline (or press **+** on an item to add it at the playhead).
4. Edit on the timeline and preview your changes.
5. Export with **File → Export Video…** or the **Export** button in the toolbar.

---

## 1. Project canvas (fixed resolution)

Every project has a fixed output size used when you export. The preview shows your edit; the exported file matches the project resolution you set.

**Default:** 1920×1080 (16:9) at 30 fps.

**Change resolution:** **File → Project Settings…**

- Choose a preset: 1080p, 720p, 480p, and others.
- Or enter a **Custom** width and height (for example, 1080×1920 for vertical 9:16 video).
- Set frame rate (24, 25, 30, or 60 fps) and audio sample rate (44.1 kHz or 48 kHz).

**Notes:**

- Source video is scaled to fit the project frame. Different aspect ratios are letterboxed (black bars) so nothing is cropped unexpectedly.
- The preview window uses a landscape frame for layout. Vertical projects still export at your chosen size.
- Exports above 1080p use more memory and may take longer in the browser.

---

## 2. Timeline (video + audio tracks)

Each project starts with:

- **V1** — one video track (your main picture)
- **A1** — one audio track (secondary audio, such as music or voiceover)

### Media library

The left sidebar has two tabs:

- **Media:** every file imported into the project (like Camtasia's Media Bin).
- **Clips:** every clip currently on the timeline, grouped by track.

**Import media:** use **File → Import Media…** or the upload icon in the Media tab, or drop files from your computer onto the Media tab. Importing adds files to the library only; it doesn't change the timeline.

**Use media on the timeline:**

- Drag an item from Media onto a track at the time you want. Video goes on video tracks and audio on audio tracks. If the spot is taken, the clip goes on another track of the same type, or into the nearest free gap.
- Or hover an item and click **+** to add it at the playhead.
- You can also drop files from your computer directly onto a track. They're imported and placed end to end.

**Manage the library:**

- Each item shows its duration and how many timeline clips use it ("used ×2" or "unused").
- **Click** an item to select all the clips that use it.
- **Double-click** the name to rename it. Clips that still have the old name are renamed too.
- **Trash icon:** removes the item. If clips use it, you'll be asked to confirm, and those clips are removed as well.
- **Broom icon:** removes all unused items at once.
- Right-click a clip and choose **Show in Media** to find its source in the library.

Splitting a clip doesn't duplicate its media. All pieces share the same library item.

**Track controls:**

- **M** — mute the track
- **S** — solo the track (only that track’s audio plays)

**Note:** The editor also supports adding extra video or audio tracks (for example, picture-in-picture). For a simple edit, use V1 and A1 only.

---

## 3. Playback (play, pause, seek)

Use the transport bar below the preview:

| Control | Action |
|--------|--------|
| Play / Pause | Start or stop playback |
| Skip to start / end | Jump to the beginning or end of the project |
| Time display | Shows current playhead position and total duration |

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| **Space** | Play / pause |
| **← / →** | Move playhead by 0.1 seconds (when no clip is selected) |

**Seek (scrub):**

- Click or drag on the **time ruler** above the timeline.
- Drag the **playhead** diamond on the timeline.

The preview updates as you move the playhead. Scrubbing is done on the timeline, not by clicking inside the preview image.

---

## 4. Editing clips (move, trim, split, join)

Right-click any clip for a menu with the actions below. It acts on the current selection; right-clicking an unselected clip selects it first.

### Select

- Click a clip to select it; **Shift+click** to add or remove clips from the selection. Click empty track space or press **Esc** to clear the selection.
- **⌘A / Ctrl+A** selects all clips. The command palette also has *Select Clips on Same Track* and *Select Clips Before/After Playhead*.

### Reorder

Drag a clip **onto another clip** to change the order. While you drag, a highlighted line shows where it will go: before the clip if you're over its left half, after it if you're over its right half. Drop it and the clip is inserted there. The space it left closes up, and later clips move right to make room. This works across tracks of the same type too. Grouped clips don't reorder; ungroup them first.

### Move

- **Drag** a clip into empty space on the track. Clips never overlap on a track. If you drop a clip where it doesn't fit, it settles into the **nearest free gap**, so you can drag a clip past its neighbors.
- Drag a clip **up or down** onto another track of the same type (for example V1 → V2 for picture-in-picture).
- With **several clips selected**, dragging one moves them all together. They stop as soon as any of them would hit another clip. Grouped clips (*Group Selected Clips*) always move together.
- **← / →** nudge the selection by 1 pixel at the current zoom (**Shift**: 10 pixels).
- Moves snap to clip edges, the playhead and ruler ticks.

### Trim (adjust clip ends)

- Hover near the **left or right edge** of a clip and drag the trim handle. Trims stop at neighboring clips and at the start or end of the source media.
- Hold **Shift** while trimming to **ripple** (following clips on the track shift with the edit).
- **Trim to playhead:** put the playhead inside a clip and press **Q** to trim the clip's start to the playhead, or **W** to trim its end. Add **Shift** (**Shift+Q / Shift+W**) to ripple, so no gap is left. With clips selected, only those are trimmed; otherwise every clip under the playhead is.

The **Properties** panel shows read-only **In** and **Out** times for the selected clip.

### Split (cut in the middle)

1. Move the playhead to where you want to cut.
2. Click **Split** in the timeline toolbar, use **Edit → Split at Playhead**, or press **S**.

The clip is divided into two clips at the playhead. Split works on the selected clips, or on every clip under the playhead when nothing is selected.

### Join (undo a split)

Select two or more pieces that sit side by side and were split from the same media, then choose **Join Clips** from the right-click menu or the command palette. They become one clip again. The joined clip keeps the left piece's settings and the right piece's fade-out.

Join only works on pieces that are continuous in the original media, at the same speed, with no gap between them. Otherwise the menu tells you why. To keep unrelated clips together instead, use **Group**.

### Delete and close gaps

- **⌫ / Delete** removes all selected clips and leaves a gap.
- **Shift+⌫** (*Ripple Delete*) removes them and closes the space on each track.
- **Close Gaps** (right-click menu or palette) slides the clips on a track together so there's no empty space. The first clip keeps its position. It works on the tracks of the selected clips, or on every track if nothing is selected.

### Range edits (In/Out)

- **I** / **O** mark the in and out points at the playhead (**Shift+I** / **Shift+O** clear them).
- **Trim to range** keeps only what's inside the range.
- **Delete range** removes what's inside it and closes the gap.

---

## 5. Audio control

### Mute original clip audio

You can remove embedded audio from video clips in the exported file:

- **Track mute:** Click **M** on **V1** to mute all audio from that video track in the export.
- **Per clip:** Select a video clip. In **Properties**, turn off **Has audio** (labeled “Mixed into export” / “Treated as silent”).

**Preview note:** The preview may still play embedded video audio even when mute is set. The exported MP4 reflects your mute settings.

### Add secondary audio

Import an audio file into **Media**, then drag it onto **A1** (or click **+** to add it at the playhead). You can place multiple audio clips on the timeline and move them like video clips.

### Volume slider

Select an **audio clip** on **A1**. In **Properties**, use the **Volume** slider (0–150%). Click the speaker icon to mute or unmute that clip.

Volume changes apply in both preview (for A1 clips) and export.

---

## 6. Clip properties (speed, fades, color, effects)

Select a clip and use the **Properties** panel on the right. With **several clips selected**, the panel shows the shared controls (fade, speed, volume, color, effects) and applies each change to all of them.

### Speed

**Speed** runs from **0.25×** (slow motion) to **4×** (fast). The clip gets longer or shorter on the timeline to match; trims stay on the same frames of the source. Click the reset icon to return to 1×. Audio keeps its pitch.

Slowing a clip down can't make it overlap the next clip. The slowest speed you can pick is limited by the space before the next clip, so make room first if you need it slower.

### Fade in / fade out

Set how many seconds the clip takes to fade in from black (or silence) and out again. Video fades show in the preview, audio fades are heard, and both are in the export. Fade-in plus fade-out can't be longer than the clip. When two neighboring clips on V1 both have fades, the preview crossfades between them.

### Clip color

Pick a label color for the clip on the timeline, which helps you find related clips. It doesn't affect the video. Reset returns to the default color.

### Effects (video clips)

| Effect | Range | Default |
|---|---|---|
| Brightness | 0.5 – 1.5 | 1 |
| Contrast | 0.5 – 1.5 | 1 |
| Saturation | 0 (black and white) – 2 | 1 |
| Blur | 0 – 20 px | 0 |

Effects preview live and are burned into the export. **Reset effects** clears all four.

---

## 7. Picture-in-picture (V2 and above)

Higher video tracks draw on top of lower ones, so a clip on **V2** covers **V1** wherever both play.

1. Click **+ Video track** in the timeline header to add V2 if you don't have it yet.
2. Drag a clip from Media (or from V1) onto V2.
3. Select it and click **Enable PiP** in Properties. The clip shrinks to a corner (25% size, top-left).
4. Position it:
   - **In the preview:** drag the layer to move it. Drag the small square at its bottom-right corner to resize it.
   - **In Properties:** use the **Position X / Y**, **Scale**, **Rotation** (−180° to 180°) and **Opacity** sliders.
5. Click **Reset** to make the clip full-frame again.

Without PiP enabled, a V2 clip fills the frame and fully covers V1. Rotation and opacity can only be set in Properties.

**Limit:** audio from clips on V2 and above is muted in both the preview and the export. Put sound you need on an audio track, or keep that clip on V1.

---

## 8. Text overlay

Add a simple text layer over your video.

**Add text:** **Edit → Add Text Overlay** (or use the command palette: **⌘K** / **Ctrl+K**, then search “Add Text Overlay”).

A new overlay appears at the playhead with default text **“Sample text”**, white color, and the **Inter** font.

**Edit text:** Select the overlay (click it in the preview or choose it from the timeline context). In **Properties → Text Overlay**, change:

- Text content
- Position (X / Y)
- Size
- Color
- Duration (how long it stays on screen)

**Move text:** Drag the overlay in the preview window.

Text overlays appear in the preview and are burned into the exported video.

---

## 9. Captions

**Edit → Auto Captions…** creates captions from the timeline's audio, or imports a subtitle file.

### Generate with speech-to-text

1. Open **Settings** (gear icon, top right), pick a provider (**OpenAI**, **Gemini** or **Deepgram**) and paste your API key. Keys are stored only in this browser.
2. Choose **Edit → Auto Captions…** and click **Generate captions**.
3. The audio is extracted and compressed on your machine, split into parts if it's large, and sent only to the provider you chose.

### Import an .srt file

In the same dialog, click **Import .srt…** and pick a subtitle file. No API key is needed. The cue times are read as timeline times, so 00:00:05 in the file shows at 0:05 on the timeline.

Either way, each caption becomes a text overlay along the bottom of the frame. Its size is based on your project's height. You can edit, move or delete each one like any other text overlay.

---

## 10. Export to MP4

When your edit is ready:

1. Click **Export** in the toolbar or choose **File → Export Video…**
2. Review the summary (resolution, duration, estimated size).
3. Click **Start export**.
4. When finished, click **Download** to save `{project name}.mp4`.

**Export format:**

- Container: **MP4**
- Video: **H.264** (yuv420p)
- Audio: **AAC** (192 kbps)

**Requirements:**

- At least one clip on **V1** is required to export.

**Tips:**

- Long projects or large source files need more browser memory. The export dialog warns if the project may be heavy.
- Keep the export tab open until download completes.
- For best performance on large exports, use a browser context with multi-threaded encoding enabled (cross-origin isolated page).

---

## 11. Projects and archives

- **Autosave:** every edit is saved in this browser automatically. The status bar shows when it last saved. Undo history (50 steps) lasts only while the project is open.
- **Switch projects:** click the project name at the top left to rename it, switch to another project or create a new one. Use **File → Open Project…** to see all saved projects.
- **Project settings:** **File → Project Settings…** (see section 1).
- **Archive (.zip):** **File → Save Archive (.zip)** downloads the whole project, including its media, as one file. **File → Open Archive (.zip)…** opens it in any browser, as a new copy. Use this for backups, moving to another computer, or sharing. Projects saved in the browser can be lost if you clear site data, so keep archives of anything important.

---

## Workspace

Drag the borders between the media sidebar, the preview, the Properties panel and the timeline to resize them. Double-click a border to reset it. Sizes are remembered.

---

## Keyboard shortcuts (summary)

| Shortcut | Action |
|----------|--------|
| **?** | Show all shortcuts |
| **Space** | Play / pause |
| **Home / End** | Go to start / end |
| **↑ / ↓** | Previous / next edit point |
| **S** | Split at playhead |
| **⌘J** | Join clips |
| **⌘X** | Cut |
| **⌘G / ⇧⌘G** | Group / ungroup |
| **X** | Mark the selected clips as In/Out (or a range at the playhead) |
| **⇧X** | Clear In/Out |
| **'** / **⇧'** | Delete range (close the gap) / trim to range |
| **T** | Add text overlay at playhead |
| **⌘I / ⌘E** | Import media / export video |
| **Esc** | Clear selection |
| **Q / W** | Trim clip start / end to playhead (**Shift**: ripple) |
| **⌫ / Shift+⌫** | Delete / ripple delete selection |
| **← / →** | Nudge selection, or move playhead 0.1 s when nothing is selected (**Shift**: 10×) |
| **I / O** | Mark in / out |
| **⌘C / ⌘V** | Copy / paste at playhead |
| **⌘A** | Select all clips |
| **⌘Z / ⇧⌘Z** | Undo / redo |
| **= / − / 0** | Zoom in / out / reset |
| **⌘K / Ctrl+K** | Command palette |

Additional commands (undo, ripple delete, etc.) are available from the command palette and **Edit** menu.

---

## Supported workflow (MVP checklist)

| Feature | Supported |
|---------|-----------|
| Fixed-resolution export (e.g. 1080p 16:9 or custom 9:16) | Yes |
| One video track + one audio track (V1 + A1) | Yes |
| Play, pause, and seek | Yes |
| Trim, split, join, move, close gaps | Yes |
| Media library (import, add to timeline, rename, remove unused) | Yes |
| Mute original audio, add secondary audio, volume control | Yes (mute applies fully on export) |
| Speed, fades, clip color, color effects | Yes |
| Picture-in-picture (drag and resize in the preview) | Yes (V2+ audio is muted) |
| Text overlay with default font | Yes |
| Auto captions (speech-to-text) and .srt import | Yes |
| Project archives (.zip with media) | Yes |
| Export to standard MP4 | Yes |

For questions or limits not covered here, check warnings in **Project Settings** and **Export** dialogs before exporting.
