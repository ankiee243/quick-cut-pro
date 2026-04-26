import { createFileRoute } from "@tanstack/react-router";
import { ObjectId } from "mongodb";
import { renderJobsCol } from "../../../server/mongo.server";

// Public callback hit by the render service when a render finishes.
// Expects: Authorization: Bearer <RENDER_SERVICE_TOKEN>
// Body: { jobId, status: 'completed' | 'failed', outputUrl?, error? }
export const Route = createFileRoute("/api/public/render-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.RENDER_SERVICE_TOKEN;
        const auth = request.headers.get("authorization") ?? "";
        if (!token || auth !== `Bearer ${token}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        let body: { jobId?: string; status?: string; outputUrl?: string; error?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!body.jobId || !/^[0-9a-f]{24}$/.test(body.jobId)) {
          return new Response("Bad jobId", { status: 400 });
        }
        if (body.status !== "completed" && body.status !== "failed") {
          return new Response("Bad status", { status: 400 });
        }
        const jobs = await renderJobsCol();
        await jobs.updateOne(
          { _id: new ObjectId(body.jobId) },
          {
            $set: {
              status: body.status,
              outputUrl: body.outputUrl,
              error: body.error,
              updatedAt: new Date(),
            },
          },
        );
        return new Response("ok");
      },
    },
  },
});
