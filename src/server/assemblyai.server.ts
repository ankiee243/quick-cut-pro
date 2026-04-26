import type { TranscriptWord } from "./mongo.server";

const BASE = "https://api.assemblyai.com/v2";

function key(): string {
  const k = process.env.ASSEMBLYAI_API_KEY;
  if (!k) throw new Error("ASSEMBLYAI_API_KEY not configured");
  return k;
}

export async function startTranscript(audioUrl: string): Promise<string> {
  const res = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: { authorization: key(), "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
  });
  if (!res.ok) throw new Error(`AssemblyAI start failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

export interface AAIPollResult {
  status: "queued" | "processing" | "completed" | "error";
  words?: TranscriptWord[];
  error?: string;
}

export async function pollTranscript(id: string): Promise<AAIPollResult> {
  const res = await fetch(`${BASE}/transcript/${id}`, { headers: { authorization: key() } });
  if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status}`);
  const json = (await res.json()) as {
    status: "queued" | "processing" | "completed" | "error";
    words?: Array<{ text: string; start: number; end: number }>;
    error?: string;
  };
  if (json.status === "completed") {
    return {
      status: "completed",
      words: (json.words ?? []).map((w) => ({ text: w.text, startMs: w.start, endMs: w.end })),
    };
  }
  if (json.status === "error") return { status: "error", error: json.error };
  return { status: json.status };
}
