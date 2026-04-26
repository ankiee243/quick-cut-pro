import { createServerFn } from "@tanstack/react-start";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { projectsCol, renderJobsCol } from "../server/mongo.server";

// Submits a render job to the external Remotion render service.
// The render service is expected to:
//   - accept { projectId, project, callbackUrl, callbackToken }
//   - render server-side and POST result to callbackUrl
export const submitRender = createServerFn({ method: "POST" })
  .inputValidator(z.object({ projectId: z.string().regex(/^[0-9a-f]{24}$/) }))
  .handler(async ({ data }) => {
    const projects = await projectsCol();
    const project = await projects.findOne({ _id: new ObjectId(data.projectId) });
    if (!project) throw new Error("Project not found");

    const jobs = await renderJobsCol();
    const now = new Date();
    const job = await jobs.insertOne({
      projectId: data.projectId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    const jobId = job.insertedId.toString();

    const renderUrl = process.env.RENDER_SERVICE_URL;
    const renderToken = process.env.RENDER_SERVICE_TOKEN;
    if (!renderUrl) {
      await jobs.updateOne(
        { _id: job.insertedId },
        { $set: { status: "failed", error: "RENDER_SERVICE_URL not configured", updatedAt: new Date() } },
      );
      return { jobId, queued: false, error: "Render service not configured" };
    }

    try {
      const res = await fetch(renderUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(renderToken ? { authorization: `Bearer ${renderToken}` } : {}),
        },
        body: JSON.stringify({
          jobId,
          project: {
            audioUrl: project.audio.url,
            durationSec: project.audio.durationSec,
            timeline: project.timeline,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        await jobs.updateOne(
          { _id: job.insertedId },
          { $set: { status: "failed", error: `Render service: ${res.status} ${text}`, updatedAt: new Date() } },
        );
        return { jobId, queued: false, error: `Render service responded ${res.status}` };
      }
      await jobs.updateOne(
        { _id: job.insertedId },
        { $set: { status: "rendering", updatedAt: new Date() } },
      );
      return { jobId, queued: true };
    } catch (err) {
      await jobs.updateOne(
        { _id: job.insertedId },
        { $set: { status: "failed", error: String(err), updatedAt: new Date() } },
      );
      return { jobId, queued: false, error: String(err) };
    }
  });

export const getRenderJob = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: z.string().regex(/^[0-9a-f]{24}$/) }))
  .handler(async ({ data }) => {
    const jobs = await renderJobsCol();
    const job = await jobs.findOne({ _id: new ObjectId(data.jobId) });
    if (!job) throw new Error("Job not found");
    return {
      id: job._id!.toString(),
      status: job.status,
      outputUrl: job.outputUrl,
      error: job.error,
    };
  });
