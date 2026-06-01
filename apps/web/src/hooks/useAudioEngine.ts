import { useEffect } from 'react';
import {
  ensureAudioGraph,
  getAnalyser,
  resumeAudioGraph,
} from '../lib/audioGraph';
import { clipRate } from '../lib/clipRate';
import { fadeEnvelope } from '../lib/fadeEnvelope';
import { isTrackAudible } from '../lib/trackAudibility';
import { useTimelineStore } from '../store/useTimelineStore';
import type { AudioClip, ClipId, TrackId } from '../types/timeline';

/**
 * Plays back A1 (audio-track) clips via the Web Audio graph.
 *
 * Each audio clip mounts an HTMLAudioElement piped through a
 * MediaElementAudioSourceNode → GainNode → destination. The
 * `GainNode` lets us apply per-clip `volume` and (later) automate
 * fades; the `HTMLAudioElement` handles decoding and seeking.
 *
 * Why not pre-decode via decodeAudioData + AudioBufferSourceNode?
 * Audio clips can be long (whole tracks); pre-decoding everything
 * would balloon memory. MediaElementSource streams from the decoded
 * pipeline natively, with no copy.
 *
 * Note: V1 video clips' audio is handled by the `<video>` element in
 * Preview. This engine handles A1 *only* — never V1 — so users can
 * sidechain dialogue, music, etc., independently from picture audio.
 *
 * Lifecycle:
 *  - On every store change touching project / playhead / playing,
 *    `sync()` walks the A1 clips, mounts new ones, unmounts removed
 *    ones, updates gain, and aligns currentTime + play/pause to the
 *    timeline playhead.
 *  - On unmount, everything is torn down and the AudioContext is
 *    closed.
 */
export function useAudioEngine(): void {
  useEffect(() => {
    type Entry = {
      audio: HTMLAudioElement;
      source: MediaElementAudioSourceNode;
      gain: GainNode;
      url: string;
      lastVolume: number;
    };

    const graph = ensureAudioGraph();
    // Web Audio unavailable — bail out, preview still works via
    // the native <video> element's audio path.
    if (!graph) return;
    const { ctx } = graph;
    const entries = new Map<ClipId, Entry>();

    const resume = () => resumeAudioGraph();
    // Browser autoplay policies require a user gesture before audio
    // can sound. Hooking these once lets us resume the context on the
    // user's first interaction with the editor.
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);

    const sync = () => {
      const state = useTimelineStore.getState();
      const project = state.currentProject;

      // Map clip → its track, so we can check mute/solo when
      // computing each clip's effective gain.
      const clips: AudioClip[] = [];
      const clipTrack = new Map<ClipId, TrackId>();
      const mutedTrackIds = new Set<TrackId>();
      if (project) {
        for (const track of project.tracks) {
          if (track.type !== 'audio') continue;
          if (!isTrackAudible(track, project.tracks)) {
            mutedTrackIds.add(track.id);
          }
          for (const c of track.clips) {
            if (c.kind === 'audio') {
              clips.push(c);
              clipTrack.set(c.id, track.id);
            }
          }
        }
      }

      const activeIds = new Set(clips.map((c) => c.id));
      for (const [id, ent] of entries) {
        if (!activeIds.has(id)) tearDown(ent, ctx);
        if (!activeIds.has(id)) entries.delete(id);
      }

      const playhead = state.playheadPosition;
      const isPlaying = state.isPlaying;

      for (const clip of clips) {
        let ent = entries.get(clip.id);
        if (!ent) {
          ent = mountClip(clip, ctx);
          entries.set(clip.id, ent);
        }

        const clipEnd = clip.startOffset + clip.duration;
        const inRange = playhead >= clip.startOffset && playhead < clipEnd;

        // Effective gain folds the user-set `volume` with the fade
        // envelope and the track-level mute/solo, so what the user
        // hears in preview matches what export will produce.
        const trackId = clipTrack.get(clip.id);
        const audible = trackId ? !mutedTrackIds.has(trackId) : true;
        const targetGain =
          inRange && audible ? clip.volume * fadeEnvelope(clip, playhead) : 0;
        if (ent.lastVolume !== targetGain) {
          ent.gain.gain.setValueAtTime(targetGain, ctx.currentTime);
          ent.lastVolume = targetGain;
        }

        if (inRange) {
          const rate = clipRate(clip);
          const target =
            clip.trimStart + (playhead - clip.startOffset) * rate;
          // Match the Preview's seek heuristic — small deltas during
          // playback are handled by the element's own clock and seeking
          // every frame causes audible glitches.
          if (Math.abs(ent.audio.currentTime - target) > 0.1) {
            ent.audio.currentTime = target;
          }
          if (ent.audio.playbackRate !== rate) {
            ent.audio.playbackRate = rate;
          }
          if (isPlaying && ent.audio.paused) {
            void ent.audio.play().catch(() => undefined);
          } else if (!isPlaying && !ent.audio.paused) {
            ent.audio.pause();
          }
        } else if (!ent.audio.paused) {
          ent.audio.pause();
        }
      }
    };

    const unsubs = [
      useTimelineStore.subscribe((s) => s.playheadPosition, sync),
      useTimelineStore.subscribe((s) => s.isPlaying, sync),
      useTimelineStore.subscribe((s) => s.currentProject, sync),
    ];
    sync();

    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      unsubs.forEach((u) => u());
      for (const ent of entries.values()) tearDown(ent, ctx);
      entries.clear();
      // We do NOT close the AudioContext — it's shared with the
      // Preview pane (for the V1 video element route) and the
      // AudioMeter, and the page-lifetime singleton owns it.
    };
  }, []);
}

function mountClip(
  clip: AudioClip,
  ctx: AudioContext,
): {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  url: string;
  lastVolume: number;
} {
  const url = URL.createObjectURL(clip.file);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;

  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.value = clip.volume;
  // Route through the master analyser (owned by audioGraph) so the
  // meter sees this clip. The analyser is already wired to
  // ctx.destination, so playback works.
  const analyser = getAnalyser() ?? ctx.destination;
  source.connect(gain).connect(analyser);
  return { audio, source, gain, url, lastVolume: clip.volume };
}

function tearDown(
  ent: {
    audio: HTMLAudioElement;
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    url: string;
  },
  _ctx: AudioContext,
): void {
  ent.audio.pause();
  try {
    ent.source.disconnect();
  } catch {
    // Already disconnected — ignore.
  }
  try {
    ent.gain.disconnect();
  } catch {
    // Already disconnected — ignore.
  }
  URL.revokeObjectURL(ent.url);
}
