import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { handleAPI } from "../backend/api.ts";
import { database, closeDatabase } from "../backend/db.ts";
import { processNextJob } from "../backend/worker.ts";
import { extract, splitPassages, validateFile } from "../backend/extract.ts";
import { searchTerms } from "../backend/knowledge.ts";
import { RichText } from "../src/components/rich-text.tsx";
import { putFile, readStoredFile } from "../backend/storage.ts";
process.env.DATA_DIR = `.test-data/core-${randomUUID()}`;
process.env.SETUP_TOKEN = "integration-setup-token";
process.env.WORKER_MODE = "external";
process.env.ALLOW_LOCAL_AI = "true";
process.env.NODE_ENV = "test";
delete process.env.DATABASE_URL;
delete process.env.S3_BUCKET;
let cookie = "";
let readerCookie = "";
let documentId = "";
let caseId = "";
async function request(path: string, method = "GET", body?: unknown, session = cookie) {
  return handleAPI(
    new Request(`http://localhost:8080${path}`, {
      method,
      headers: {
        ...(session ? { cookie: session } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}
async function ok(response: Response) {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}
after(async () => {
  await closeDatabase();
});
test("persistent knowledge application and protected API", async (t) => {
  await t.test("requires authentication and protects initial setup", async () => {
    assert.equal((await request("/api/knowledge")).status, 401);
    assert.equal(
      (
        await request("/api/setup", "POST", {
          email: "admin@example.test",
          name: "Administrator",
          password: "test-password-1234",
        })
      ).status,
      403,
    );
    const response = await request("/api/setup", "POST", {
      email: "admin@example.test",
      name: "Administrator",
      password: "test-password-1234",
      setupToken: process.env.SETUP_TOKEN,
    });
    await ok(response);
    cookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await request("/api/setup", "POST", {
          email: "other@example.test",
          name: "Other",
          password: "test-password-1234",
          setupToken: process.env.SETUP_TOKEN,
        })
      ).status,
      409,
    );
    const crossSite = await handleAPI(
      new Request("http://localhost:8080/api/cases", {
        method: "POST",
        headers: { cookie, origin: "https://untrusted.example" },
      }),
    );
    assert.equal(crossSite.status, 403);
  });
  await t.test("retains text, queues extraction, and requires publication", async () => {
    const created = await ok(
      await request("/api/knowledge/text", "POST", {
        title: "Commissioning checklist",
        sourceNote: "Integration fixture — no operational guidance",
        content:
          "HT coolant circuit commissioning record. The documented reference marker is QUARTZ-88.\nLT intercooler inspection is recorded on the next worksheet.\nElectrical starter no crank observations belong in the case.",
      }),
    );
    documentId = created.document.id;
    assert.equal(created.document.status, "queued");
    assert.equal(
      (
        await ok(
          await request("/api/knowledge/search", "POST", { question: "HT commissioning marker" }),
        )
      ).sources.length,
      0,
    );
    assert.equal(await processNextJob(), true);
    const detail = await ok(await request(`/api/knowledge/${documentId}`));
    assert.equal(detail.document.status, "review");
    assert.ok(detail.chunks[0].content.includes("QUARTZ-88"));
    assert.equal(
      (await request(`/api/knowledge/${documentId}`, "PATCH", { revision: 1, publish: true }))
        .status,
      400,
    );
    await ok(
      await request(`/api/knowledge/${documentId}`, "PATCH", {
        revision: 1,
        publish: true,
        acknowledged: true,
      }),
    );
    const found = await ok(await request("/api/knowledge/search", "POST", { question: "HT" }));
    assert.equal(found.sources[0].documentId, documentId);
    assert.match(found.sources[0].locator, /Lines/);
    assert.ok(searchTerms("It will not turn over").includes("starter"));
    assert.ok(searchTerms("LT").includes("intercooler"));
  });
  await t.test("protects drafts and private case attachments from other users", async () => {
    await ok(
      await request("/api/users", "POST", {
        name: "Technician",
        email: "tech@example.test",
        password: "reader-password-1234",
        role: "reader",
      }),
    );
    const login = await request("/api/login", "POST", {
      email: "tech@example.test",
      password: "reader-password-1234",
    });
    await ok(login);
    readerCookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await request("/api/settings", "GET", undefined, readerCookie)).status, 403);
    assert.equal(
      (
        await request(
          "/api/knowledge/text",
          "POST",
          { title: "Unauthorized", content: "Must not be accepted." },
          readerCookie,
        )
      ).status,
      403,
    );
    caseId = (await ok(await request("/api/cases", "POST"))).id;
    const attached = await ok(
      await request("/api/knowledge/text", "POST", {
        title: "Private event log",
        content: "Private marker AMBER-64 at 12:00. Alarm cleared at 12:02.",
        caseId,
      }),
    );
    await processNextJob();
    assert.equal(
      (await request(`/api/knowledge/${attached.document.id}`, "GET", undefined, readerCookie))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/knowledge/${attached.document.id}/download`,
          "GET",
          undefined,
          readerCookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(`/api/cases/${caseId}`, "GET", undefined, readerCookie)).status,
      404,
    );
    assert.equal(
      (await ok(await request("/api/knowledge/search", "POST", { question: "AMBER" }))).sources
        .length,
      0,
    );
    assert.ok(
      (await ok(await request("/api/knowledge/search", "POST", { question: "AMBER", caseId })))
        .sources.length > 0,
    );
    const result = await request("/api/chat", "POST", { caseId, question: "AMBER?" });
    assert.equal(result.status, 503);
  });
  await t.test("preserves revisions and rejects stale edits", async () => {
    await ok(
      await request(`/api/knowledge/${documentId}`, "PATCH", {
        revision: 1,
        content: "HT commissioning reference changed to QUARTZ-99.",
        publish: true,
        acknowledged: true,
      }),
    );
    const old = await ok(await request(`/api/knowledge/${documentId}?revision=1`));
    assert.ok(old.chunks[0].content.includes("QUARTZ-88"));
    assert.equal(
      (
        await request(`/api/knowledge/${documentId}`, "PATCH", {
          revision: 1,
          publish: true,
          acknowledged: true,
        })
      ).status,
      409,
    );
    const current = await ok(
      await request("/api/knowledge/search", "POST", { question: "HT commissioning" }),
    );
    assert.equal(current.sources[0].revision, 2);
    assert.ok(current.sources[0].content.includes("QUARTZ-99"));
  });
  await t.test("retains original files and sessions across database restart", async () => {
    const original = await request(`/api/knowledge/${documentId}/download`);
    assert.match(await original.text(), /QUARTZ-88/);
    await closeDatabase();
    await database();
    const detail = await ok(await request(`/api/knowledge/${documentId}`));
    assert.equal(detail.document.revision, 2);
    assert.equal(detail.document.status, "published");
  });
  await t.test(
    "sends actual retrieved evidence through configurable provider and persists streamed answers",
    async () => {
      let received: any;
      const server = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        received = JSON.parse(raw);
        assert.equal(req.headers.authorization, "Bearer test-provider-secret");
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "The uploaded commissioning reference is QUARTZ-99 [S1]." } }] })}\n\n`,
        );
        res.end(
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 123, completion_tokens: 14 } })}\n\ndata: [DONE]\n\n`,
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const port = (server.address() as { port: number }).port;
        const saved = await ok(
          await request("/api/settings", "PUT", {
            provider: "compatible",
            model: "integration-model",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            apiKey: "test-provider-secret",
          }),
        );
        assert.equal(saved.ai.hasKey, true);
        assert.equal(saved.ai.apiKey, undefined);
        const stored = await (
          await database()
        ).query<{ value: unknown }>("select value from app_settings where id='ai'");
        assert.ok(!JSON.stringify(stored).includes("test-provider-secret"));
        const response = await request("/api/chat", "POST", {
          caseId,
          question: "What is the HT commissioning reference?",
        });
        assert.equal(response.status, 200);
        const events = await response.text();
        assert.ok(events.includes("QUARTZ-99"));
        assert.ok(events.includes('"type":"done"'));
        assert.ok(received.messages[0].content.includes("QUARTZ-99"));
        assert.ok(!received.messages[0].content.includes("AMBER-64"));
        const record = await ok(await request(`/api/cases/${caseId}`));
        assert.equal(record.messages.at(-1).status, "complete");
        assert.ok(record.messages.at(-1).sources[0].locator);
      } finally {
        server.close();
        await once(server, "close");
      }
    },
  );
  await t.test(
    "isolates environment credentials when changing providers and clearing keys",
    async () => {
      process.env.OPENAI_API_KEY = "environment-test-secret";
      try {
        const switched = await ok(
          await request("/api/settings", "PUT", {
            provider: "compatible",
            model: "test-model",
            baseUrl: "https://other.example/v1",
          }),
        );
        assert.equal(switched.ai.hasKey, false);
        const original = await ok(
          await request("/api/settings", "PUT", {
            provider: "openai",
            model: "test-model",
          }),
        );
        assert.equal(original.ai.hasKey, true);
        const cleared = await ok(
          await request("/api/settings", "PUT", {
            provider: "openai",
            model: "test-model",
            clearKey: true,
          }),
        );
        assert.equal(cleared.ai.hasKey, false);
        assert.equal(
          (
            await request("/api/settings", "PUT", {
              provider: "compatible",
              model: "test-model",
              baseUrl: "invalid-url",
            })
          ).status,
          400,
        );
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    },
  );
  await t.test(
    "uses OpenAI Responses for evidence and image analysis while retaining review control",
    async () => {
      const canvas = createCanvas(800, 150);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, 800, 150);
      context.fillStyle = "black";
      context.font = "40px Arial";
      context.fillText("TEST NAMEPLATE QUARTZ", 30, 90);
      const bytes = canvas.toBuffer("image/png");
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], "plate.png", { type: "image/png" }));
      const uploaded = await ok(
        await handleAPI(
          new Request("http://localhost:8080/api/knowledge/upload", {
            method: "POST",
            headers: { cookie },
            body: form,
          }),
        ),
      );
      await processNextJob();
      const imageId = uploaded.document.id;
      assert.equal(
        (await request(`/api/knowledge/${imageId}/preview`, "GET", undefined, readerCookie)).status,
        404,
      );
      const preview = await request(`/api/knowledge/${imageId}/preview`);
      assert.equal(preview.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
      await ok(
        await request("/api/settings", "PUT", {
          provider: "openai",
          model: "test-vision-model",
          apiKey: "test-openai-secret",
        }),
      );
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "https://api.openai.com/v1/responses");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.store, false);
        calls++;
        if (payload.stream) {
          assert.match(payload.instructions, /QUARTZ-99/);
          const encoder = new TextEncoder();
          // CRLF deliberately split across transport chunks.
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'data: {"type":"response.output_text.delta","delta":"Reference QUARTZ-99 [S1]."}\r',
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    '\n\r\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":42,"output_tokens":8}}}\r\n\r\n',
                  ),
                );
                controller.close();
              },
            }),
          );
        }
        assert.equal(
          payload.input[0].content[1].image_url,
          `data:image/png;base64,${bytes.toString("base64")}`,
        );
        return Response.json({
          status: "completed",
          output: [
            {
              content: [
                { type: "output_text", text: "Visible test nameplate. Draft marker JADE-12." },
              ],
            },
          ],
          usage: { input_tokens: 21, output_tokens: 9 },
        });
      };
      try {
        const answer = await request("/api/chat", "POST", {
          caseId,
          question: "HT commissioning reference?",
        });
        assert.match(await answer.text(), /"status":"complete"/);
        const analyzed = await ok(await request(`/api/knowledge/${imageId}/analyze-image`, "POST"));
        assert.equal(analyzed.document.revision, 2);
        assert.equal(analyzed.document.status, "review");
        const detail = await ok(await request(`/api/knowledge/${imageId}`));
        assert.match(
          detail.chunks.map((p: { content: string }) => p.content).join(" "),
          /unverified.*review against the original/s,
        );
        assert.equal(
          (await ok(await request("/api/knowledge/search", "POST", { question: "JADE" }))).sources
            .length,
          0,
        );
        assert.equal(calls, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
  await t.test("persists provider failures and cancels an in-flight answer", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response('data: {"type":"response.output_text.delta","delta":"Partial evidence"}\n\n');
      const interrupted = await request("/api/chat", "POST", {
        caseId,
        question: "HT commissioning?",
      });
      assert.match(await interrupted.text(), /ended before completion/);
      let record = await ok(await request(`/api/cases/${caseId}`));
      assert.equal(record.messages.at(-1).status, "error");
      assert.match(record.messages.at(-1).content, /Partial evidence/);
      let sawAbort = false;
      globalThis.fetch = async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              const aborted = () => {
                sawAbort = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              };
              if (init?.signal?.aborted) aborted();
              else init?.signal?.addEventListener("abort", aborted, { once: true });
            },
          }),
        );
      const response = await request("/api/chat", "POST", {
        caseId,
        question: "HT commissioning?",
      });
      const reader = response.body!.getReader();
      await reader.read();
      // Give the provider call time to start before cancelling its consumer.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await reader.cancel();
      for (let attempt = 0; attempt < 40; attempt++) {
        record = await ok(await request(`/api/cases/${caseId}`));
        if (record.messages.at(-1).status === "error") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(sawAbort, true);
      assert.equal(record.messages.at(-1).status, "error");
      assert.match(record.messages.at(-1).content, /Answer stopped/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  await t.test(
    "large manuals checkpoint, resume, and retain all page citations without early publication",
    async () => {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let n = 1; n <= 205; n++) {
        const page = pdf.addPage();
        page.drawText(
          `Manual page ${n} inspection record with retained technical evidence.\n`.repeat(90),
          { x: 20, y: 740, size: 6, lineHeight: 7, font },
        );
        if (n === 205)
          page.drawText("FINALMANUALMARKER diagnostic reference", {
            x: 20,
            y: 50,
            size: 10,
            font,
          });
      }
      const original = Buffer.from(await pdf.save());
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(original)], { type: "application/pdf" }),
        "large-manual.pdf",
      );
      const uploaded = await ok(
        await handleAPI(
          new Request("http://localhost:8080/api/knowledge/upload", {
            method: "POST",
            headers: { cookie },
            body: form,
          }),
        ),
      );
      const id = uploaded.document.id;
      await processNextJob();
      let detail = await ok(await request(`/api/knowledge/${id}`));
      assert.equal(detail.document.status, "processing");
      assert.equal(detail.document.processed_pages, 25);
      assert.equal(detail.document.total_pages, 205);
      assert.equal(
        (
          await request(`/api/knowledge/${id}`, "PATCH", {
            revision: 1,
            publish: true,
            acknowledged: true,
          })
        ).status,
        409,
      );
      const firstChunk = detail.chunks[0].id;
      // A crashed worker's expired lease must resume after the committed checkpoint.
      await (
        await database()
      ).query(
        "update ingestion_jobs set state='processing',lease_until=now()-interval '1 minute',lease_token='old-worker',attempts=1 where document_id=$1",
        [id],
      );
      await closeDatabase();
      await processNextJob();
      detail = await ok(await request(`/api/knowledge/${id}`));
      assert.equal(detail.document.processed_pages, 50);
      assert.equal(detail.chunks[0].id, firstChunk);
      await (
        await database()
      ).query("update ingestion_jobs set state='failed' where document_id=$1", [id]);
      await (
        await database()
      ).query("update documents set status='failed',error='interrupted fixture' where id=$1", [id]);
      assert.equal(
        (
          await request(`/api/knowledge/${id}`, "PATCH", {
            revision: 1,
            publish: true,
            acknowledged: true,
          })
        ).status,
        409,
      );
      await ok(await request(`/api/knowledge/${id}/retry`, "POST"));
      for (let batch = 0; batch < 7; batch++) await processNextJob();
      detail = await ok(await request(`/api/knowledge/${id}`));
      assert.equal(detail.document.status, "review");
      assert.equal(detail.document.processed_pages, 205);
      assert.equal(detail.chunks[0].id, firstChunk);
      assert.ok(
        detail.chunks.reduce((size: number, c: { content: string }) => size + c.content.length, 0) >
          1_000_000,
      );
      assert.equal(
        new Set(detail.chunks.map((c: { ordinal: number }) => c.ordinal)).size,
        detail.chunks.length,
      );
      assert.ok(detail.chunks.at(-1).locator.startsWith("Page 205"));
      assert.equal(
        (
          await ok(
            await request("/api/knowledge/search", "POST", { question: "FINALMANUALMARKER" }),
          )
        ).sources.length,
        0,
      );
      await ok(
        await request(`/api/knowledge/${id}`, "PATCH", {
          revision: 1,
          publish: true,
          acknowledged: true,
        }),
      );
      const found = await ok(
        await request("/api/knowledge/search", "POST", { question: "FINALMANUALMARKER" }),
      );
      assert.ok(found.sources.some((s: { locator: string }) => s.locator.startsWith("Page 205")));
      assert.deepEqual(
        Buffer.from(await (await request(`/api/knowledge/${id}/download`)).arrayBuffer()),
        original,
      );
    },
  );
  await t.test(
    "checks saved API credentials and model IDs without generating an answer",
    async () => {
      assert.equal(
        (await request("/api/settings/test", "POST", undefined, readerCookie)).status,
        403,
      );
      const invalid = await request("/api/settings", "PUT", { provider: "xai", model: "PSI-88L" });
      assert.equal(invalid.status, 400);
      assert.match((await invalid.json()).error, /workspace name/);
      await ok(
        await request("/api/settings", "PUT", {
          provider: "xai",
          model: "grok-4.7",
          apiKey: "test-xai-secret",
        }),
      );
      const originalFetch = globalThis.fetch;
      let providerStatus = 200;
      let listed = true;
      try {
        globalThis.fetch = async (input, init) => {
          assert.equal(String(input), "https://api.x.ai/v1/models");
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-xai-secret");
          assert.equal(init?.body, undefined);
          return Response.json(
            { data: [{ id: listed ? "grok-4.7" : "another-model" }] },
            { status: providerStatus },
          );
        };
        const connected = await ok(await request("/api/settings/test", "POST"));
        assert.match(connected.message, /grok-4.7 is listed/);
        assert.ok(!JSON.stringify(connected).includes("test-xai-secret"));
        listed = false;
        const missing = await request("/api/settings/test", "POST");
        assert.equal(missing.status, 400);
        assert.match((await missing.json()).error, /was not listed/);
        providerStatus = 401;
        assert.match(
          (await (await request("/api/settings/test", "POST")).json()).error,
          /API key and model access/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
  await t.test("removal excludes content from retrieval", async () => {
    await ok(await request(`/api/knowledge/${documentId}`, "DELETE"));
    assert.equal((await request(`/api/knowledge/${documentId}/download`)).status, 404);
    assert.equal(
      (await ok(await request("/api/knowledge/search", "POST", { question: "QUARTZ" }))).sources
        .length,
      0,
    );
  });
  await t.test("retries retained original-file deletion after restart", async () => {
    const key = `${randomUUID()}/${randomUUID()}`;
    await putFile(key, Buffer.from("cleanup fixture"), "text/plain");
    await (await database()).query("insert into file_deletions(storage_key) values($1)", [key]);
    await closeDatabase();
    await processNextJob();
    await assert.rejects(readStoredFile(key), { code: "ENOENT" });
    assert.equal(
      (await (await database()).query("select * from file_deletions where storage_key=$1", [key]))
        .length,
      0,
    );
  });
});
test("file extraction and partial-stream rendering", async (t) => {
  await t.test("extracts DOCX paragraphs", async () => {
    const result = await extract("reference.docx", await readFile("tests/fixtures/reference.docx"));
    assert.match(result.passages[0].content, /COBALT-22/);
    assert.match(result.passages[0].locator, /DOCX text/);
  });
  await t.test("parses real PDF text with page citations", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage();
    page.drawText("HT commissioning reference QUARTZ-88 for the integration fixture.", {
      x: 50,
      y: 700,
      size: 14,
      font,
    });
    const result = await extract("reference.pdf", Buffer.from(await pdf.save()));
    assert.ok(result.passages.some((p) => p.content.includes("QUARTZ-88")));
    assert.ok(result.passages[0].locator.includes("Page 1"));
  });
  await t.test(
    "reads UTF-16 logs, rejects binary files, and preserves line references",
    async () => {
      const result = await extract(
        "events.log",
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from("12:00 EVENT_A\n12:02 EVENT_B", "utf16le"),
        ]),
      );
      assert.ok(result.passages[0].content.includes("EVENT_B"));
      assert.match(result.passages[0].locator, /1–2/);
      assert.throws(() => validateFile("fake.pdf", Buffer.from("not a PDF")));
      assert.throws(() => validateFile("payload.exe", Buffer.from("content")));
      assert.equal(splitPassages("x".repeat(6000)).length, 4);
    },
  );
  await t.test("renders partial Markdown tables without hanging", () => {
    assert.match(
      renderToStaticMarkup(createElement(RichText, { text: "| Name | Value |" })),
      /Name/,
    );
    assert.match(
      renderToStaticMarkup(
        createElement(RichText, { text: "| Name | Value |\n| --- | --- |\n| A | B |" }),
      ),
      /<table/,
    );
  });
  await t.test(
    "extracts real text from a photo fixture with OCR",
    { timeout: 120000 },
    async () => {
      const canvas = createCanvas(1000, 220);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, 1000, 220);
      context.fillStyle = "black";
      context.font = "42px Arial";
      context.fillText("PSI 88L TEST RECORD", 40, 80);
      context.fillText("REFERENCE QUARTZ 88", 40, 150);
      const result = await extract("nameplate.png", canvas.toBuffer("image/png"));
      assert.ok(result.passages.some((p) => /QUARTZ/i.test(p.content)));
      assert.ok(result.warnings.length);
      const pdf = await PDFDocument.create();
      const photo = await pdf.embedPng(canvas.toBuffer("image/png"));
      pdf.addPage([1000, 220]).drawImage(photo, { x: 0, y: 0, width: 1000, height: 220 });
      const scanned = await extract("scanned.pdf", Buffer.from(await pdf.save()));
      assert.ok(scanned.passages.some((p) => /QUARTZ/i.test(p.content)));
      assert.ok(scanned.warnings.some((warning) => warning.includes("Page 1 was read using OCR")));
      // A manual with more than 20 scanned pages is processed across bounded OCR batches.
      for (let n = 1; n < 21; n++)
        pdf.addPage([1000, 220]).drawImage(photo, { x: 0, y: 0, width: 1000, height: 220 });
      const manualBytes = Buffer.from(await pdf.save());
      const first = await extract("scanned-manual.pdf", manualBytes, {
        startPage: 1,
        maxPages: 25,
        maxOcrPages: 2,
      });
      assert.equal(first.processedPages, 2);
      assert.equal(first.totalPages, 21);
      assert.equal(first.complete, false);
      const last = await extract("scanned-manual.pdf", manualBytes, {
        startPage: 21,
        maxPages: 25,
        maxOcrPages: 2,
      });
      assert.equal(last.complete, true);
      assert.ok(
        last.passages.some((p) => p.locator.startsWith("Page 21") && /QUARTZ/i.test(p.content)),
      );
    },
  );
});
