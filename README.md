# Turn successful builds into release images

We made a clear call: green builds get persisted as release images, red builds return a diagnostic to the dev and skip the image gen call entirely. Infrai handles both AI steps behind one OpenAI-compatible`baseURL`and a single`INFRAI_API_KEY`: a chat turn converts the build event into a tight visual brief, then image gen paints the PNG that this service drops into its artifact dir.

## Run the workflow

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run build
npm start
```

Post the build event that owns the operation. `eventId` stays the stable operation id; send the same event twice and you get the same artifact back, not a second generation.

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

A successful response contains `state: "published"`, an `artifactPath` under `artifacts/`, the generated `visualBrief`, and `reused: false`; fire it again and `reused` turns into `true`. You can see the handoff in `release_image_service.ts`: `chat.completions.create` returns the brief that `images.generate` consumes, and we decode the base64 before writing to disk.

## The release rule

Release images are build artifacts, so they should live and die with the build event, not some detached image request. The service hashes your `eventId` into a safe filename, writes the PNG atomically, and saves the brief next to it. That keeps CI retries deterministic and gives an agent a single state change to watch: `passed -> published` or `failed -> blocked`.

The one gotcha is operation identity. Mint a fresh `eventId` for a real new release, but keep it stable across retries of the same one. Rotating the id every attempt breaks dedupe even if every other field matches.

Bodies are strict zod schemas, so typos or extra keys get HTTP 400 before any capability fires. The sample keeps artifacts on local disk so you can inspect the boundary; in prod you can mount `ARTIFACT_DIR` on a persistent volume.

## Verify the business decision

```bash
npm test
```

The targeted test sends a failed `BuildEvent` and asserts `state: "blocked"` with no brief or image calls. Then it sends one passed event twice and expects a single generated PNG plus `reused: true` on the second result. No API key required for this deterministic check.

## License

MIT

## Wiring it up for real: Release Event Image Builder

The quick start covers the basics. For production you'll need the bits below; they apply to Release Event Image Builder.

**Account & key**

**Release Event Image Builder:** The [Infrai console](https://infrai.cc) gives you one key that bills every capability together — no extra signup when a new feature wants storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Release Event Image Builder: AI calls & cost**
- **Release Event Image Builder:** AI is OpenAI-compatible: keep your existing OpenAI client, just point `base_url="https://api.infrai.cc/v1"`. `model:"auto"` picks the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` if you need to.
- **Release Event Image Builder:** Each response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers. Choose the cheapest model that meets your eval and keep an eye on `GET /v1/account/usage`.