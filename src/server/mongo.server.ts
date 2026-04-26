import { MongoClient, type Db, type Collection, type ObjectId } from "mongodb";

let client: MongoClient | null = null;
let dbPromise: Promise<Db> | null = null;

export type AnimationKind = "zoomIn" | "zoomOut" | "panLeft" | "panRight";

export interface ClipDoc {
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

export interface ProjectDoc {
  _id?: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  audio: {
    r2Key: string;
    url: string;
    durationSec: number;
  };
  transcript: {
    status: "pending" | "processing" | "completed" | "failed";
    words: TranscriptWord[];
    error?: string;
  };
  timeline: ClipDoc[];
  defaults: {
    label: string;
  };
}

export interface RenderJobDoc {
  _id?: ObjectId;
  projectId: string;
  status: "queued" | "rendering" | "completed" | "failed";
  outputUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

async function connect(): Promise<Db> {
  if (dbPromise) return dbPromise;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  if (!uri) throw new Error("MONGODB_URI not configured");
  if (!dbName) throw new Error("MONGODB_DB_NAME not configured");
  client = new MongoClient(uri);
  dbPromise = client.connect().then((c) => c.db(dbName));
  return dbPromise;
}

export async function projectsCol(): Promise<Collection<ProjectDoc>> {
  const db = await connect();
  return db.collection<ProjectDoc>("projects");
}

export async function renderJobsCol(): Promise<Collection<RenderJobDoc>> {
  const db = await connect();
  return db.collection<RenderJobDoc>("render_jobs");
}
