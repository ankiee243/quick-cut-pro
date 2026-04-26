import { useRef } from "react";
import { useEditor } from "@/lib/editor-store";
import type { AnimationKind } from "@/lib/types";
import { ANIMATIONS } from "@/lib/types";
import { getUploadUrl } from "@/lib/projects.functions";

const ANIM_LABELS: Record<AnimationKind, string> = {
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
  panLeft: "Pan Left",
  panRight: "Pan Right",
};

export function ClipPanel() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedClipId);
  const updateClip = useEditor((s) => s.updateClip);
  const deleteClip = useEditor((s) => s.deleteClip);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!project || !selectedId) {
    return (
      <div className="text-xs text-zinc-500 px-3 py-3">Select a clip to edit.</div>
    );
  }
  const clip = project.timeline.find((c) => c.id === selectedId);
  if (!clip) return null;

  async function onReplaceFile(file: File) {
    const { key, uploadUrl, publicUrl } = await getUploadUrl({
      data: { filename: file.name, contentType: file.type || "image/jpeg", kind: "image" },
    });
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "image/jpeg" },
      body: file,
    });
    if (!put.ok) {
      alert("Upload failed");
      return;
    }
    updateClip(selectedId!, {
      mediaKey: key,
      mediaUrl: publicUrl,
      label: project!.defaults.label, // refresh label from current dropdown
    });
  }

  return (
    <div className="px-3 py-3 space-y-3 text-xs">
      <div>
        <div className="text-zinc-500 mb-1 text-[10px] uppercase tracking-wider">Animation</div>
        <select
          value={clip.animation}
          onChange={(e) => updateClip(clip.id, { animation: e.target.value as AnimationKind })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
        >
          {ANIMATIONS.map((a) => (
            <option key={a} value={a}>
              {ANIM_LABELS[a]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-zinc-500 mb-1 text-[10px] uppercase tracking-wider">Label</div>
        <textarea
          value={clip.label}
          onChange={(e) => updateClip(clip.id, { label: e.target.value })}
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono resize-none"
        />
      </div>

      <div>
        <div className="text-zinc-500 mb-1 text-[10px] uppercase tracking-wider">Timing</div>
        <div className="font-mono text-[11px] text-zinc-400">
          {clip.startSec.toFixed(2)}s → {clip.endSec.toFixed(2)}s
          <span className="text-zinc-600"> ({(clip.endSec - clip.startSec).toFixed(2)}s)</span>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onReplaceFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1.5 text-xs"
        >
          Replace media
        </button>
        <button
          onClick={() => deleteClip(clip.id)}
          className="flex-1 bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-300 rounded px-2 py-1.5 text-xs"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
