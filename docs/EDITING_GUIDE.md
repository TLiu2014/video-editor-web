# Editing Guide

This guide describes the editing features supported in the web video editor. Use it as a reference for what you can do today and how to do it.

## Quick start

1. Create or open a project.
2. Import a video with **File → Import Media…**
3. Edit on the timeline and preview your changes.
4. Export with **File → Export Video…** or the **Export** button in the toolbar.

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

**Import media:** **File → Import Media…**

- Video files go to **V1**.
- Audio files go to **A1**.

Clips appear on the timeline with thumbnails (video) or waveforms (audio). Drag clips to move them; use the trim handles on clip edges to shorten them.

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

## 4. Cutting tools (trim and split)

### Trim (adjust clip ends)

- Hover near the **left or right edge** of a clip on the timeline.
- Drag the trim handle to shorten or extend the visible portion of the clip.
- Hold **Shift** while trimming to ripple-edit (following clips shift with the edit).

The **Properties** panel shows read-only **In** and **Out** times for the selected clip.

### Split (cut in the middle)

1. Move the playhead to where you want to cut.
2. Click **Split** in the transport bar, or use **Edit → Split at Playhead**, or press **S**.

The clip is divided into two clips at the playhead. Split works on the selected clip, or on all clips under the playhead when nothing is selected.

---

## 5. Audio control

### Mute original clip audio

You can remove embedded audio from video clips in the exported file:

- **Track mute:** Click **M** on **V1** to mute all audio from that video track in the export.
- **Per clip:** Select a video clip. In **Properties**, turn off **Has audio** (labeled “Mixed into export” / “Treated as silent”).

**Preview note:** The preview may still play embedded video audio even when mute is set. The exported MP4 reflects your mute settings.

### Add secondary audio

Import an audio file with **File → Import Media…**. It is placed on **A1**. You can place multiple audio clips on the timeline and move them like video clips.

### Volume slider

Select an **audio clip** on **A1**. In **Properties**, use the **Volume** slider (0–150%). Click the speaker icon to mute or unmute that clip.

Volume changes apply in both preview (for A1 clips) and export.

---

## 6. Text overlay

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

## 7. Export to MP4

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

## Keyboard shortcuts (summary)

| Shortcut | Action |
|----------|--------|
| **Space** | Play / pause |
| **S** | Split at playhead |
| **← / →** | Nudge playhead (0.1 s) |
| **⌘K / Ctrl+K** | Command palette |

Additional commands (undo, ripple delete, etc.) are available from the command palette and **Edit** menu.

---

## Supported workflow (MVP checklist)

| Feature | Supported |
|---------|-----------|
| Fixed-resolution export (e.g. 1080p 16:9 or custom 9:16) | Yes |
| One video track + one audio track (V1 + A1) | Yes |
| Play, pause, and seek | Yes |
| Trim and split | Yes |
| Mute original audio, add secondary audio, volume control | Yes (mute applies fully on export) |
| Text overlay with default font | Yes |
| Export to standard MP4 | Yes |

For questions or limits not covered here, check warnings in **Project Settings** and **Export** dialogs before exporting.
