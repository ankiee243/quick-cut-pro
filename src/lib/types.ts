export type AnimationKind = "zoomIn" | "zoomOut" | "panLeft" | "panRight";

export const ANIMATIONS: AnimationKind[] = ["zoomIn", "zoomOut", "panLeft", "panRight"];

export interface Clip {
  id: string;
  mediaKey: string;
  mediaUrl: string;
  startSec: number;
  endSec: number;
  animation: AnimationKind;
  label: string;
}

export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ProjectState {
  id: string;
  name: string;
  audio: { url: string; durationSec: number };
  transcript: { status: string; words: TranscriptWord[] };
  timeline: Clip[];
  defaults: { label: string };
}

export const DEFAULT_LABEL = "© WWE\n© Getty Images";
export const DEFAULT_CLIP_DURATION = 3.5;
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const FPS = 30;

export function pickNextAnimation(prev: AnimationKind | null): AnimationKind {
  const choices = prev ? ANIMATIONS.filter((a) => a !== prev) : ANIMATIONS;
  return choices[Math.floor(Math.random() * choices.length)];
}
