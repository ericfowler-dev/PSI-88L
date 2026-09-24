# PSI-88L — build and verification report

This report records local verification before hosting. The subsequent Render pilot is live; see [deployment status](DEPLOYMENT.md) for current setup and verification.

Date: September 24, 2026.

The independent application and authenticated API are implemented locally. Users can retain originals and searchable knowledge from text, PDF, logs, DOCX, photos, and supported structured-text files. Published library passages and owner-private case attachments provide evidence for the configured AI model. Knowledge and cases persist across restarts.

## Verified

- TypeScript type checking: passed.
- ESLint: passed.
- Core integration suite: 18 passing checks, no failures.
- Production build: passed.
- Production-build browser flow: passed on desktop and a 390-pixel mobile viewport, with no horizontal overflow or browser console errors.
- Browser flow covers sign-in, saved cases, note publication, PDF upload/extraction, private log attachment, AI settings, retrieved-evidence streaming through a local mock provider, and answer persistence after reload.
- Core checks additionally cover real DOCX parsing, image and scanned-PDF OCR, source revisions, permission boundaries, storage restart, key isolation, OpenAI Responses/image payloads, cancellation, interrupted answers, and retryable deletion.
- Desktop/mobile screenshots were inspected under the ignored screenshots/ directory.
- Render Blueprint: passed the current official JSON schema. No resources created.
- Local development health/session endpoints: healthy and awaiting first-administrator setup.

## Start using it

The development server was started at http://127.0.0.1:8080 for this session. Create your administrator account on the first visit. Open Library to upload and publish reviewed material. Open Settings to choose your provider, model ID, and API key when ready to enable answers.

If the server is stopped, run these commands from the project directory:

```sh
npm ci
npm run dev
```

Development data is stored under .data/. Test fixtures/accounts are isolated under .test-data/. Never use the browser test against real user data. Back up local data while the application is stopped.

## Remaining external setup

No live AI account, hosted PostgreSQL, or S3 account was connected. Model tests used explicit local mocks; they verify integration behavior, not real model quality. Hosted load, backup recovery, storage integration, and real-source answer quality must be validated for a production pilot.

Nothing has been committed, pushed, or deployed. The Git remote is https://github.com/ericfowler-dev/PSI-88L. No public application address has been provisioned. A domain is optional for initial hosting.

See [README](../README.md), [API reference](api.md), [architecture and scaling review](independent-hosting-and-learning.md), and [changelog](../CHANGELOG.md).
