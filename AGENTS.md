# PSI-88L development

This is an independent application migrated from a Grok builder export at the user's request. Former builder-only hosting, branding, authentication, and sandbox instructions no longer describe this project.

- Preserve the dark technical Desk / Library experience and mobile usability.
- Application: src/. Server services: backend/. Durable schema: migrations/.
- Keep secrets, private files, databases, screenshots, and generated outputs out of Git.
- Require authentication and server authorization on knowledge and case APIs.
- This is a single workspace with shared published knowledge and owner-private cases. Do not claim multi-tenant isolation.
- Local development: persistent PGlite and private local files. Production: PostgreSQL and private S3-compatible storage. Never silently fall back to ephemeral storage.
- Use real extraction and retrieval; never simulate AI responses when no provider is configured.
- Verify npm run typecheck, npm test, npm run build, and desktop/mobile browser workflows including uploads and source review.
- Use available browser tools or Playwright, saving screenshots under screenshots/.
- Keep README, API docs, environment examples, and changelog accurate.
- Do not deploy, buy resources, or publish private material as part of a local build.
