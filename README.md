# PSI-88L — Knowledge & Support

An independent technical-support application and authenticated API. Build a retained knowledge library from text, PDFs, logs, DOCX documents, structured text, and photos; retrieve relevant evidence when generating AI answers.

Repository: [ericfowler-dev/PSI-88L](https://github.com/ericfowler-dev/PSI-88L).

## Implemented

- Sign-in, first-administrator setup, and administrator/editor/technician roles.
- Pasted text and file uploads: PDF, TXT, LOG, MD, CSV, TSV, JSON, JSONL, XML, YAML, INI, CONF, DOCX, PNG, JPEG, and WebP.
- Private original-file retention, duplicate detection, queued extraction, PDF page references, log/text line references, English OCR for photos and scanned PDFs, and retryable failed jobs.
- Source preview, corrected transcription, immutable text revisions, review acknowledgment, publication/unpublication, and deletion from retrieval.
- Optional user-initiated image descriptions through a configured vision-capable model. Descriptions are retained as unverified draft source text for review.
- Indexed PostgreSQL full-text retrieval with engine abbreviations/synonyms and relevant previous-question context.
- Database-backed private cases, messages, case attachments, source snapshots, and streamed answers.
- Configurable OpenAI Responses, xAI chat-completions, or a compatible chat-completions endpoint. API keys are encrypted at rest and never returned to the browser.
- Shared database request limits and provider token-usage records.

This is a single workspace, not a multi-tenant SaaS. Published library sources are shared with signed-in members; each case and its attachments belong to one user. Knowledge is retrieved at answer time, not used to automatically retrain the model.

## Local development

Requirements: Node.js 22.16+ and npm. Install on the operating system where the app will run: PDF/OCR rendering includes native dependencies.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8080`. On the first visit, create an administrator account. Local setup without a token is allowed only on the loopback development server. Use a password of at least 12 characters.

Local data is persisted under `.data/`: PostgreSQL-compatible PGlite files, private originals, OCR cache, and the key used to encrypt locally stored AI credentials. Restarting the app does not clear knowledge. Back up this directory while the app is stopped if using local storage. Do not run two processes against the same PGlite directory; the local app runs its own embedded ingestion worker.

To override configuration, copy `.env.example` to `.env`. The app does not need an AI key to upload, extract, review, publish, or search sources. Open **Settings** to select a provider, enter the exact model ID available to your account, and save its API key. A vision-capable model is required for optional image analysis.

## Build a knowledge base

1. Open **Library** and choose **Upload files** or **Write a note**.
2. Wait for extraction. The original is retained before processing starts.
3. Inspect the extracted passages, original source, and warnings. Correct transcription or add a reviewed photo description where needed.
4. Acknowledge the review and choose **Publish knowledge**.
5. Ask a relevant question in **Desk**. The app retrieves approved passages and supplies them to the configured model. Follow source links to inspect the exact retained revision.
6. Attach a log or photo to a case for private context. Processed case attachments can inform that case without being published to the shared library.

If no relevant source is found, the desk reports the evidence gap instead of asking the model to invent a technical procedure. Citation identifiers are checked for invalid references; this does not prove every generated claim is correct. Qualified review remains necessary.

## Production and scaling

The approved initial Render pilot uses `render.yaml`: one 2 GB web service and a 5 GB persistent disk. The database, originals, and embedded worker share `/var/data/psi-88l`. Startup verifies the disk is mounted before serving the app. This pilot has one instance and brief downtime during deployments. Its base cost is approximately $26.25/month, excluding AI usage and workspace/usage charges. See [deployment status](docs/DEPLOYMENT.md).

`deploy/render-scalable.yaml` retains the scale-out design: web service, separate ingestion worker, managed PostgreSQL, and shared private S3-compatible storage. Migrating requires transferring the database and originals; changing environment variables alone does not move existing data. A hosting-assigned address works without purchasing a domain.

Required configuration for the PostgreSQL/S3 scale-out deployment:

- `DATABASE_URL`: durable PostgreSQL, preferably a pooled connection endpoint.
- `APP_SECRET`: at least 32 random characters; retain it securely to decrypt saved AI credentials after restarts and deployments.
- `SETUP_TOKEN`: random token required once when creating the first administrator. Initial setup closes after the first user is created.
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: private original-file storage. Standard AWS credentials can also be supplied through the SDK's environment/role chain.
- `WORKER_MODE=external`: web instances enqueue work; the separate worker runs `npm run worker`.
- `APP_URL`: the public HTTPS origin. Render's injected `RENDER_EXTERNAL_URL` is used when `APP_URL` is omitted; set `APP_URL` when adding a custom domain.

Build with `npm ci && npm run build`, migrate with `npm run db:migrate`, start with `npm start`. The build does not connect to or migrate production data. Runtime initialization also checks pending migrations under a database lock. The release process should run migrations first so errors are caught before traffic.

The deployment must include `migrations/` and installed runtime dependencies as well as `.output/`. Build on the target OS; do not deploy a Windows-built native dependency bundle to Linux. Keep staging and production databases/buckets separate. Back up and test restoration of both the database and originals; preserve `APP_SECRET` in the hosting secret store.

Web capacity and worker count can increase independently. Jobs use PostgreSQL row locks, lease tokens, and heartbeat renewal. This avoids requiring Redis for the initial release. Keep production storage external to app disks. At higher load, evaluate queue backlog, concurrent streams, database connections, and provider limits before increasing instances.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Core tests use isolated `.test-data/` directories and a local mock AI endpoint. They exercise actual extraction, persistence/restart, review gating, revisions, authorization, provider payloads, streaming, and deletion. They do not claim a live provider connection was verified.

Browser test setup: start an isolated test instance with `DATA_DIR=.test-data/production`, `ALLOW_LOCAL_STORAGE=true`, `ALLOW_LOCAL_AI=true`, `SETUP_TOKEN=local-verification-token`, `PORT=8081`, and `HOST=127.0.0.1`; then run `npm start`. Install Chromium with `npx playwright install chromium` and run `npm run test:e2e`. The test creates a QA account, retained fixtures, and a local mock provider to verify the settings-to-answer workflow. Never point it at a workspace containing real user data.

Run `npm run validate:blueprint` to check hosting configuration against Render's current schema. This requires internet access and creates no resources.

## Current limits

- 20 MB per upload; the interface submits up to five files at a time.
- PDFs: up to 200 pages, with at most 20 scanned pages requiring OCR per document. One million extracted characters maximum.
- OCR is English and may misread values. Review technical numbers and units against originals. Diagram interpretation is not automatic for PDF pages.
- DOCX extraction reads text; embedded images are not separately analyzed. CSV/JSON/logs are searchable text, not a time-series analytics engine.
- Photo descriptions require a compatible vision model; automatic OCR runs independently of the AI provider.
- Search is lexical with synonyms, not an embedding/vector implementation. Chunk and citation versions are retained so semantic retrieval can be added later.
- Deleting a source removes search passages immediately and deletes the original, with durable worker retries if storage is unavailable. Previously saved case answers retain historical evidence snapshots. A full organization retention/purge policy, malware-scanning service, stronger parser isolation, SSO, password reset/email delivery, and cross-user case assignment remain future work.
- Request quotas and token counts are implemented; monetary spending caps and automatic provider billing reconciliation are not.
- Hosted PostgreSQL, S3 credentials, and a real AI provider must be configured and verified before production use.

## Documentation

- [API reference](docs/api.md)
- [Changelog](CHANGELOG.md)
- [Upload and retained-knowledge requirements](docs/file-uploads-and-retained-knowledge.md)
- [Architecture and migration history](docs/independent-hosting-and-learning.md)
