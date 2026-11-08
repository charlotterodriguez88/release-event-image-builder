import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ReleaseImageService,
  type BuildEvent,
  type DeveloperImageCapabilities,
} from "./release_image_service.js";

class CountingCapabilities implements DeveloperImageCapabilities {
  briefs = 0;
  images = 0;

  async createVisualBrief(event: BuildEvent): Promise<string> {
    this.briefs += 1;
    return `Release card for ${event.repository} ${event.version}`;
  }

  async generatePng(): Promise<Buffer> {
    this.images += 1;
    return Buffer.from("deterministic-png");
  }
}

const baseEvent: BuildEvent = {
  eventId: "build-482-release-1.4.0",
  repository: "agent-console",
  commitSha: "8f2a6d1c9b4e",
  version: "1.4.0",
  status: "passed",
  summary: "Added tool-call traces to the diagnostics panel",
};

test("blocks failed builds before either image capability runs", async () => {
  const capabilities = new CountingCapabilities();
  const directory = await mkdtemp(join(tmpdir(), "release-image-test-"));
  const service = new ReleaseImageService(capabilities, directory);

  const result = await service.handle({ ...baseEvent, status: "failed" });

  assert.equal(result.state, "blocked");
  assert.equal(capabilities.briefs, 0);
  assert.equal(capabilities.images, 0);
});

test("reuses the artifact when the same build event is delivered again", async () => {
  const capabilities = new CountingCapabilities();
  const directory = await mkdtemp(join(tmpdir(), "release-image-test-"));
  const service = new ReleaseImageService(capabilities, directory);

  const first = await service.handle(baseEvent);
  const second = await service.handle(baseEvent);

  assert.equal(first.state, "published");
  assert.equal(second.state, "published");
  if (first.state === "published" && second.state === "published") {
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(first.artifactPath, second.artifactPath);
  }
  assert.equal(capabilities.briefs, 1);
  assert.equal(capabilities.images, 1);
});
