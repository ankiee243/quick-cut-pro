import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { getProject, getUploadUrl, refreshTranscript } from "@/lib/projects.functions";
import { submitRender, getRenderJob } from "@/lib/render.functions";
import { useEditor } from "@/lib/editor-store";
import { VideoComposition } from "@/lib/composition";
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/lib/types";
import { Timeline } from "@/components/editor/Timeline";
import { TranscriptStrip } from "@/components/editor/TranscriptStrip";
import { ClipPanel } from "@/components/editor/ClipPanel";
import { useAutoSave, useKeyboardShortcuts } from "@/components/editor/use-editor-effects";

export const Route = createFileRoute("/editor/$projectId")({
  component: EditorPage,
  loader: async ({ params }) => {
    const data = await getProject({ data: { id: params.projectId } });
    return data;
  },
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="text-center">
          <p className="text-sm text-red-400 mb-3">Failed to load project: {error.message}</p>
          <button
            onClick={() => router.invalidate()}
            className="text-xs px-3 py-1.5 bg-zinc-800 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 text-sm">
      Project not found.{" "}
      <Link to="/" className="underline ml-1">
        Home
      </Link>
    </div>
  ),
});

const LABEL_PRESETS = {
  wwe: "© WWE\n© Getty Images",
  aew: "© AEW\n© Getty Images",
};

function EditorPage() {
  const data = Route.useLoaderData();
  const projectId = data.id;

  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);
  const addClips = useEditor((s) => s.addClips);
  const setDefaultLabel = useEditor((s) => s.setDefaultLabel);
  const dirty = useEditor((s) => s.dirty);

  const playerRef = useRef<PlayerRef>(null);
  const [currentSec, setCurrentSec] = useState(0);
  const [labelMode, setLabelMode] = useState<"wwe" | "aew" | "custom">("wwe");
  const [customLabel, setCustomLabel] = useState(LABEL_PRESETS.wwe);
  const importInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [renderJob, setRenderJob] = useState<{ id: string; status: string; outputUrl?: string; error?: string } | null>(null);

  // Initialize store from loader data
  useEffect(() => {
    setProject({
      id: data.id,
      name: data.name,
      audio: data.audio,
      transcript: data.transcript,
      timeline: data.timeline,
      defaults: data.defaults,
    });
  }, [data, setProject]);

  // Sync custom label initial
  useEffect(() => {
    if (data.defaults.label === LABEL_PRESETS.wwe) {
      setLabelMode("wwe");
    } else if (data.defaults.label === LABEL_PRESETS.aew) {
      setLabelMode("aew");
    } else {
      setLabelMode("custom");
      setCustomLabel(data.defaults.label);
    }
  }, [data.defaults.label]);

  // Poll transcript while processing
  useEffect(() => {
    if (!project) return;
    if (project.transcript.status === "completed" || project.transcript.status === "failed") return;
    const interval = setInterval(async () => {
      try {
        const t = await refreshTranscript({ data: { id: projectId } });
        if (t.status === "completed" || t.status === "failed") {
          setProject({ ...project, transcript: t });
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [project, projectId, setProject]);

  // Player frame -> currentSec
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      setCurrentSec(e.detail.frame / FPS);
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [project?.timeline.length]);

  function seekTo(sec: number) {
    const p = playerRef.current;
    if (!p || !project) return;
    const frame = Math.max(0, Math.min(Math.round(sec * FPS), Math.round(project.audio.durationSec * FPS) - 1));
    p.seekTo(frame);
    setCurrentSec(frame / FPS);
  }

  async function handleImportFiles(files: FileList | null) {
    if (!files || !project) return;
    const arr = Array.from(files);
    // Upload sequentially to preserve order
    const uploaded: { mediaKey: string; mediaUrl: string }[] = [];
    for (const f of arr) {
      try {
        const { key, uploadUrl, publicUrl } = await getUploadUrl({
          data: { filename: f.name, contentType: f.type || "image/jpeg", kind: "image" },
        });
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": f.type || "image/jpeg" },
          body: f,
        });
        if (put.ok) uploaded.push({ mediaKey: key, mediaUrl: publicUrl });
      } catch (e) {
        console.error("upload failed", e);
      }
    }
    if (uploaded.length) addClips(uploaded);
  }

  function openImport() {
    importInput.current?.click();
  }

  useAutoSave(projectId);
  useKeyboardShortcuts(openImport);

  function applyLabelMode(mode: "wwe" | "aew" | "custom") {
    setLabelMode(mode);
    if (mode === "wwe") setDefaultLabel(LABEL_PRESETS.wwe);
    else if (mode === "aew") setDefaultLabel(LABEL_PRESETS.aew);
    else setDefaultLabel(customLabel);
  }

  async function handleExport() {
    if (!project) return;
    setExporting(true);
    try {
      const res = await submitRender({ data: { projectId } });
      setRenderJob({ id: res.jobId, status: res.queued ? "rendering" : "failed", error: res.error });
      if (res.queued) {
        const poll = setInterval(async () => {
          try {
            const job = await getRenderJob({ data: { jobId: res.jobId } });
            setRenderJob(job);
            if (job.status === "completed" || job.status === "failed") clearInterval(poll);
          } catch (e) {
            console.error(e);
          }
        }, 3000);
      }
    } catch (e) {
      setRenderJob({ id: "", status: "failed", error: String(e) });
    } finally {
      setExporting(false);
    }
  }

  const compProps = useMemo(
    () => ({
      clips: project?.timeline ?? [],
      audioUrl: project?.audio.url ?? "",
    }),
    [project?.timeline, project?.audio.url],
  );

  if (!project) {
    return <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center text-sm">Loading…</div>;
  }

  const totalFrames = Math.max(1, Math.round(project.audio.durationSec * FPS));

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-xs text-zinc-400 hover:text-zinc-100">
            ← Projects
          </Link>
          <div className="text-sm font-medium">{project.name}</div>
          <div className="text-[10px] text-zinc-500">
            {project.audio.durationSec.toFixed(2)}s · {project.timeline.length} clip{project.timeline.length === 1 ? "" : "s"}
          </div>
          <div className="text-[10px] text-zinc-500">{dirty ? "● Saving…" : "Saved"}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Label</span>
          <select
            value={labelMode}
            onChange={(e) => applyLabelMode(e.target.value as "wwe" | "aew" | "custom")}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"
          >
            <option value="wwe">© WWE preset</option>
            <option value="aew">© AEW preset</option>
            <option value="custom">© Custom</option>
          </select>
          {labelMode === "custom" && (
            <input
              value={customLabel}
              onChange={(e) => {
                setCustomLabel(e.target.value);
                setDefaultLabel(e.target.value);
              }}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs w-44"
              placeholder="Custom label"
            />
          )}
          <input
            ref={importInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleImportFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={openImport}
            className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded"
            title="Ctrl+I"
          >
            Import images
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || project.timeline.length === 0}
            className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded font-medium"
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      {renderJob && (
        <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] flex items-center gap-3 bg-zinc-900/50 flex-shrink-0">
          <span className="text-zinc-400">Render:</span>
          <span
            className={
              renderJob.status === "completed"
                ? "text-green-400"
                : renderJob.status === "failed"
                  ? "text-red-400"
                  : "text-yellow-400"
            }
          >
            {renderJob.status}
          </span>
          {renderJob.outputUrl && (
            <a href={renderJob.outputUrl} target="_blank" rel="noreferrer" className="underline text-blue-400">
              Download MP4
            </a>
          )}
          {renderJob.error && <span className="text-red-400 truncate">{renderJob.error}</span>}
          <button
            onClick={() => setRenderJob(null)}
            className="ml-auto text-zinc-500 hover:text-zinc-300"
          >
            ×
          </button>
        </div>
      )}

      {/* Main: preview | side */}
      <div className="flex-1 flex min-h-0">
        {/* Preview */}
        <div className="flex-1 flex items-center justify-center bg-black p-3 min-w-0">
          <div className="h-full aspect-[9/16] max-w-full bg-zinc-950 border border-zinc-800">
            <Player
              ref={playerRef}
              component={VideoComposition}
              compositionWidth={VIDEO_WIDTH}
              compositionHeight={VIDEO_HEIGHT}
              fps={FPS}
              durationInFrames={totalFrames}
              inputProps={compProps}
              controls
              loop={false}
              style={{ width: "100%", height: "100%" }}
              acknowledgeRemotionLicense
            />
          </div>
        </div>

        {/* Right side: transcript + clip panel */}
        <aside className="w-[320px] flex-shrink-0 border-l border-zinc-800 bg-zinc-900/40 flex flex-col min-h-0">
          <div className="border-b border-zinc-800 flex flex-col" style={{ flex: "1 1 50%", minHeight: 0 }}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
              Transcript
            </div>
            <div className="flex-1 min-h-0">
              <TranscriptStrip currentSec={currentSec} onSeek={seekTo} />
            </div>
          </div>
          <div className="flex flex-col" style={{ flex: "1 1 50%", minHeight: 0 }}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
              Clip
            </div>
            <div className="flex-1 overflow-y-auto">
              <ClipPanel />
            </div>
          </div>
        </aside>
      </div>

      {/* Timeline */}
      <div className="h-[120px] flex-shrink-0">
        <Timeline currentSec={currentSec} onSeek={seekTo} />
      </div>
    </div>
  );
}
