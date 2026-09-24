import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { database } from "./db.ts";
import {
  audit,
  currentUser,
  login,
  logout,
  needsSetup,
  passwordHash,
  rateLimit,
  requireAdmin,
  requireEditor,
  requireUser,
  sameOrigin,
  type User,
} from "./auth.ts";
import { HttpError, check, jsonBody, text } from "./errors.ts";
import {
  getDocument,
  listDocuments,
  ownCase,
  retrieve,
  updateDocument,
  uploadDocument,
} from "./knowledge.ts";
import { deleteStoredFile, readStoredFile } from "./storage.ts";
import { MAX_FILE_BYTES } from "./extract.ts";
import { faultCode } from "./diagnostics.ts";
import {
  aiConfig,
  checkAIConnection,
  describeImage,
  generateAnswer,
  publicAIConfig,
  saveAIConfig,
} from "./ai.ts";
import { startEmbeddedWorker } from "./worker.ts";

async function upload(request: Request, user: User) {
  await rateLimit(`upload:${user.id}`, 30, 3600);
  const type = request.headers.get("content-type") || "";
  check(type.startsWith("multipart/form-data"), 415, "Use multipart/form-data with a file field.");
  const reader = request.body?.getReader();
  check(reader, 400, "Choose a file to upload.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_FILE_BYTES + 16384) {
      await reader.cancel();
      throw new HttpError(413, "Files must be no larger than 20 MB.");
    }
    chunks.push(value);
  }
  const form = await new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": type },
  }).formData();
  const file = form.get("file");
  check(file && typeof file !== "string", 400, "Choose a file to upload.");
  const filename = basename(file.name.replace(/\\/g, "/"))
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32 && character !== '"')
    .join("")
    .slice(0, 160);
  const title = text(form.get("title") || filename, "Title", 2, 200);
  const sourceNote = text(form.get("sourceNote") || "User-provided source", "Source note", 1, 1000);
  return Response.json(
    await uploadDocument(
      user,
      filename,
      Buffer.from(await file.arrayBuffer()),
      title,
      sourceNote,
      typeof form.get("caseId") === "string" && form.get("caseId")
        ? String(form.get("caseId"))
        : undefined,
    ),
    { status: 201 },
  );
}

async function chat(request: Request, user: User) {
  const body = await jsonBody(request);
  const question = text(body.question, "Question", 1, 8000);
  const caseId = text(body.caseId, "Case ID", 10, 80);
  await ownCase(caseId, user);
  await rateLimit(`chat:${user.id}`, 40, 600);
  await rateLimit("chat:workspace", 500, 3600);
  const db = await database();
  const config = await aiConfig();
  check(
    config.apiKey && config.model,
    503,
    "Connect an AI provider in Settings before asking. Uploaded knowledge remains saved.",
  );
  const history = (
    await db.query<{ role: string; content: string }>(
      "select role,content from messages where case_id=$1 and status='complete' order by sequence desc limit 12",
      [caseId],
    )
  ).reverse();
  const previousQuestion = [...history].reverse().find((m) => m.role === "user")?.content || "";
  const sources = await retrieve(
    question,
    user,
    caseId,
    question.length < 100 ? previousQuestion : "",
  );
  const userId = randomUUID();
  const assistantId = randomUUID();
  await db.transaction(async (query) => {
    await query("select id from cases where id=$1 for update", [caseId]);
    await query(
      "update messages set status='error',content=content || E'\n\nThis answer was interrupted.' where case_id=$1 and status='pending' and created_at < now()-interval '5 minutes'",
      [caseId],
    );
    check(
      !(await query("select id from messages where case_id=$1 and status='pending'", [caseId]))
        .length,
      409,
      "An answer is already running in this case.",
    );
    await query("insert into messages(id,case_id,role,content) values($1,$2,'user',$3)", [
      userId,
      caseId,
      question,
    ]);
    await query(
      "insert into messages(id,case_id,role,content,sources,status) values($1,$2,'assistant','',$3,'pending')",
      [assistantId, caseId, JSON.stringify(sources)],
    );
    await query(
      "update cases set updated_at=now(),title=case when title='New case' then $2 else title end where id=$1",
      [caseId, question.slice(0, 100)],
    );
  });
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  const encoder = new TextEncoder();
  let alive = true;
  const stream = new ReadableStream({
    start(streamController) {
      void (async () => {
        const send = (event: unknown) => {
          if (alive) streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        let answer = "";
        let status = "complete";
        let usage = { input: 0, output: 0 };
        let answerSources = sources;
        try {
          send({ type: "start", userId, assistantId, sources });
          if (!sources.length && !(config.provider === "openai" && config.vectorStoreId)) {
            answer =
              "I could not find matching evidence in the published library or this case’s processed attachments. Add or publish a relevant source, or include the exact component, alarm, and measurements in your question. I cannot provide a supported technical procedure from the available material.";
            send({ type: "delta", text: answer });
          } else {
            for await (const event of generateAnswer(
              [...history, { role: "user", content: question }],
              sources,
              signal,
              config,
            )) {
              if (event.text) {
                answer += event.text;
                send({ type: "delta", text: event.text });
              }
              if (event.usage) usage = event.usage;
              if (event.sources) {
                answerSources = [...sources, ...event.sources];
                send({ type: "sources", sources: answerSources });
              }
              if (event.replaceText !== undefined) {
                answer = event.replaceText;
                send({ type: "replace", text: answer });
              }
            }
            check(answer.trim(), 502, "The AI returned an empty answer.");
            const validCitations = new Set(
              answerSources.map((source, index) => source.citation || `S${index + 1}`),
            );
            const invalid = [...answer.matchAll(/\[([SF]\d+)\]/g)].some(
              (m) => !validCitations.has(m[1]),
            );
            if (invalid) {
              const note =
                "\n\nSome source references could not be verified. Review the provided source passages before using this answer.";
              answer += note;
              send({ type: "delta", text: note });
            }
          }
        } catch (error) {
          status = "error";
          const message = signal.aborted
            ? "Answer stopped. Partial text is retained."
            : error instanceof Error
              ? error.message
              : "The answer could not be completed.";
          answer += `${answer ? "\n\n" : ""}${message}`;
          send({ type: "error", error: message });
        } finally {
          try {
            await db.query("update messages set content=$2,status=$3,sources=$4 where id=$1", [
              assistantId,
              answer,
              status,
              JSON.stringify(answerSources),
            ]);
            await db.query(
              "insert into usage_events(id,user_id,provider,model,input_tokens,output_tokens) values($1,$2,$3,$4,$5,$6)",
              [randomUUID(), user.id, config.provider, config.model, usage.input, usage.output],
            );
            send({ type: "done", status });
          } finally {
            if (alive) streamController.close();
          }
        }
      })().catch(() => {
        if (alive) {
          alive = false;
          streamController.error(new Error("The answer could not be saved."));
        }
      });
    },
    cancel() {
      alive = false;
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function dispatch(request: Request): Promise<Response> {
  sameOrigin(request);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  const db = await database();
  startEmbeddedWorker();
  if (path === "/api/health" && method === "GET") {
    await db.query("select 1");
    return Response.json({ ok: true });
  }
  if (path === "/api/session" && method === "GET")
    return Response.json({
      user: await currentUser(request),
      needsSetup: await needsSetup(),
      setupTokenRequired: !!process.env.SETUP_TOKEN || process.env.NODE_ENV === "production",
    });
  if (path === "/api/login" && method === "POST") return login(await jsonBody(request), request);
  if (path === "/api/setup" && method === "POST")
    return login(await jsonBody(request), request, true);
  if (path === "/api/logout" && method === "POST") return logout(request);
  const user = await requireUser(request);
  if (path === "/api/status" && method === "GET") {
    const counts = (
      await db.query(
        "select count(*) filter(where status='published')::int as published,count(*) filter(where status in ('queued','processing'))::int as processing from documents where case_id is null and status<>'deleted'",
      )
    )[0];
    const { configured, provider, model } = await publicAIConfig();
    return Response.json({ ...counts, ai: { configured, provider, model } });
  }
  if (path === "/api/knowledge" && method === "GET")
    return Response.json({
      documents: await listDocuments(
        user,
        url.searchParams.get("q")?.slice(0, 200),
        url.searchParams.get("caseId") || undefined,
      ),
    });
  if (path === "/api/knowledge/upload" && method === "POST") return upload(request, user);
  if (path === "/api/knowledge/text" && method === "POST") {
    const body = await jsonBody(request, 600_000);
    const title = text(body.title, "Title", 2, 200);
    const content = text(body.content, "Text", 1, 500_000);
    await rateLimit(`upload:${user.id}`, 30, 3600);
    return Response.json(
      await uploadDocument(
        user,
        `${title.replace(/[^a-z0-9-]/gi, "-").slice(0, 100)}.txt`,
        Buffer.from(content),
        title,
        text(body.sourceNote || "User-provided note", "Source note", 1, 1000),
        typeof body.caseId === "string" ? body.caseId : undefined,
      ),
      { status: 201 },
    );
  }
  if (path === "/api/knowledge/search" && method === "POST") {
    const body = await jsonBody(request);
    const question = text(body.question, "Search", 1, 1000);
    const sources = await retrieve(
      question,
      user,
      typeof body.caseId === "string" ? body.caseId : undefined,
    );
    return Response.json({
      sources,
      requestedCode: faultCode(question) || null,
      exactCodeMatch: sources.some((source) => source.match === "exact_code"),
      message: sources.length
        ? "These are the saved passages that would be supplied to the AI. Check them against the original before relying on technical values."
        : "No published evidence matched. Check that the manual is uploaded, processed, and published. This check does not call the AI.",
    });
  }
  const documentMatch = path.match(
    /^\/api\/knowledge\/([a-f0-9-]+)(\/download|\/preview|\/retry|\/reprocess|\/analyze-image)?$/,
  );
  if (documentMatch) {
    const [, id, action] = documentMatch;
    const doc = await getDocument(id, user);
    if (action === "/preview" && method === "GET") {
      check(
        doc.media_type.startsWith("image/") || doc.media_type === "application/pdf",
        400,
        "Only PDF and image sources support inline preview.",
      );
      return new Response(new Uint8Array(await readStoredFile(doc.storage_key)), {
        headers: {
          "Content-Type": doc.media_type,
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (action === "/analyze-image" && method === "POST") {
      if (!doc.case_id) requireEditor(user);
      check(doc.media_type.startsWith("image/"), 400, "Visual analysis requires an image source.");
      check(
        ["review", "published"].includes(doc.status),
        409,
        "Wait for OCR processing before visual analysis.",
      );
      await rateLimit(`vision:${user.id}`, 10, 3600);
      const result = await describeImage(
        await readStoredFile(doc.storage_key),
        doc.media_type,
        request.signal,
      );
      const chunks = await db.query<{ content: string }>(
        "select content from document_chunks where document_id=$1 and revision=$2 order by ordinal",
        [id, doc.revision],
      );
      const updated = await updateDocument(
        id,
        {
          revision: doc.revision,
          content:
            `${chunks.map((c) => c.content).join("\n\n")}\n\nAI draft visual description — unverified, review against the original:\n${result.content}`.trim(),
          publish: false,
        },
        user,
      );
      await db.query(
        "insert into usage_events(id,user_id,provider,model,input_tokens,output_tokens) values($1,$2,$3,$4,$5,$6)",
        [randomUUID(), user.id, result.provider, result.model, result.input, result.output],
      );
      return Response.json({ document: updated });
    }
    if (action === "/download" && method === "GET")
      return new Response(new Uint8Array(await readStoredFile(doc.storage_key)), {
        headers: {
          "Content-Type": doc.media_type,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    if (action === "/reprocess" && method === "POST") {
      if (!doc.case_id) requireEditor(user);
      await db.transaction(async (query) => {
        const updated = await query(
          "update documents set status='queued',revision=revision+1,error=null,warnings='[]',processed_pages=0,total_pages=0,updated_at=now() where id=$1 and status in ('review','published','failed') returning id",
          [id],
        );
        check(updated.length, 409, "Wait for processing to finish before extracting again.");
        await query(
          "insert into ingestion_jobs(id,document_id) values($1,$2) on conflict(document_id) do update set state='queued',attempts=0,lease_until=null,lease_token=null,created_at=now()",
          [randomUUID(), id],
        );
      });
      await audit(user, "document.reprocess", id);
      return Response.json({ ok: true });
    }
    if (action === "/retry" && method === "POST") {
      if (!doc.case_id) requireEditor(user);
      check(doc.status === "failed", 409, "Only failed sources can be retried.");
      await db.transaction(async (query) => {
        const updated = await query(
          "update documents set status='queued',error=null where id=$1 and status='failed' returning id",
          [id],
        );
        check(updated.length, 409, "This source has changed. Reload before retrying.");
        await query(
          "update ingestion_jobs set state='queued',attempts=0,lease_until=null,lease_token=null where document_id=$1",
          [id],
        );
      });
      return Response.json({ ok: true });
    }
    if (!action && method === "GET") {
      const revision = url.searchParams.has("revision")
        ? Number(url.searchParams.get("revision"))
        : doc.revision;
      check(
        Number.isInteger(revision) && revision > 0 && revision <= doc.revision,
        400,
        "Invalid revision.",
      );
      return Response.json({
        document: doc,
        revision,
        chunks: await db.query(
          "select id,ordinal,locator,content from document_chunks where document_id=$1 and revision=$2 order by ordinal",
          [id, revision],
        ),
      });
    }
    if (!action && method === "PATCH")
      return Response.json({
        document: await updateDocument(id, await jsonBody(request, 600_000), user),
      });
    if (!action && method === "DELETE") {
      if (!doc.case_id) requireEditor(user);
      await db.transaction(async (query) => {
        await query("update documents set status='deleted',updated_at=now() where id=$1", [id]);
        await query("delete from ingestion_jobs where document_id=$1", [id]);
        await query("delete from document_chunks where document_id=$1", [id]);
        await query("insert into file_deletions(storage_key) values($1) on conflict do nothing", [
          doc.storage_key,
        ]);
      });
      let cleanupPending = false;
      try {
        await deleteStoredFile(doc.storage_key);
        await db.query("delete from file_deletions where storage_key=$1", [doc.storage_key]);
      } catch {
        // Retrieval is already disabled. A durable worker retry removes the original.
        cleanupPending = true;
      }
      await audit(user, "document.delete", id);
      return Response.json({ ok: true, cleanupPending });
    }
  }
  if (path === "/api/cases" && method === "GET")
    return Response.json({
      cases: await db.query(
        "select id,title,created_at,updated_at from cases where user_id=$1 order by updated_at desc limit 100",
        [user.id],
      ),
    });
  if (path === "/api/cases" && method === "POST") {
    const id = randomUUID();
    await db.query("insert into cases(id,user_id) values($1,$2)", [id, user.id]);
    return Response.json({ id, title: "New case" }, { status: 201 });
  }
  const caseMatch = path.match(/^\/api\/cases\/([a-f0-9-]+)$/);
  if (caseMatch && method === "GET") {
    const record = await ownCase(caseMatch[1], user);
    return Response.json({
      case: record,
      messages: await db.query(
        "select id,role,content,sources,status,created_at from messages where case_id=$1 order by sequence",
        [record.id],
      ),
      attachments: await listDocuments(user, "", record.id),
    });
  }
  if (path === "/api/chat" && method === "POST") return chat(request, user);
  if (path === "/api/settings/test" && method === "POST") {
    requireAdmin(user);
    await rateLimit(`ai-test:${user.id}`, 10, 600);
    return Response.json(await checkAIConnection());
  }
  if (path === "/api/settings") {
    requireAdmin(user);
    if (method === "GET")
      return Response.json({
        ai: await publicAIConfig(),
        storage: process.env.S3_BUCKET
          ? "Private S3-compatible object storage"
          : "Private local storage",
        database: process.env.DATABASE_URL ? "PostgreSQL" : "Persistent local PostgreSQL (PGlite)",
        worker: process.env.WORKER_MODE === "external" ? "External worker" : "Embedded worker",
        usage: (
          await db.query(
            "select count(*)::int as requests,coalesce(sum(input_tokens),0)::int as input_tokens,coalesce(sum(output_tokens),0)::int as output_tokens from usage_events",
          )
        )[0],
      });
    if (method === "PUT") {
      const result = await saveAIConfig(await jsonBody(request));
      await audit(user, "settings.ai", "ai");
      return Response.json({ ai: result });
    }
  }
  if (path === "/api/users") {
    requireAdmin(user);
    if (method === "GET")
      return Response.json({
        users: await db.query("select id,name,email,role from app_users order by created_at"),
      });
    if (method === "POST") {
      const body = await jsonBody(request);
      const role = text(body.role, "Role");
      check(["reader", "editor", "admin"].includes(role), 400, "Unknown role.");
      const email = text(body.email, "Email", 3, 200).toLowerCase();
      check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, "Enter a valid email.");
      const id = randomUUID();
      await db.query(
        "insert into app_users(id,email,name,password_hash,role) values($1,$2,$3,$4,$5)",
        [
          id,
          email,
          text(body.name, "Name", 2, 100),
          passwordHash(text(body.password, "Password", 12, 200)),
          role,
        ],
      );
      await audit(user, "user.create", id);
      return Response.json({ id }, { status: 201 });
    }
  }
  throw new HttpError(404, "API endpoint not found.");
}
export async function handleAPI(request: Request): Promise<Response> {
  try {
    const response = await dispatch(request);
    response.headers.set(
      "Cache-Control",
      response.headers.get("Cache-Control") || "private, no-store",
    );
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    if (error instanceof HttpError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    if ((error as { code?: string })?.code === "23505")
      return Response.json({ error: "That record already exists." }, { status: 409 });
    console.error("[api]", error instanceof Error ? error.name : "Unexpected error");
    return Response.json(
      { error: "The request could not be completed. Check server configuration or try again." },
      { status: 500 },
    );
  }
}
