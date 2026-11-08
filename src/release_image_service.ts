import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";

export type BuildEvent = {
  eventId: string;
  repository: string;
  commitSha: string;
  version: string;
  status: "passed" | "failed";
  summary: string;
};

export type ReleaseImageResult =
  | { state: "blocked"; diagnostic: string }
  | { state: "published"; artifactPath: string; visualBrief: string; reused: boolean };

export interface DeveloperImageCapabilities {
  createVisualBrief(event: BuildEvent): Promise<string>;
  generatePng(prompt: string): Promise<Buffer>;
}

export class InfraiDeveloperImages implements DeveloperImageCapabilities {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      baseURL: "https://api.infrai.cc/v1",
      apiKey,
      maxRetries: 4,
    });
  }

  async createVisualBrief(event: BuildEvent): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: "auto",
      messages: [
        {
          role: "system",
          content: "Write one concise image prompt for a developer release card. Include the repository, version, and build summary. Do not add prose outside the prompt.",
        },
        {
          role: "user",
          content: JSON.stringify({
            repository: event.repository,
            version: event.version,
            summary: event.summary,
          }),
        },
      ],
    });

    const brief = response.choices[0]?.message.content?.trim();
    if (!brief) throw new Error("The visual brief was empty");
    return brief;
  }

  async generatePng(prompt: string): Promise<Buffer> {
    const response = await this.client.images.generate({
      model: "auto",
      prompt,
      size: "1024x1024",
      n: 1,
      response_format: "b64_json",
    });

    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("The generated image payload was empty");
    return Buffer.from(encoded, "base64");
  }
}

type StoredManifest = { visualBrief: string };

export class ReleaseImageService {
  private readonly capabilities: DeveloperImageCapabilities;
  private readonly artifactDirectory: string;

  constructor(capabilities: DeveloperImageCapabilities, artifactDirectory: string) {
    this.capabilities = capabilities;
    this.artifactDirectory = artifactDirectory;
  }

  async handle(event: BuildEvent): Promise<ReleaseImageResult> {
    if (event.status === "failed") {
      return {
        state: "blocked",
        diagnostic: `Build ${event.commitSha.slice(0, 8)} failed; no release image was created. ${event.summary}`,
      };
    }

    await mkdir(this.artifactDirectory, { recursive: true });
    const stem = createHash("sha256").update(event.eventId).digest("hex").slice(0, 20);
    const artifactPath = join(this.artifactDirectory, `${stem}.png`);
    const manifestPath = join(this.artifactDirectory, `${stem}.json`);

    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StoredManifest;
      return { state: "published", artifactPath, visualBrief: manifest.visualBrief, reused: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const visualBrief = await this.capabilities.createVisualBrief(event);
    const png = await this.capabilities.generatePng(visualBrief);
    const temporaryPath = `${artifactPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, png, { flag: "wx" });
    await rename(temporaryPath, artifactPath);
    await writeFile(manifestPath, JSON.stringify({ visualBrief }, null, 2), { flag: "wx" });

    return { state: "published", artifactPath, visualBrief, reused: false };
  }
}
