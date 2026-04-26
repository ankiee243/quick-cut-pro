import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { listProjects, getUploadUrl, createProject, deleteProject } from "@/lib/projects.functions";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "Vertical Video Editor" },
      { name: "description", content: "Compact 9:16 video editor with timeline, animations, transcript, and export." },
    ],
  }),
});

interface ProjectRow {
  id: string;
  name: string;
  durationSec: number;
  updatedAt: string | Date;
}

function HomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list as ProjectRow[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function probeAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => {
        const d = a.duration;
        URL.revokeObjectURL(url);
        if (!isFinite(d) || d <= 0) reject(new Error("Could not read audio duration"));
        else resolve(d);
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read audio file"));
      };
      a.src = url;
    });
  }

  async function handleFile(file: File) {
    setError(null);
    setCreating(true);
    try {
      setProgress("Reading audio…");
      const duration = await probeAudioDuration(file);
      setProgress("Requesting upload URL…");
      const { key, uploadUrl, publicUrl } = await getUploadUrl({
        data: { filename: file.name, contentType: file.type || "audio/mpeg", kind: "audio" },
      });
      setProgress("Uploading audio to R2…");
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "audio/mpeg" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setProgress("Creating project…");
      const { id } = await createProject({
        data: {
          name: file.name.replace(/\.[^.]+$/, "") || "Untitled",
          audioKey: key,
          audioUrl: publicUrl,
          durationSec: duration,
        },
      });
      navigate({ to: "/editor/$projectId", params: { projectId: id } });
    } catch (e) {
      setError(String(e));
      setCreating(false);
      setProgress("");
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this project?")) return;
    await deleteProject({ data: { id } });
    refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">Vertical Video Editor</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Drop a voiceover, add images, animate, export 1080×1920.
          </p>
        </header>

        <section className="mb-10">
          <div
            className="border-2 border-dashed border-zinc-800 hover:border-zinc-600 rounded-lg p-10 text-center transition-colors cursor-pointer bg-zinc-900/40"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {creating ? (
              <div>
                <div className="text-sm text-zinc-300">{progress || "Working…"}</div>
              </div>
            ) : (
              <div>
                <div className="text-base font-medium">Drop voiceover audio</div>
                <div className="text-xs text-zinc-500 mt-1">or click to browse · MP3, WAV, M4A</div>
              </div>
            )}
          </div>
          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
        </section>

        <section>
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Projects</h2>
          {loading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-zinc-500">No projects yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-900 border border-zinc-900 rounded-md overflow-hidden">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/50">
                  <Link
                    to="/editor/$projectId"
                    params={{ projectId: p.id }}
                    className="flex-1 min-w-0"
                  >
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-zinc-500">
                      {p.durationSec.toFixed(1)}s · {new Date(p.updatedAt).toLocaleString()}
                    </div>
                  </Link>
                  <button
                    onClick={() => onDelete(p.id)}
                    className="text-xs text-zinc-500 hover:text-red-400 ml-3"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
