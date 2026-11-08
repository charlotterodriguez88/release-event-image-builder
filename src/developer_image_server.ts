import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import OpenAI from "openai";
import { z } from "zod";
import { InfraiDeveloperImages, ReleaseImageService } from "./release_image_service.js";

const buildEventSchema = z.object({
  eventId: z.string().min(1).max(128),
  repository: z.string().min(1).max(200),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  version: z.string().min(1).max(80),
  status: z.enum(["passed", "failed"]),
  summary: z.string().min(1).max(500),
}).strict();

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const service = new ReleaseImageService(
  new InfraiDeveloperImages(apiKey),
  process.env.ARTIFACT_DIR ?? "artifacts",
);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/release-images") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const parsed = buildEventSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      send(response, 400, { error: "Invalid build event", issues: parsed.error.issues });
      return;
    }

    const result = await service.handle(parsed.data);
    send(response, result.state === "blocked" ? 409 : 201, result);
  } catch (error) {
    if (error instanceof SyntaxError || (error as Error).message === "REQUEST_TOO_LARGE") {
      send(response, 400, { error: "Request body must be valid JSON within 32 KB" });
      return;
    }
    if (error instanceof OpenAI.APIError && error.status && error.status < 500) {
      send(response, error.status, { error: error.message });
      return;
    }
    console.error("release image request failed", error);
    send(response, 500, { error: "Release image request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`release image service listening on http://localhost:${port}`));
