# 88L Desk — File Uploads and Retained Knowledge

Requested: 2026-09-23; implementation status updated 2026-09-24.
Status: core first-release workflow implemented locally; broader requirements below remain the roadmap.

## Implementation status

Implemented: Library text/file uploads, owner-private case attachments, retained originals, durable jobs, PDF/DOCX/text extraction, photo/scanned-PDF English OCR, optional AI image descriptions, review/publication, corrected text revisions, full-text retrieval, source references, and persistent conversations. The AI receives retrieved evidence in its answer request. Deletion removes search passages immediately and retries original cleanup if needed; historical answers retain snapshots.

Future work: organizations/case handoff, structured log analytics, automatic diagram interpretation, vector indexing, advanced equipment metadata, replacement-file versions, one-click case promotion, malware scanning, comprehensive purge/retention controls, and monetary spending caps. Editors can manually create a reviewed Library source from useful case evidence. See [README](../README.md) for current limits.

The sections below preserve the requested target behavior; not every acceptance criterion has shipped. Hosted storage and a live model connection still require account configuration and validation.

## Objective

Users must be able to upload technical material to the Library and attach files to support conversations. The application must retain authorized knowledge and use it in future answers with traceable references.

In this feature, “learn and retain” means storing source material, extracting and indexing its contents, and retrieving relevant evidence when answering questions. It does not mean that an upload automatically retrains the underlying AI model. Retained knowledge must survive application restarts, deployments, and changes of device.

## Upload locations

### Library uploads

- Provide an Upload button and drag-and-drop area with multiple-file support.
- Accept manuals, service bulletins, datasheets, troubleshooting notes, equipment photos, and technical logs.
- Capture title, document type, engine/model applicability, source, revision/date, category, tags, and access scope.
- Extract and index content, then present it for review before publication.
- Make published material available to subsequent questions and new cases within its authorized scope.

### Case and chat attachments

- Provide an attachment control beside the message composer.
- Allow a user to ask a question about one or more attached files.
- Store the attachments with the case so authorized users can reopen or hand off the case across devices.
- Use attachments as case-specific evidence after processing completes.
- Let an authorized editor promote useful content into the Library through the normal review process.
- Do not automatically publish case attachments to a shared library.

## Initial supported formats

| Input | Expected handling |
| --- | --- |
| PDF | Extract text and page references; use OCR for scanned pages; preserve diagrams for visual review. |
| Photos: JPEG, PNG, WebP | Retain the original; recognize visible text, labels, nameplates, and display readings; support visual analysis for the attached question. |
| Logs: TXT, LOG | Preserve original lines; extract timestamps, alarm codes, repeated events, and event sequences where possible. |
| CSV | Preserve headers, values, units, and timestamps; support relevant measurements and event records. |
| Other formats | Clearly report unsupported files; add formats through explicit processing support rather than silently accepting unusable content. |

Publish configurable file-size, file-count, PDF-page, and organization-storage limits in the upload interface. Exact limits should be set after representative files are tested. Password-protected or corrupted files must return a clear processing error.

## Processing and retention

1. Verify the uploader's access and validate file type, signature, size, and processing limits.
2. Store the original in private, durable object storage and create a database record for it.
3. Queue background processing so large files do not block the conversation interface.
4. Extract text, perform OCR or visual analysis as appropriate, and parse structured log content.
5. Preserve page numbers, image references, log line ranges, timestamps, units, and extraction uncertainty.
6. Divide extracted content into searchable passages with source and version identifiers.
7. Show a preview of extracted material and any warnings; require review for shared-library publication.
8. Retrieve only content the requesting user can access, including eligible attachments from the active case.
9. Cite the exact retained source version used to answer the question.

User-visible states: Uploading, Queued, Processing, Ready for review, Published, Failed, and Deleted. Case attachments can become Ready for case use without being published to the Library.

Original files, metadata, extracted text, search records, and publication state must persist independently of browser storage and application process memory. A search-index rebuild must be possible from retained sources and metadata.

## Answer behavior

- Combine approved library evidence with relevant attachments from the active case.
- Identify whether a statement comes from manufacturer documentation, a reviewed field note, a log observation, or an AI interpretation of an image.
- Link citations to a PDF page, photo, or log line/time range, including the source revision when available.
- State when sources conflict or an attachment is insufficient to answer.
- Preserve technical numbers and units. Flag uncertain OCR for review rather than treating it as a verified specification.
- Do not infer hidden faults, unseen components, or definitive measurements from an unclear image.
- Treat instructions embedded in uploaded documents as untrusted source content, not as instructions controlling the assistant.
- If processing is incomplete or fails, explain that limitation instead of claiming the file was read.

## Access, review, and lifecycle

- Enforce permissions on upload, download, retrieval, publication, replacement, and deletion.
- Keep organization and case boundaries intact throughout processing and search.
- Maintain uploader, reviewer, timestamps, publication decisions, and an audit history.
- Preserve document revisions and flag superseded material; avoid silently replacing the evidence behind an earlier answer.
- Detect identical uploads using a content hash within the appropriate access scope.
- Allow corrections to extracted content while preserving the original source and correction history.
- Scan uploaded files and apply resource limits to document processing; uploaded content must never be executed as code.
- Show where files are used and provide an explicit deletion/retention policy. Removal must exclude content from new retrievals and remove derived records according to that policy; historical citations should indicate unavailable sources.
- Disclose external AI processing of attachments and make retention periods configurable before production rollout.

## Proposed implementation

Keep the existing React/TanStack application and PostgreSQL foundation. Add private object storage, a background processing queue and worker, and a document ingestion/retrieval layer.

Proposed records:

- `documents`: ownership, access scope, file metadata, storage location, content hash, and processing state.
- `document_versions`: source revisions, extraction versions, review decisions, and publication state.
- `document_chunks`: searchable content with page, image, line, or timestamp references.
- `case_attachments`: links between cases/messages and retained document versions.
- `answer_sources`: exact document versions and passages supporting an answer.
- `ingestion_jobs`: processing attempts, errors, retries, duration, and usage.

Begin with indexed text retrieval and domain-aware query handling. Add semantic retrieval where evaluated questions demonstrate a benefit. Keep permission and publication filters in every retrieval path. Avoid loading the entire document collection into application memory for each question.

## Acceptance criteria

1. Upload a text PDF to the Library, review and publish it, then answer a relevant question with a correct page citation.
2. Restart or redeploy the application and confirm the file and approved knowledge remain available.
3. Open a new case on another authorized device and retrieve the previously published knowledge without uploading it again.
4. Attach a photo of a nameplate or controller screen and identify readable content while flagging uncertain values.
5. Upload a scanned PDF and retrieve a relevant passage after OCR, with a page reference and review of uncertain extraction.
6. Attach a log and summarize its relevant event sequence with line or timestamp references, retaining any unknown timezone or ordering ambiguity.
7. Confirm that a case attachment is unavailable to unrelated users and organizations, including through search and direct download.
8. Confirm that unpublished material cannot appear in shared-library answers; authorized active-case attachments remain usable within that case.
9. Replace a document with a new revision and verify new answers use the approved revision while earlier citations preserve their version identity.
10. Delete a document and confirm it is no longer retrieved, with originals and derived records handled according to the retention policy.
11. Reject oversized, unsupported, corrupted, or otherwise disallowed files with an actionable error and no broken case state.
12. Verify partial extraction and failed processing never produce a false claim that all attachment content was analyzed.
13. Test uploaded prompt-injection content and ensure it cannot bypass permissions or alter publication controls.

## Delivery order

1. **Foundation:** repair the streaming renderer, add identity/permissions, durable cases, private storage, upload validation, and processing status.
2. **Library ingestion:** implement text PDFs and logs, source previews, publication review, persistent indexing, and citations.
3. **Case attachments:** add message attachments, cross-device case retention, and promotion to reviewed library content.
4. **Visual material:** add scanned-PDF OCR and photo analysis with uncertainty handling.
5. **Scale and quality:** add worker concurrency controls, deduplication, revision workflows, storage quotas, retrieval evaluations, and usage dashboards.

The first production release should cover the requested PDFs, photos, and logs. Track ingestion success, time until searchable, citation accuracy, retrieval quality, access-control failures, and cost per processed file and resolved case.
