import { createHash, randomUUID } from "node:crypto";
import { database } from "./db.ts";
import { audit, requireEditor, type User } from "./auth.ts";
import { check, text } from "./errors.ts";
import { putFile, deleteStoredFile } from "./storage.ts";
import { validateFile, splitPassages } from "./extract.ts";
import { faultCode, exactFaultMatch } from "./diagnostics.ts";
export type Document = {
  id: string;
  owner_id: string;
  case_id: string | null;
  title: string;
  filename: string;
  media_type: string;
  byte_size: number;
  storage_key: string;
  status: string;
  source_note: string;
  revision: number;
  warnings: string[];
  error: string | null;
  processed_pages: number;
  total_pages: number;
  created_at: string;
  updated_at: string;
  chunk_count?: number;
};
export type Source = {
  id: string;
  documentId: string;
  title: string;
  filename: string;
  revision: number;
  locator: string;
  content: string;
  score?: number;
  match?: "exact_code" | "spn_only" | "text";
};
export async function ownCase(id: string, user: User) {
  const row = (
    await (
      await database()
    ).query<{ id: string; title: string }>(
      "select id,title from cases where id=$1 and user_id=$2",
      [id, user.id],
    )
  )[0];
  check(row, 404, "Case not found.");
  return row;
}
export async function getDocument(id: string, user: User): Promise<Document> {
  const doc = (
    await (
      await database()
    ).query<Document>("select * from documents where id=$1 and status<>'deleted'", [id])
  )[0];
  check(doc, 404, "Source not found.");
  if (doc.case_id) await ownCase(doc.case_id, user);
  else check(doc.status === "published" || user.role !== "reader", 404, "Source not found.");
  return doc;
}
export async function listDocuments(user: User, query = "", caseId?: string) {
  const db = await database();
  if (caseId) await ownCase(caseId, user);
  return db.query<Document>(
    `select d.*, (select count(*)::int from document_chunks c where c.document_id=d.id and c.revision=d.revision) as chunk_count
    from documents d where d.status<>'deleted' and ${caseId ? "d.case_id=$3" : "d.case_id is null and (d.status='published' or $3='editor' or $3='admin')"}
    and ($1='' or d.title ilike $2 or d.filename ilike $2) order by d.updated_at desc limit 100`,
    [query, `%${query}%`, caseId || user.role],
  );
}
export async function uploadDocument(
  user: User,
  filename: string,
  bytes: Buffer,
  title: string,
  sourceNote: string,
  caseId?: string,
) {
  if (caseId) await ownCase(caseId, user);
  else requireEditor(user);
  const mime = validateFile(filename, bytes);
  const db = await database();
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const duplicate = (
    await db.query<Document>(
      "select * from documents where checksum=$1 and owner_id=$2 and case_id is not distinct from $3 and status<>'deleted' limit 1",
      [checksum, user.id, caseId || null],
    )
  )[0];
  if (duplicate) return { document: duplicate, duplicate: true };
  const id = randomUUID();
  const storageKey = `${user.id}/${id}`;
  await putFile(storageKey, bytes, mime);
  try {
    await db.transaction(async (query) => {
      await query(
        "insert into documents(id,owner_id,case_id,title,filename,media_type,byte_size,storage_key,checksum,source_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          user.id,
          caseId || null,
          title,
          filename,
          mime,
          bytes.length,
          storageKey,
          checksum,
          sourceNote,
        ],
      );
      await query("insert into ingestion_jobs(id,document_id) values($1,$2)", [randomUUID(), id]);
    });
  } catch (error) {
    await deleteStoredFile(storageKey);
    throw error;
  }
  await audit(user, "document.upload", id);
  return { document: await getDocument(id, user), duplicate: false };
}
export async function updateDocument(id: string, body: Record<string, unknown>, user: User) {
  const doc = await getDocument(id, user);
  if (!doc.case_id) requireEditor(user);
  check(!["queued", "processing"].includes(doc.status), 409, "Wait for processing to complete.");
  const title = body.title === undefined ? doc.title : text(body.title, "Title", 2, 200);
  const sourceNote =
    body.sourceNote === undefined
      ? doc.source_note
      : text(body.sourceNote || "User-provided source", "Source note", 1, 1000);
  const db = await database();
  await db.transaction(async (query) => {
    const current = (
      await query<Document>("select * from documents where id=$1 for update", [id])
    )[0];
    check(
      current &&
        !["deleted", "queued", "processing"].includes(current.status) &&
        current.revision === Number(body.revision),
      409,
      "This source has changed. Reload before saving.",
    );
    check(
      current.status !== "failed",
      409,
      "Retry processing before reviewing or publishing this source.",
    );
    let revision = current.revision;
    if (body.content !== undefined) {
      const content = text(body.content, "Reviewed text", 1, 500_000);
      revision++;
      for (const [ordinal, passage] of splitPassages(content, "Reviewed transcription").entries())
        await query(
          "insert into document_chunks(id,document_id,revision,ordinal,locator,content) values($1,$2,$3,$4,$5,$6)",
          [randomUUID(), id, revision, ordinal, passage.locator, passage.content],
        );
    }
    const publish = body.publish === true;
    if (publish) {
      requireEditor(user);
      check(
        !current.case_id,
        400,
        "Copy case evidence into a reviewed library source before publication.",
      );
      check(
        body.acknowledged === true,
        400,
        "Confirm you reviewed the source and extraction warnings.",
      );
      check(
        (
          await query(
            "select id from document_chunks where document_id=$1 and revision=$2 limit 1",
            [id, revision],
          )
        ).length,
        400,
        "Add readable text before publication.",
      );
    }
    await query(
      "update documents set title=$2,source_note=$3,revision=$4,status=$5,error=null,updated_at=now() where id=$1",
      [id, title, sourceNote, revision, publish ? "published" : "review"],
    );
  });
  await audit(user, body.publish ? "document.publish" : "document.review", id);
  return getDocument(id, user);
}
const synonyms: Record<string, string[]> = {
  ht: ["coolant", "temperature"],
  lt: ["intercooler", "cooling"],
  crank: ["starter", "electrical"],
  turnover: ["crank", "starter"],
  overheating: ["coolant", "temperature"],
  dtc: ["code", "fault"],
  prelube: ["lubrication", "oil"],
};
export function searchTerms(question: string) {
  const stop = new Set([
    "the",
    "and",
    "what",
    "how",
    "does",
    "with",
    "that",
    "this",
    "for",
    "about",
    "its",
    "from",
    "can",
    "not",
    "will",
    "engine",
  ]);
  const normalized = question
    .toLowerCase()
    .replace(/turn\s+over/g, " turnover ")
    .replace(/pre[- ]lube/g, " prelube ");
  const tokens = normalized.match(/[a-z0-9]+/g) || [];
  return [
    ...new Set(
      tokens
        .filter((t) => t.length >= 2 && !stop.has(t))
        .flatMap((t) => [t, ...(synonyms[t] || [])]),
    ),
  ].slice(0, 36);
}
export async function retrieve(
  question: string,
  user: User,
  caseId?: string,
  history = "",
): Promise<Source[]> {
  if (caseId) await ownCase(caseId, user);
  const code = faultCode(question, history);
  if (code) {
    const db = await database();
    const candidates = await db.query<Source & { ordinal: number }>(
      `select c.id,d.id as "documentId",d.title,d.filename,c.revision,c.ordinal,c.locator,c.content
       from document_chunks c join documents d on d.id=c.document_id
       where c.revision=d.revision and (d.case_id is null and d.status='published' or d.case_id=$2 and d.owner_id=$3 and d.status in ('review','published'))
       and c.search_vector @@ to_tsquery('simple',$1)
       order by d.updated_at desc,c.ordinal limit 200`,
      [`${code.spn} | spn${code.spn} | '${code.spn}/':*`, caseId || null, user.id],
    );
    const exact = candidates.filter((row) => exactFaultMatch(row.content, code));
    const structured = exact.filter((row) => row.locator.includes(`SPN ${code.spn} / FMI`));
    const ranked = (structured.length ? structured : exact.length ? exact : candidates).sort(
      (a, b) =>
        Number(b.locator.includes(`SPN ${code.spn}`)) -
        Number(a.locator.includes(`SPN ${code.spn}`)),
    );
    const selected: Source[] = [];
    const seen = new Set<string>();
    let size = 0;
    for (const row of ranked) {
      const signature = row.content.replace(/\s+/g, " ").trim();
      if (seen.has(signature) || size + row.content.length > 16_000) continue;
      seen.add(signature);
      selected.push({
        ...row,
        match: exact.length && code.fmi !== undefined ? "exact_code" : "spn_only",
      });
      size += row.content.length;
      // Legacy edited transcriptions can split a row: retain its following passage.
      if (!row.locator.includes(`SPN ${code.spn}`)) {
        const next = await db.query<Source>(
          `select c.id,d.id as "documentId",d.title,d.filename,c.revision,c.locator,c.content from document_chunks c join documents d on d.id=c.document_id where c.document_id=$1 and c.revision=$2 and c.ordinal=$3`,
          [row.documentId, row.revision, row.ordinal + 1],
        );
        if (
          next[0] &&
          (row.locator.startsWith("Reviewed transcription") ||
            (!!/^Page \d+\b/.exec(row.locator) &&
              /^Page \d+\b/.exec(row.locator)?.[0] === /^Page \d+\b/.exec(next[0].locator)?.[0])) &&
          selected.length < 7 &&
          size + next[0].content.length <= 16_000 &&
          !seen.has(next[0].content.replace(/\s+/g, " ").trim())
        ) {
          selected.push({ ...next[0], match: "text" });
          seen.add(next[0].content.replace(/\s+/g, " ").trim());
          size += next[0].content.length;
        }
      }
      if (selected.length >= 8) break;
    }
    return selected;
  }
  const terms = searchTerms(question);
  const expanded = [...new Set([...terms, ...searchTerms(history).slice(0, 12)])];
  if (!expanded.length) return [];
  const query = expanded.join(" | ");
  const rows = await (
    await database()
  ).query<Source>(
    `select c.id,d.id as "documentId",d.title,d.filename,c.revision,c.locator,c.content,
    ts_rank_cd(c.search_vector,to_tsquery('simple',$1)) + case when lower(d.title) like $4 then 0.2 else 0 end as score
    from document_chunks c join documents d on d.id=c.document_id
    where c.revision=d.revision and (d.case_id is null and d.status='published' or d.case_id=$2 and d.owner_id=$3 and d.status in ('review','published'))
    and (c.search_vector @@ to_tsquery('simple',$1) or to_tsvector('simple',d.title) @@ to_tsquery('simple',$1))
    order by score desc,d.updated_at desc,c.ordinal limit 12`,
    [query, caseId || null, user.id, `%${terms[0] || ""}%`],
  );
  const selected: Source[] = [];
  const counts = new Map<string, number>();
  let size = 0;
  for (const row of rows) {
    if ((counts.get(row.documentId) || 0) >= 3 || size + row.content.length > 14_000) continue;
    counts.set(row.documentId, (counts.get(row.documentId) || 0) + 1);
    selected.push(row);
    size += row.content.length;
    if (selected.length === 8) break;
  }
  return selected;
}
