# PSI-88L API

The application and external HTTP clients use the same JSON API. All routes except health, session status, setup, and login require a signed-in session. API errors use `{ "error": "message" }` with the appropriate HTTP status.

Authentication currently uses an HTTP-only, SameSite=Lax session cookie. Sign in through `POST /api/login` and retain the returned cookie. Production HTTPS cookies are Secure. Cross-origin browser mutations are rejected; no permissive CORS is enabled. Dedicated scoped API tokens are not implemented yet.

## Accounts and configuration

| Method | Endpoint | Request / result |
| --- | --- | --- |
| GET | `/api/health` | Database-backed readiness `{ok:true}` |
| GET | `/api/session` | Current user, whether first-user setup is needed, whether a setup token is required |
| POST | `/api/setup` | `{name,email,password,setupToken}`; creates the initial administrator only |
| POST | `/api/login` | `{email,password}`; sets session cookie |
| POST | `/api/logout` | Revokes session and clears cookie |
| GET | `/api/status` | Published-source count, processing count, AI configuration availability |
| GET | `/api/settings` | Administrator only; redacted AI configuration, storage/worker mode, token usage |
| PUT | `/api/settings` | Administrator only; `{provider,model,baseUrl?,apiKey?,clearKey?}` |
| GET | `/api/users` | Administrator only; workspace members |
| POST | `/api/users` | Administrator only; `{name,email,password,role}` where role is `admin`, `editor`, or `reader` |

Providers: `openai` uses Responses; `xai` uses xAI chat completions; `compatible` uses an administrator-selected HTTPS chat-completions endpoint. `baseUrl` must end at the provider's API prefix, such as `/v1`, not `/chat/completions`. Local HTTP endpoints require the explicit server setting `ALLOW_LOCAL_AI=true`. Blank keys preserve a stored key only for the same provider and endpoint. Clearing a stored key does not erase a credential supplied by the host environment.

## Knowledge

| Method | Endpoint | Request / result |
| --- | --- | --- |
| GET | `/api/knowledge?q=...` | Up to 100 library sources; readers see only published items |
| GET | `/api/knowledge?caseId=...` | Attachments for a case owned by the current user |
| POST | `/api/knowledge/upload` | Multipart form: `file`, optional `title`, `sourceNote`, `caseId`; returns `{document,duplicate}` |
| POST | `/api/knowledge/text` | `{title,content,sourceNote?,caseId?}`; saves original text and queues extraction |
| GET | `/api/knowledge/:id?revision=...` | Source metadata and extracted chunks, including optional retained historical revision |
| PATCH | `/api/knowledge/:id` | `{revision,title?,sourceNote?,content?,publish?,acknowledged?}`; revision is mandatory for conflict detection |
| DELETE | `/api/knowledge/:id` | Remove original file and search content; earlier case answer snapshots remain |
| GET | `/api/knowledge/:id/download` | Authenticated original-file download |
| GET | `/api/knowledge/:id/preview` | Authenticated inline preview for supported images |
| POST | `/api/knowledge/:id/retry` | Retry a failed extraction job |
| POST | `/api/knowledge/:id/analyze-image` | User-initiated paid vision request; saves a draft text revision, never automatically publishes |
| POST | `/api/knowledge/search` | `{question,caseId?}`; returns relevant authorized passages without calling the AI |

Library upload/edit/publication requires editor or administrator access. A reader can attach evidence to their own case. Case ownership is enforced on listing, retrieval, download, preview, and mutation. Case evidence cannot be published directly as shared-library material; create a separately reviewed library source.

Lifecycle: `queued` → `processing` → `review` → `published`. Failed extraction sets `failed` with an actionable error. Unpublishing returns a source to `review`. Text corrections create a new revision and require publication review again.

PDF metadata includes `processed_pages` and `total_pages` (zero until the first batch finishes). Extraction checkpoints and passages commit together. A retry resumes from the last completed batch using the retained original. Partial passages are not available to AI retrieval, and queued, processing, or failed sources cannot be edited or published. Large manuals remain one document with original page citations; the Library displays passages in groups of 50.

Publication requires nonempty searchable passages and `acknowledged:true`. A stale revision yields HTTP 409. Duplicate file content by the same uploader in the same scope returns the existing source.

## Cases and answers

| Method | Endpoint | Request / result |
| --- | --- | --- |
| GET | `/api/cases` | Up to 100 cases owned by the current user |
| POST | `/api/cases` | Creates `{id,title}` |
| GET | `/api/cases/:id` | Case, retained messages, and attachments |
| POST | `/api/chat` | `{caseId,question}`; server-sent event response |

The server loads history itself; clients cannot submit fabricated assistant history or substitute another user's case. Retrieval uses published library passages and ready attachments owned by the current case user. Only the retrieved evidence is added to the model context.

Administrators can `POST /api/settings/test` to check the saved API connection against the provider's `/models` endpoint (10 checks per administrator per 10 minutes). It sends no documents or generation request. Success means the key was accepted and the model was listed; it does not prove generation capability, billing availability, or vision support. Compatible providers that omit model listing must be verified in their own console.

SSE frames contain JSON after `data:` and a blank line:

```text
data: {"type":"start","userId":"...","assistantId":"...","sources":[...]}

data: {"type":"delta","text":"Answer text..."}

data: {"type":"done","status":"complete"}

```

Provider failures produce an `error` event followed by `done` with `status:"error"`; partial text is retained. Cancelling the response aborts the upstream request. Re-read the case to get its final persisted status. There is at most one active answer per case.

Source fields: `id` (passage ID), `documentId`, `title`, `filename`, `revision`, `locator`, and `content`. `[S1]` maps to the first supplied source, `[S2]` to the second, etc. These are retrieved evidence candidates; citation validation does not guarantee factual correctness.

## Limits

Source deletion returns `{ok:true,cleanupPending:boolean}`. Search passages are removed immediately. When original storage is unavailable, the worker retries cleanup from a durable queue. Saved answer snapshots remain retained.

Questions: 8,000 characters. Pasted notes: 500,000 characters. Files: 20 MB. Chat: 40 requests/user/10 minutes and 500/workspace/hour. Uploads: 30/user/hour. Optional image analysis: 10/user/hour and a 10 MB image cap. These are shared PostgreSQL counters, not per-process limits. API keys remain server-side.
