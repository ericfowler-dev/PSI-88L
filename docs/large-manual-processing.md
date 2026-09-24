# Large diagnostic manuals

Keep the manual as one PDF when it fits the 20 MB upload limit. You do not need to split it merely because it has more than 200 pages or more than 20 scanned pages.

## Recover the existing upload

1. Refresh PSI-88L after the updated application is deployed.
2. Select the failed diagnostic manual in the Library and choose **Retry processing**.
3. Watch the processed-page count. You can leave the page while processing continues.
4. Review the extracted text and OCR warnings against the original, acknowledge the review, then choose **Publish knowledge**.

The original PDF is already retained. An empty transcription is not a repair for failed extraction. The app now disables review/publication while processing has failed or is incomplete.

## How processing works

The worker reads at most 25 pages or two scanned pages per batch, stopping earlier for unusually dense text. It commits passages and the last processed page in one database transaction, releases parsing/OCR resources, and queues the next batch. A restarted worker or a retry resumes from the saved checkpoint. Other uploads can run between batches. All pages retain their original page numbers, and the manual remains one Library source.

Partial batches are excluded from answer retrieval. Completed library sources still require publication; private case evidence becomes usable only after complete extraction. Retained evidence is retrieved into model requests, rather than training the model's weights.

## Remaining limits

- Uploads remain limited to 20 MB. Oversized rendered pages still fail with an explicit error.
- OCR reads English text and can misread technical values. PDF diagrams still require visual review.
- Whole-document transcription edits and pasted notes remain limited to 500,000 characters. This is separate from PDF ingestion: longer manuals can be published directly after review. Record corrections in a separate technical note.
- Processing time depends on page complexity and OCR needs. A single pathological page may still fail; retry resumes at its batch rather than skipping content silently.
- The disk-backed pilot uses one worker. For higher throughput, use the documented PostgreSQL, object-storage, and external-worker deployment.

Verification includes a 205-page PDF with more than one million extracted characters, restart/retry checkpoints, retained original bytes, publication gating, final-page retrieval, and OCR batching on a 21-page scanned fixture.

On September 24, 2026, the revised extractor also processed all 539 pages of the user's diagnostic manual, combined in memory from the three supplied parts. It retained 555 passages and 573,802 extracted characters. The original files were unchanged, and the private manual was not added to the repository. Type checking, lint, production build, 20 backend tests, and two desktop/mobile browser workflows passed locally.
