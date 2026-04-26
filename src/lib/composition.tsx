import { AbsoluteFill, Audio, Img, Sequence, useCurrentFrame, interpolate } from "remotion";
import type { Clip, AnimationKind } from "./types";
import { FPS } from "./types";

interface CompProps {
  clips: Clip[];
  audioUrl: string;
}

function transformFor(anim: AnimationKind, progress: number): string {
  // progress 0..1 across the clip's duration
  switch (anim) {
    case "zoomIn":
      return `scale(${interpolate(progress, [0, 1], [1.0, 1.2])})`;
    case "zoomOut":
      return `scale(${interpolate(progress, [0, 1], [1.2, 1.0])})`;
    case "panLeft":
      return `scale(1.15) translateX(${interpolate(progress, [0, 1], [40, -40])}px)`;
    case "panRight":
      return `scale(1.15) translateX(${interpolate(progress, [0, 1], [-40, 40])}px)`;
  }
}

function ClipLayer({ clip }: { clip: Clip }) {
  const frame = useCurrentFrame();
  const durFrames = Math.max(1, Math.round((clip.endSec - clip.startSec) * FPS));
  const progress = Math.max(0, Math.min(1, frame / durFrames));
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: transformFor(clip.animation, progress),
          transformOrigin: "center",
          willChange: "transform",
        }}
      >
        <Img
          src={clip.mediaUrl}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      {clip.label && (
        <div
          style={{
            position: "absolute",
            top: 32,
            left: 32,
            color: "white",
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1.15,
            whiteSpace: "pre-line",
            textShadow: "0 2px 8px rgba(0,0,0,0.7)",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {clip.label}
        </div>
      )}
    </AbsoluteFill>
  );
}

export function VideoComposition({ clips, audioUrl }: CompProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {audioUrl && <Audio src={audioUrl} />}
      {clips.map((clip) => {
        const fromFrame = Math.round(clip.startSec * FPS);
        const durFrames = Math.max(1, Math.round((clip.endSec - clip.startSec) * FPS));
        return (
          <Sequence key={clip.id} from={fromFrame} durationInFrames={durFrames}>
            <ClipLayer clip={clip} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
