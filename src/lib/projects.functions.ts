import { createServerFn } from "@tanstack/react-start";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { projectsCol, type ProjectDoc } from "../server/mongo.server";
import { presignUpload, publicUrl } from "../server/r2.server";
import { startTranscript, pollTranscript } from "../server/assemblyai.server";
import { DEFAULT_LABEL } from "./types";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

// 1) Get presigned upload URL
export const getUploadUrl = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      kind: z.enum(["audio", "image"]),
    }),
  )
  .handler(async ({ data }) => {
    const id = crypto.randomUUID();
    const key = `${data.kind}/${id}-${safeName(data.filename)}`;
    const url = await presignUpload(key, data.contentType);
    return { key, uploadUrl: url, publicUrl: publicUrl(key) };
  });

// 2) Create project after audio uploaded
export const createProject = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(120),
      audioKey: z.string().min(1).max(255),
      audioUrl: z.string().url(),
      durationSec: z.number().min(0.1).max(60 * 60),
    }),
  )
  .handler(async ({ data }) => {
    const col = await projectsCol();
    const now = new Date();
    const doc: ProjectDoc = {
      name: data.name,
      createdAt: now,
      updatedAt: now,
      audio: { r2Key: data.audioKey, url: data.audioUrl, durationSec: data.durationSec },
      transcript: { status: "pending", words: [] },
      timeline: [],
      defaults: { label: DEFAULT_LABEL },
    };
    const res = await col.insertOne(doc);
    // Kick off transcription (fire and forget; client can poll)
    try {
      const aaiId = await startTranscript(data.audioUrl);
      await col.updateOne(
        { _id: res.insertedId },
        { $set: { "transcript.status": "processing", "transcript.aaiId": aaiId as unknown as never } },
      );
    } catch (err) {
      await col.updateOne(
        { _id: res.insertedId },
        { $set: { "transcript.status": "failed", "transcript.error": String(err) } },
      );
    }
    return { id: res.insertedId.toString() };
  });

// 3) List projects
export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const col = await projectsCol();
  const docs = await col
    .find({}, { projection: { name: 1, createdAt: 1, updatedAt: 1, "audio.durationSec": 1 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();
  return docs.map((d) => ({
    id: d._id!.toString(),
    name: d.name,
    durationSec: d.audio?.durationSec ?? 0,
    updatedAt: d.updatedAt,
  }));
});

// 4) Load full project
export const getProject = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }))
  .handler(async ({ data }) => {
    const col = await projectsCol();
    const doc = await col.findOne({ _id: new ObjectId(data.id) });
    if (!doc) throw new Error("Project not found");
    return {
      id: doc._id!.toString(),
      name: doc.name,
      audio: { url: doc.audio.url, durationSec: doc.audio.durationSec },
      transcript: doc.transcript,
      timeline: doc.timeline,
      defaults: doc.defaults,
    };
  });

// 5) Save timeline (debounced from client)
const ClipSchema = z.object({
  id: z.string().min(1).max(64),
  mediaKey: z.string().min(1).max(255),
  mediaUrl: z.string().url(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  animation: z.enum(["zoomIn", "zoomOut", "panLeft", "panRight"]),
  label: z.string().max(500),
});

export const saveProject = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string().regex(/^[0-9a-f]{24}$/),
      timeline: z.array(ClipSchema).max(500),
      defaults: z.object({ label: z.string().max(500) }),
    }),
  )
  .handler(async ({ data }) => {
    const col = await projectsCol();
    await col.updateOne(
      { _id: new ObjectId(data.id) },
      { $set: { timeline: data.timeline, defaults: data.defaults, updatedAt: new Date() } },
    );
    return { ok: true };
  });

// 6) Poll transcript status — pulls from AssemblyAI when still processing
export const refreshTranscript = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }))
  .handler(async ({ data }) => {
    const col = await projectsCol();
    const doc = await col.findOne({ _id: new ObjectId(data.id) });
    if (!doc) throw new Error("Project not found");
    if (doc.transcript.status === "completed" || doc.transcript.status === "failed") {
      return doc.transcript;
    }
    const aaiId = (doc.transcript as unknown as { aaiId?: string }).aaiId;
    if (!aaiId) return doc.transcript;
    try {
      const result = await pollTranscript(aaiId);
      if (result.status === "completed") {
        const upd = { status: "completed" as const, words: result.words ?? [] };
        await col.updateOne(
          { _id: doc._id! },
          { $set: { transcript: { ...upd } } },
        );
        return upd;
      }
      if (result.status === "error") {
        const upd = { status: "failed" as const, words: [], error: result.error };
        await col.updateOne({ _id: doc._id! }, { $set: { transcript: upd } });
        return upd;
      }
      return { status: "processing" as const, words: [] };
    } catch (err) {
      return { status: "processing" as const, words: [], error: String(err) };
    }
  });

// 7) Delete project
export const deleteProject = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }))
  .handler(async ({ data }) => {
    const col = await projectsCol();
    await col.deleteOne({ _id: new ObjectId(data.id) });
    return { ok: true };
  });
