# Vertical Video Editor — Build Plan

A dense, Premiere-style web editor for 9:16 videos. Voiceover drives duration; images become animated clips on a horizontal timeline; AssemblyAI transcript scrubs in sync; Remotion renders the final MP4 server-side.

## Stack

- **Frontend**: TanStack Start + React, Tailwind. Remotion `@remotion/player` for preview.
- **State**: Zustand (timeline + history) for minimal re-renders. Per-clip memoization.
- **Backend**: TanStack server functions + server routes on the Worker runtime.
- **DB**: MongoDB Atlas (projects + clips + transcript JSON).
- **Storage**: Cloudflare R2 via S3-compatible SDK. Presigned PUT uploads from browser.
- **Transcription**: AssemblyAI with word-level timestamps.
- **Render**: Remotion server-side render. Because the Worker can't run native binaries, renders execute in a separate render service (small Node container) — see "Render service" below.

## Secrets needed

`MONGODB_URI`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, `ASSEMBLYAI_API_KEY`, `RENDER_SERVICE_URL`, `RENDER_SERVICE_TOKEN`.

## Data model (MongoDB)

```
projects
  _id, name, createdAt, updatedAt
  audio: { r2Key, url, durationSec }
  transcript: { status, words: [{ text, startMs, endMs }] }
  timeline: [
    { id, mediaKey, mediaUrl, startSec, endSec,
      animation: 'zoomIn'|'zoomOut'|'panLeft'|'panRight',
      label: string }
  ]
  defaults: { label, animationCycle }
```

## Screens & UX

**Project list / new project** (minimal): drop voiceover → creates project, uploads to R2, kicks off transcription, redirects to editor.

**Editor layout** (single screen, dense, desktop-only):

```text
┌─────────────────────────────────────────────────────────────┐
│ Top bar: project name · label dropdown · Export ▸           │
├──────────────┬──────────────────────────────────────────────┤
│              │ Transcript strip (scrolling, words highlight)│
│   Preview    ├──────────────────────────────────────────────┤
│   9:16       │ Side panel (when clip selected):             │
│   Player     │   animation · replace media · delete         │
│              │   editable label                             │
├──────────────┴──────────────────────────────────────────────┤
│ Timeline ruler (seconds)                                     │
│ ▓▓▓▓ clip ▓▓▓▓│▓▓ clip ▓▓│▓▓▓▓▓ clip ▓▓▓▓▓│ … audio waveform│
│ Playhead, zoom, scroll                                       │
└──────────────────────────────────────────────────────────────┘
```

## Timeline behavior

- Time-based model: each clip stores `startSec` and `endSec`. Pixels = `sec * pxPerSec`.
- **Drag body**: moves clip; clamped between previous clip's end and next clip's start. Snaps to neighbors within 4px.
- **Left edge**: trims start (changes `startSec`, also slides earlier neighbor or resizes self — per spec "no gaps", left edge equals previous clip's `endSec`, so dragging the left edge effectively moves the boundary between this clip and the previous one).
- **Right edge**: extends/shortens; pushes next clip if overlap, or stops at next clip start.
- **No gaps invariant**: every clip starts exactly where the previous ends; first clip starts at 0; last clip's end may be ≤ audio duration. Inserts auto-fill from the previous clip's end.
- **No overlap invariant**: enforced at every mutation.
- New clips append from the last clip's `endSec` at 3.5s default each.

## Animation system

- One animation per clip: `zoomIn`, `zoomOut`, `panLeft`, `panRight`.
- Driven by Remotion `interpolate(frame, [0, durationFrames], [from, to])` so longer clip = slower motion automatically.
- When auto-assigning on import: pick from the four, but never the same as the previous clip's animation. User can change in side panel.

## Media import

- Multi-select images. Order preserved (use `getAsFileSystemHandle`/file input order).
- Each becomes a clip of 3.5s, appended sequentially after the last clip.
- Current label dropdown value is applied to all imported clips.
- **Ctrl+I** opens the file picker.
- Upload: request presigned PUT → upload to R2 directly from browser → POST clip metadata to server.

## Replace media

- Side panel "Replace media" → file picker → upload → swap `mediaKey`/`mediaUrl` on the selected clip; keep `startSec`, `endSec`, `animation`. Update `label` to current dropdown value.

## Label system

- Dropdown options:
  - **©WWE** preset → `© WWE`
  - **©AEW** preset → `© AEW`
  - **©Custom** → free-text input appears
- Default label: `© WWE\n© Getty Images`.
- Each clip stores its own label; editable inline in the side panel and rendered top-left in the preview composition.

## Transcript

- After audio upload, server function calls AssemblyAI with `word_boost`/word-level timestamps enabled, polls until done, stores `words[]` in MongoDB.
- Transcript bar at top renders all words. As the player time advances, words with `endMs <= currentMs` get a "spoken" class (highlighted), the current word gets an "active" class. Click a word to seek.

## Playback

- `@remotion/player` with the composition built from the timeline + audio.
- Player exposes a frame callback → drives transcript highlight + timeline playhead.

## Export

- Top-right Export button → POST `/api/render` with project ID.
- Server function authenticates, snapshots the project doc, forwards it to the **render service** with a job ID.
- Render service (separate Node host running `@remotion/renderer`) downloads media from R2, renders MP4, uploads result to R2, calls back a webhook (`/api/public/render-callback` with HMAC) updating job status.
- UI polls job status and reveals download link.

## Undo / Redo

- Zustand store with a `past[]` / `present` / `future[]` history. Every mutation that changes the timeline pushes to `past`. **Ctrl+Z / Ctrl+Shift+Z**. Drag operations commit one entry on drag-end.

## Auto-save

- Debounced (800 ms) write of `timeline` + `defaults` to MongoDB via server function. Save indicator in top bar (saved / saving / error).

## Performance notes

- Clips rendered as memoized components keyed by id.
- Drag uses `requestAnimationFrame` and updates only the dragged clip's transient style; commits to store on drag-end.
- Player uses Remotion's lazy frame rendering; images preloaded.
- Transcript word list virtualized if > 500 words.

## Routes

- `/` — project list, new project (drop audio).
- `/editor/$projectId` — main editor.
- Server: `/api/upload-url` (presigned), `/api/projects/$id` (CRUD), `/api/transcribe/$id`, `/api/render`, `/api/render/$jobId`, `/api/public/render-callback`.

## Build order

1. Secrets + Mongo client + R2 client wrappers.
2. Project create flow (audio upload, duration probe, doc insert).
3. Editor shell (preview + empty timeline + transcript placeholder).
4. AssemblyAI transcription + transcript bar with highlight.
5. Image import + clip model + Remotion composition with animations.
6. Timeline interactions (drag/trim/snap/no-gap/no-overlap).
7. Side panel (animation, replace media, delete, label).
8. Label dropdown + custom + per-clip editing.
9. Undo/redo + autosave + Ctrl+I.
10. Render service integration + export UI.

## Out of scope (for v1)

- Mobile/touch.
- Audio editing or multi-track audio.
- Transitions between clips.
- Text overlays beyond the corner label.

After approval I'll request the secrets (Mongo URI, R2 keys, AssemblyAI key, render service URL) and start with the project bootstrap + editor shell.