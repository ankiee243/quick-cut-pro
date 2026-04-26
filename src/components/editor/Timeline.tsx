import { useEffect, useRef, useState, memo } from "react";
import { useEditor } from "@/lib/editor-store";
import type { Clip } from "@/lib/types";

const PX_PER_SEC = 60;
const SNAP_PX = 5;
const RULER_HEIGHT = 22;
const TRACK_HEIGHT = 64;

interface Props {
  currentSec: number;
  onSeek: (sec: number) => void;
}

export function Timeline({ currentSec, onSeek }: Props) {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedClipId);
  const selectClip = useEditor((s) => s.selectClip);
  const moveClip = useEditor((s) => s.moveClip);
  const trimLeft = useEditor((s) => s.trimLeft);
  const trimRight = useEditor((s) => s.trimRight);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  if (!project) return null;
  const totalSec = project.audio.durationSec;
  const totalWidth = Math.max(800, totalSec * PX_PER_SEC);

  function handleRulerClick(e: React.MouseEvent) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const sec = Math.max(0, Math.min(totalSec, x / PX_PER_SEC));
    onSeek(sec);
  }

  return (
    <div className="bg-zinc-950 border-t border-zinc-800 select-none flex flex-col h-full">
      <div ref={scrollerRef} className="overflow-x-auto overflow-y-hidden flex-1">
        <div
          ref={trackRef}
          className="relative"
          style={{ width: totalWidth, height: RULER_HEIGHT + TRACK_HEIGHT + 8 }}
          onMouseDown={(e) => {
            // clicking on empty area deselects
            if (e.target === e.currentTarget) selectClip(null);
          }}
        >
          {/* Ruler */}
          <div
            className="absolute top-0 left-0 right-0 bg-zinc-900 border-b border-zinc-800 cursor-pointer"
            style={{ height: RULER_HEIGHT }}
            onClick={handleRulerClick}
          >
            {Array.from({ length: Math.ceil(totalSec) + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-zinc-700 text-[10px] text-zinc-500 pl-1"
                style={{ left: i * PX_PER_SEC }}
              >
                {i}s
              </div>
            ))}
          </div>

          {/* Track */}
          <div
            className="absolute left-0 right-0 bg-zinc-900/40"
            style={{ top: RULER_HEIGHT, height: TRACK_HEIGHT }}
          >
            {project.timeline.map((clip) => (
              <ClipBlock
                key={clip.id}
                clip={clip}
                allClips={project.timeline}
                totalSec={totalSec}
                selected={selectedId === clip.id}
                onSelect={() => selectClip(clip.id)}
                onMove={(s) => moveClip(clip.id, s)}
                onTrimLeft={(s) => trimLeft(clip.id, s)}
                onTrimRight={(e) => trimRight(clip.id, e)}
              />
            ))}
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-20"
            style={{ left: currentSec * PX_PER_SEC }}
          >
            <div className="w-px h-full bg-red-500" />
            <div className="absolute -top-0.5 -left-1 w-2 h-2 bg-red-500 rotate-45" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ClipBlockProps {
  clip: Clip;
  allClips: Clip[];
  totalSec: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (newStart: number) => void;
  onTrimLeft: (newStart: number) => void;
  onTrimRight: (newEnd: number) => void;
}

const ClipBlock = memo(function ClipBlock({
  clip,
  allClips,
  totalSec,
  selected,
  onSelect,
  onMove,
  onTrimLeft,
  onTrimRight,
}: ClipBlockProps) {
  const [drag, setDrag] = useState<
    | null
    | { kind: "move" | "left" | "right"; startX: number; startStart: number; startEnd: number }
  >(null);

  function snap(secValue: number, neighbors: number[]): number {
    const px = secValue * PX_PER_SEC;
    for (const n of neighbors) {
      if (Math.abs(n * PX_PER_SEC - px) <= SNAP_PX) return n;
    }
    return secValue;
  }

  useEffect(() => {
    if (!drag) return;
    const idx = allClips.findIndex((c) => c.id === clip.id);
    const prevEnd = idx > 0 ? allClips[idx - 1].endSec : 0;
    const nextStart = idx < allClips.length - 1 ? allClips[idx + 1].startSec : totalSec;

    function onMouseMove(e: MouseEvent) {
      if (!drag) return;
      const dxPx = e.clientX - drag.startX;
      const dxSec = dxPx / PX_PER_SEC;
      if (drag.kind === "move") {
        const target = drag.startStart + dxSec;
        const snapped = snap(target, [prevEnd, nextStart - (drag.startEnd - drag.startStart)]);
        onMove(snapped);
      } else if (drag.kind === "left") {
        const target = drag.startStart + dxSec;
        const snapped = snap(target, [prevEnd]);
        onTrimLeft(snapped);
      } else if (drag.kind === "right") {
        const target = drag.startEnd + dxSec;
        const snapped = snap(target, [nextStart]);
        onTrimRight(snapped);
      }
    }
    function onMouseUp() {
      setDrag(null);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [drag, allClips, clip.id, totalSec, onMove, onTrimLeft, onTrimRight]);

  const left = clip.startSec * PX_PER_SEC;
  const width = Math.max(8, (clip.endSec - clip.startSec) * PX_PER_SEC);

  return (
    <div
      className={`absolute top-1 bottom-1 rounded overflow-hidden cursor-grab active:cursor-grabbing ${
        selected ? "ring-2 ring-blue-500 z-10" : "ring-1 ring-zinc-700"
      }`}
      style={{
        left,
        width,
        backgroundImage: `url(${clip.mediaUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        // ignore if clicking on edge handles
        const target = e.target as HTMLElement;
        if (target.dataset.handle) return;
        e.stopPropagation();
        onSelect();
        setDrag({
          kind: "move",
          startX: e.clientX,
          startStart: clip.startSec,
          startEnd: clip.endSec,
        });
      }}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute top-1 left-1.5 right-1.5 text-[10px] font-medium text-white truncate drop-shadow whitespace-pre-line leading-tight max-h-8 overflow-hidden">
        {clip.label}
      </div>
      <div className="absolute bottom-1 left-1.5 text-[9px] text-white/80 font-mono">
        {clip.animation} · {(clip.endSec - clip.startSec).toFixed(2)}s
      </div>
      {/* Edge handles */}
      <div
        data-handle="left"
        className="absolute top-0 bottom-0 left-0 w-2 bg-blue-500/60 hover:bg-blue-400 cursor-ew-resize"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onSelect();
          setDrag({
            kind: "left",
            startX: e.clientX,
            startStart: clip.startSec,
            startEnd: clip.endSec,
          });
        }}
      />
      <div
        data-handle="right"
        className="absolute top-0 bottom-0 right-0 w-2 bg-blue-500/60 hover:bg-blue-400 cursor-ew-resize"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onSelect();
          setDrag({
            kind: "right",
            startX: e.clientX,
            startStart: clip.startSec,
            startEnd: clip.endSec,
          });
        }}
      />
    </div>
  );
});
