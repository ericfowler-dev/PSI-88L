# Connect an existing OpenAI knowledge store

PSI-88L can use OpenAI Responses `file_search` with an existing vector store, alongside published Library passages and private case attachments. This is the server-side equivalent of adding `tools=[{"type":"file_search","vector_store_ids":["vs_..."]}]` to a Responses request. See the [official file-search guide](https://developers.openai.com/api/docs/guides/tools-file-search).

## Setup

1. Sign in as administrator and open **Settings**.
2. Select **OpenAI — Responses API** and enter the model ID, for example `gpt-4.1`.
3. Enter an OpenAI API key with access to the project containing your store. A Grok/xAI key does not authenticate with OpenAI.
4. Paste your existing `vs_...` ID into **OpenAI vector store ID (optional)** and save.
5. Choose **Check saved connection**. This checks the model list, store access, expiration, and completed file count. It does not generate an answer or search document content.
6. Ask a Desk question and expand its source references. OpenAI citations use `[F1]`, `[F2]`, etc.; local passages use `[S1]`, `[S2]`, etc. Inspect excerpts against the current original.

Clear the store field and save to disable hosted search. Switching providers clears the setting; xAI and compatible-provider requests do not receive it. `OPENAI_VECTOR_STORE_ID` can provide an initial server default for the OpenAI endpoint; an explicitly saved blank field disables that default.

## Evidence and verification

Chat calls the connected store even when local retrieval has no match. Requests use the selected model, up to eight results per search call, and request returned excerpts. Native file annotations establish citations; model-written file names alone do not become source records. Available excerpts and file IDs are retained with private case answers. Remote references do not claim a local Library revision or offer nonexistent Library downloads.

**Check knowledge** continues to search only the PSI-88L Library and ready case attachments. Use a Desk question to verify OpenAI search. A successful settings check proves metadata access, not generation capability, billing availability, or diagnostic accuracy.

For failed answers, the app shows the provider's error code/message when available, with credentials redacted. A model can be listed while generation still fails due to billing, request limits, tool permissions, or other provider errors. The integration tests use mocked Responses streams, store errors, and retained citations; live access requires your configured key and store.

## Source ownership and limits

All workspace members can use the connected store through chat. Its files are managed in OpenAI and do not pass through PSI-88L publication review. Connect only a store appropriate for shared workspace use. Library uploads are not synchronized to the store, and its originals are not imported into Library. Local case attachments remain owner-private.

This integration does not create stores, upload to OpenAI, or delete remote files. OpenAI indexing, expiration, permissions, supported file types, and storage/search charges apply separately. PSI-88L's XLSX support does not imply the same workbook is supported by hosted file search. Uploading and connecting knowledge do not retrain model weights.
