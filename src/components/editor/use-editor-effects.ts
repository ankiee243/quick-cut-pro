import { useEffect, useRef } from "react";
import { useEditor } from "@/lib/editor-store";
import { saveProject } from "@/lib/projects.functions";

const SAVE_DEBOUNCE_MS = 800;

export function useAutoSave(projectId: string) {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const markSaved = useEditor((s) => s.markSaved);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!project || !dirty) return;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await saveProject({
          data: {
            id: projectId,
            timeline: project.timeline,
            defaults: project.defaults,
          },
        });
        markSaved();
      } catch (e) {
        console.error("Autosave failed", e);
      } finally {
        saving.current = false;
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [project, dirty, projectId, markSaved]);
}

export function useKeyboardShortcuts(onImport: () => void) {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable);
      if (isEditing) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "i") {
        e.preventDefault();
        onImport();
      } else if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((meta && e.key.toLowerCase() === "y") || (meta && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, onImport]);
}
