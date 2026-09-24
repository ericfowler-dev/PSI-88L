# Changelog

## Unreleased — independent application

### 2026-09-24 — Verifiable diagnostic retrieval and refreshed workspace

- Normalize fault-code questions such as `SPN 1208 / FMI 3`, `1208:3`, `1208/3`, and `1208-3`; prioritize the exact pair and distinguish other FMIs. Retain SPN context for FMI-only follow-up questions.
- Recognize bordered diagnostic tables with labeled columns and retain row labels, printed page references, and original page text. Existing extracted manuals also benefit from corrected retrieval without re-uploading.
- Add **Check knowledge** to inspect the evidence available to the AI without making a model request; expose exact-code matching through the search API.
- Show PDF page totals separately from passage counts, search within extracted evidence, open original PDFs, and optionally re-extract a retained original into a new revision requiring review.
- Refresh the dark Desk and Library: collapsible cases, wider conversation, compact composer, clearer answer cards, responsive navigation, and expandable citations.
- Verified the privately supplied 539-page manual locally, including the requested fault on printed page 379, notation variants, legacy extraction, and evidence in a mocked provider request. No private manual text is committed and no live provider answer is claimed.
- See [knowledge verification](docs/knowledge-verification.md).

### 2026-09-24 — Conversation layout and model setup

- Removed the right-hand evidence sidebar and widened the conversation and composer. Source references remain available in expandable lists beneath answers.
- Clarified that Model ID is a provider API identifier, not the PSI-88L Grok project name; added xAI setup guidance and targeted API error messages.
- Added an administrator-only saved-connection check that verifies credentials and model-list availability without sending knowledge or generating an answer.
- See [AI connection setup](docs/ai-connection-setup.md).

### 2026-09-24 — Large diagnostic manuals

- Replaced the 200-page PDF and 20-page OCR document limits with resumable batches (up to 25 pages or two OCR pages per job pass).
- Save extracted passages and page checkpoints together; resume after restarts or retries without duplicating passages or losing original page citations.
- Removed the one-million-character total limit for PDFs; retained the 20 MB upload and page-rendering safeguards.
- Show processing progress, render long passage lists incrementally, and prevent failed/unfinished sources or empty transcriptions from being published.
- Keep the original file intact and require review before publication. Existing failed uploads can use **Retry processing** without re-uploading.
- See [large-manual processing](docs/large-manual-processing.md) for recovery and limits.

### 2026-09-24 — Published and deployed Render pilot

- Committed and pushed the application to GitHub; fixed a clean npm 10 installation lockfile issue and verified Linux CI.
- Deployed `https://psi-88l.onrender.com` on a 2 GB service with a 5 GB persistent disk, preserving knowledge and uploads under `/var/data/psi-88l`.
- Added a startup guard requiring the persistent mount, generated private setup/encryption secrets, and retained the PostgreSQL/S3 scale-out Blueprint separately.
- Verified live health, access protection, and desktop/mobile first-account setup. AI connection remains configurable by the administrator.
- See [deployment instructions](docs/DEPLOYMENT.md) for setup, service details, and pilot limitations.

### 2026-09-24 — App, API, and retained knowledge implemented locally

- Replaced Grok preview identity/runtime with an independent Node application, initial administrator setup, sign-in, database sessions, and administrator/editor/reader permissions.
- Added authenticated APIs for cases, knowledge, uploads, search, members, AI configuration, and streamed answers.
- Added persistent local PGlite and hosted PostgreSQL support; production requires explicit durable storage.
- Added Library uploads and private case attachments for PDFs, photos, DOCX, text, logs, and supported structured-text artifacts.
- Retain original files in private local or S3-compatible storage and queue extraction with worker leases, heartbeat renewal, and retries.
- Extract PDF text/page references, text/log line references, DOCX paragraphs, and English OCR from photos and scanned PDFs.
- Added image previews, original downloads, extraction warnings, corrected transcription, immutable text revisions, review acknowledgment, publication, and unpublication.
- Added optional vision-model descriptions as unverified draft revisions.
- Retrieve published passages and owner-private case evidence for AI answers. Preserve source snapshots, conversation history, cancellation, and incomplete-answer status.
- Support configurable OpenAI Responses, xAI, and compatible APIs. Encrypt saved keys and isolate environment credentials when changing endpoints.
- Added shared request quotas, audit records, and provider token counts.
- Deletion immediately removes search passages and retries original-file cleanup if storage is unavailable. Historical answer snapshots remain.
- Fixed incomplete Markdown table rendering and stale case/source loading races.
- Added integration tests, desktop/mobile browser verification, CI, setup/API documentation, and a Render Blueprint validated against the official JSON schema.

The initial implementation was verified locally; the later deployment entry above records its hosted status. No live AI provider, hosted PostgreSQL, or S3 account has been validated. See [README](README.md) for startup and limits and [architecture review](docs/independent-hosting-and-learning.md) for scaling priorities.

### 2026-09-23 — Requested direction and repository setup

- Configured [ericfowler-dev/PSI-88L](https://github.com/ericfowler-dev/PSI-88L) as the Git remote and initialized the local repository on main.
- Documented uploads, retained knowledge, private case attachments, and independence from Grok.
- Added ignore rules for credentials, uploads, databases, generated outputs, and preserved legacy code.
- Recorded that the user has no domain. Initial hosting can use an assigned provider address; no address has been reserved.

## Next improvements

- Validate a real provider against reviewed engineering sources; measure retrieval and citation quality.
- Verify hosted storage, backup restoration, concurrent workloads, and monitoring before a production pilot.
- Add malware scanning, stronger parser isolation, account recovery/SSO, spending caps, pagination, and an explicit retention/purge policy.
- Evaluate semantic retrieval, direct-to-storage uploads, and additional workers as document volume grows.
- Add organizations and scoped collaboration if expanding beyond one shared workspace.

The broader [upload requirements](docs/file-uploads-and-retained-knowledge.md) remain the roadmap; their advanced capabilities are not all implemented.
