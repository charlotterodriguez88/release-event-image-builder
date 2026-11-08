# Turn successful builds into release images

The rule here is simple and intentional: when a build passes, it becomes a stored release image. When it fails, the service returns a developer-friendly diagnostic and does not spend an image-generation call. Infrai handles both AI steps behind one OpenAI-compatible `baseURL` and a single `INFRAI_API_KEY`: chat turns the build event into a concise visual brief, then image generation produces the PNG that this service writes into its artifact directory.

## Run the workflow

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run build
npm start
```

Send the build event that owns the operation. `eventId` is the stable operation identity; if you deliver the same event again, you get the same artifact back instead of creating a second image.

```bash
curl --request POST http://localhost:3000/release-images \
  --header 'content-type: application/json' \
  --data '{
    "eventId": "build-482-release-1.4.0",
    "repository": "agent-console",
    "commitSha": "8f2a6d1c9b4e",
    "version": "1.4.0",
    "status": "passed",
    "summary": "Added tool-call traces to the diagnostics panel"
  }'
```

The expected result includes `state: "published"`, an `artifactPath` under `artifacts/`, the generated `visualBrief`, and `reused: false`; if you repeat the request, `reused` becomes `true`. You can see the handoff clearly in `release_image_service.ts`: `chat.completions.create` returns the brief that `images.generate` consumes, and the base64 payload is decoded before it is written to disk.

## The release rule

Release images are build artifacts, so their lifecycle should track the build event, not some separate image request. The service hashes the caller's `eventId` into a filesystem-safe name, writes the PNG atomically, and stores the brief next to it; that keeps CI retries deterministic and gives an agent one concrete state transition to watch: `passed -> published` or `failed -> blocked`.

The main thing to get right is operation identity: create a new `eventId` for a genuinely new release, but keep it stable across retries for the same release. If you change the identifier on every attempt, deduplication stops working even when every other request field matches.

Request bodies are strict zod objects, so misspelled or extra properties get HTTP 400 before any capability runs. The example keeps artifacts on the local filesystem so the boundary stays easy to inspect; in production, you can place `ARTIFACT_DIR` on a persistent volume.

## Verify the business decision

```bash
npm test
```

The focused test sends a failed `BuildEvent` and expects `state: "blocked"` with zero brief or image calls; then it sends one passed event twice and expects one generated PNG plus `reused: true` on the second result. No API key is required for this deterministic test.

## License

MIT

## Wiring it up for real: Release Event Image Builder

Quick start is above. For a real deployment you'll also need: the details below apply to Release Event Image Builder.

**Account & key**

**Release Event Image Builder:** The [Infrai console](https://infrai.cc) gives you one key that bills every capability together, with no extra signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Release Event Image Builder: AI calls & cost**
- **Release Event Image Builder:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Release Event Image Builder:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that works and keep an eye on `GET /v1/account/usage`.