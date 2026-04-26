import { create } from "zustand";
import type { Clip, ProjectState, AnimationKind } from "./types";
import { DEFAULT_CLIP_DURATION, pickNextAnimation } from "./types";

interface Snapshot {
  timeline: Clip[];
  defaultLabel: string;
}

interface EditorStore {
  project: ProjectState | null;
  selectedClipId: string | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;

  setProject: (p: ProjectState) => void;
  selectClip: (id: string | null) => void;

  // Mutations (each pushes history)
  addClips: (clips: Array<Pick<Clip, "mediaKey" | "mediaUrl">>) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  deleteClip: (id: string) => void;
  moveClip: (id: string, newStart: number) => void;
  trimLeft: (id: string, newStart: number) => void;
  trimRight: (id: string, newEnd: number) => void;
  setDefaultLabel: (label: string) => void;

  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

function snapshot(p: ProjectState): Snapshot {
  return {
    timeline: p.timeline.map((c) => ({ ...c })),
    defaultLabel: p.defaults.label,
  };
}

function applySnapshot(p: ProjectState, s: Snapshot): ProjectState {
  return {
    ...p,
    timeline: s.timeline.map((c) => ({ ...c })),
    defaults: { ...p.defaults, label: s.defaultLabel },
  };
}

const MIN_CLIP = 0.2;

export const useEditor = create<EditorStore>((set, get) => ({
  project: null,
  selectedClipId: null,
  past: [],
  future: [],
  dirty: false,

  setProject: (p) => set({ project: p, past: [], future: [], dirty: false }),
  selectClip: (id) => set({ selectedClipId: id }),

  addClips: (newClips) => {
    const p = get().project;
    if (!p) return;
    const past = [...get().past, snapshot(p)];
    let cursor = p.timeline.length ? p.timeline[p.timeline.length - 1].endSec : 0;
    let prevAnim: AnimationKind | null =
      p.timeline.length ? p.timeline[p.timeline.length - 1].animation : null;
    const audioEnd = p.audio.durationSec;
    const additions: Clip[] = [];
    for (const c of newClips) {
      if (cursor >= audioEnd) break;
      const dur = Math.min(DEFAULT_CLIP_DURATION, audioEnd - cursor);
      const anim = pickNextAnimation(prevAnim);
      additions.push({
        id: crypto.randomUUID(),
        mediaKey: c.mediaKey,
        mediaUrl: c.mediaUrl,
        startSec: cursor,
        endSec: cursor + dur,
        animation: anim,
        label: p.defaults.label,
      });
      cursor += dur;
      prevAnim = anim;
    }
    set({
      project: { ...p, timeline: [...p.timeline, ...additions] },
      past,
      future: [],
      dirty: true,
    });
  },

  updateClip: (id, patch) => {
    const p = get().project;
    if (!p) return;
    const past = [...get().past, snapshot(p)];
    set({
      project: {
        ...p,
        timeline: p.timeline.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
      past,
      future: [],
      dirty: true,
    });
  },

  deleteClip: (id) => {
    const p = get().project;
    if (!p) return;
    const past = [...get().past, snapshot(p)];
    const idx = p.timeline.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const removed = p.timeline[idx];
    const dur = removed.endSec - removed.startSec;
    const next = p.timeline
      .filter((c) => c.id !== id)
      .map((c) => (c.startSec >= removed.endSec ? { ...c, startSec: c.startSec - dur, endSec: c.endSec - dur } : c));
    set({
      project: { ...p, timeline: next },
      past,
      future: [],
      dirty: true,
      selectedClipId: get().selectedClipId === id ? null : get().selectedClipId,
    });
  },

  // Reposition by changing start; clamped to [prevEnd, nextStart - duration]
  moveClip: (id, newStart) => {
    const p = get().project;
    if (!p) return;
    const idx = p.timeline.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const clip = p.timeline[idx];
    const dur = clip.endSec - clip.startSec;
    const prevEnd = idx === 0 ? 0 : p.timeline[idx - 1].endSec;
    const nextStart = idx === p.timeline.length - 1 ? p.audio.durationSec : p.timeline[idx + 1].startSec;
    const clamped = Math.max(prevEnd, Math.min(newStart, nextStart - dur));
    if (clamped === clip.startSec) return;
    const past = [...get().past, snapshot(p)];
    set({
      project: {
        ...p,
        timeline: p.timeline.map((c) =>
          c.id === id ? { ...c, startSec: clamped, endSec: clamped + dur } : c,
        ),
      },
      past,
      future: [],
      dirty: true,
    });
  },

  // Trim left edge: changes the boundary between this clip and the previous.
  // Effect: shrink/extend this clip from the left, while previous clip's end follows (no gap).
  trimLeft: (id, newStart) => {
    const p = get().project;
    if (!p) return;
    const idx = p.timeline.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const clip = p.timeline[idx];
    const minBound = idx === 0 ? 0 : p.timeline[idx - 1].startSec + MIN_CLIP;
    const maxBound = clip.endSec - MIN_CLIP;
    const clamped = Math.max(minBound, Math.min(newStart, maxBound));
    if (clamped === clip.startSec) return;
    const past = [...get().past, snapshot(p)];
    const next = p.timeline.map((c, i) => {
      if (i === idx) return { ...c, startSec: clamped };
      if (i === idx - 1) return { ...c, endSec: clamped };
      return c;
    });
    set({ project: { ...p, timeline: next }, past, future: [], dirty: true });
  },

  // Trim right edge: extends/shortens this clip; pushes next clip's start (no gap).
  trimRight: (id, newEnd) => {
    const p = get().project;
    if (!p) return;
    const idx = p.timeline.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const clip = p.timeline[idx];
    const minBound = clip.startSec + MIN_CLIP;
    const maxBound =
      idx === p.timeline.length - 1
        ? p.audio.durationSec
        : p.timeline[idx + 1].endSec - MIN_CLIP;
    const clamped = Math.max(minBound, Math.min(newEnd, maxBound));
    if (clamped === clip.endSec) return;
    const past = [...get().past, snapshot(p)];
    const next = p.timeline.map((c, i) => {
      if (i === idx) return { ...c, endSec: clamped };
      if (i === idx + 1) return { ...c, startSec: clamped };
      return c;
    });
    set({ project: { ...p, timeline: next }, past, future: [], dirty: true });
  },

  setDefaultLabel: (label) => {
    const p = get().project;
    if (!p) return;
    const past = [...get().past, snapshot(p)];
    set({ project: { ...p, defaults: { ...p.defaults, label } }, past, future: [], dirty: true });
  },

  undo: () => {
    const p = get().project;
    if (!p || get().past.length === 0) return;
    const past = [...get().past];
    const prev = past.pop()!;
    set({
      project: applySnapshot(p, prev),
      past,
      future: [snapshot(p), ...get().future],
      dirty: true,
    });
  },

  redo: () => {
    const p = get().project;
    if (!p || get().future.length === 0) return;
    const [next, ...rest] = get().future;
    set({
      project: applySnapshot(p, next),
      past: [...get().past, snapshot(p)],
      future: rest,
      dirty: true,
    });
  },

  markSaved: () => set({ dirty: false }),
}));
