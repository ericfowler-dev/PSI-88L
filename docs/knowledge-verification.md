# Verify retained knowledge

PSI-88L retains originals and extracted text, then retrieves relevant published passages for each answer. Uploading does not retrain the provider model. The useful proof is whether the right source text reaches the model and supports its answer.

## Check a diagnostic code

1. In Library, confirm the manual has finished processing and is **published**. Review or failed sources are not shared AI knowledge.
2. Open **Check knowledge** in Desk or Library and enter `1208:3`.
3. Look for **Exact fault-code evidence found**. Inspect the source, revision, page, and actual text. This check makes no AI request.
4. Ask the same question in Desk. Expand the answer's source references and compare the answer with the original manual.

The privately supplied manual was verified locally with the requested row on **printed page 379** (page 180 within the split file covering pages 200–399). A PDF viewer's page index can differ from the printed page number. Use the source locator and original file together.

Recognized question formats include `SPN 1208 / FMI 3`, `1208:3`, `1208/3`, `1208-3`, `spn1208 fmi3`, `FMI 3 for SPN 1208`, and `fault code 1208 3`. A chat follow-up such as “what about FMI 4?” can use the previous question's SPN. If the FMI is missing, the model is instructed to request it. Other FMI rows are not interchangeable evidence.

## Pages are not passages

The full supplied PDF has **539 pages**. A previous extraction showing **555 passages** is not evidence of missing pages: some pages produce several passages and some contain no searchable text. New extraction may add labeled table rows alongside original page text, increasing passage counts further.

Library now shows original PDF page totals, searchable passage counts, processing progress, and AI availability separately. Open the original PDF and use the extracted-evidence search to inspect specific values. A 500,000-character whole-document editing limit does not truncate the retained PDF or its searchable passages. Add a separate reviewed technical note for corrections to a long manual.

## Existing uploads and re-extraction

The retrieval fix works with existing extracted text; do not upload duplicate manuals solely for this update. If a source is failed, **Retry processing** resumes its existing job.

**Re-extract original** is optional when you want the new table handling or need to rebuild extraction. It preserves the original and historical revisions, creates a new revision, and temporarily removes that source from current AI retrieval. Review the new extraction and publish it again. Any manually corrected transcription is still available in its historical revision but is not carried into the newly extracted text.

The table recognizer handles the diagnostic manual's bordered, labeled columns. Ordinary page extraction remains alongside structured rows. This is not universal table or diagram understanding; scanned text uses English OCR and needs review.

## If an answer still lacks evidence

- No exact match in **Check knowledge**: check publication, processing progress, the extracted source text, and the original page. A related SPN result does not confirm the requested FMI.
- Exact evidence exists but the answer is poor: inspect its references and try a new case to separate the result from earlier conversation context. Record the question and returned evidence for investigation.
- Provider error: check Settings, the provider's actual API model ID, and the saved connection. The Grok project name `PSI-88L` is not itself an API model identifier.

Verification included extraction of the full private manual, notation variants, legacy text compatibility, and the actual evidence in a mocked provider request. No live Grok response was validated as part of these checks. Retrieval remains lexical with explicit fault-code handling; broader semantic retrieval and a larger evaluation set remain scaling improvements.
