import { useMemo } from "react";
import { useEditor } from "@/lib/editor-store";

interface Props {
  currentSec: number;
  onSeek: (sec: number) => void;
}

export function TranscriptStrip({ currentSec, onSeek }: Props) {
  const project = useEditor((s) => s.project);
  const words = project?.transcript?.words ?? [];
  const status = project?.transcript?.status;

  const currentMs = currentSec * 1000;
  const activeIdx = useMemo(() => {
    if (!words.length) return -1;
    // binary search for the word covering currentMs
    let lo = 0;
    let hi = words.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].startMs <= currentMs) {
        last = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return last;
  }, [words, currentMs]);

  if (status === "pending" || status === "processing") {
    return (
      <div className="text-xs text-zinc-500 italic px-2 py-2">Transcribing audio…</div>
    );
  }
  if (status === "failed") {
    return <div className="text-xs text-red-400 px-2 py-2">Transcription failed.</div>;
  }
  if (!words.length) {
    return <div className="text-xs text-zinc-500 px-2 py-2">No transcript.</div>;
  }

  return (
    <div className="text-[13px] leading-snug overflow-y-auto h-full px-2 py-2">
      {words.map((w, i) => {
        const isPast = i < activeIdx;
        const isActive = i === activeIdx;
        return (
          <span
            key={i}
            onClick={() => onSeek(w.startMs / 1000)}
            className={`cursor-pointer hover:underline ${
              isActive ? "bg-yellow-400 text-black px-0.5 rounded" : isPast ? "text-zinc-100" : "text-zinc-500"
            }`}
          >
            {w.text}{" "}
          </span>
        );
      })}
    </div>
  );
}
