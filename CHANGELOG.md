# Changelog

## Unreleased — independent application

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

Implementation is local. No live AI provider, hosted PostgreSQL, or S3 account has been validated. Nothing has been pushed or deployed. See [README](README.md) for startup and limits and [architecture review](docs/independent-hosting-and-learning.md) for scaling priorities.

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
