import { randomUUID } from "node:crypto";
import { database } from "./db.ts";
import { readStoredFile, deleteStoredFile } from "./storage.ts";
import { extract } from "./extract.ts";
type Job = { id: string; document_id: string; lease_token: string; attempts: number };
export async function processNextJob(): Promise<boolean> {
  const db = await database();
  const deletion = (
    await db.query<{ storage_key: string }>(
      "select storage_key from file_deletions where next_attempt_at <= now() order by created_at limit 1",
    )
  )[0];
  if (deletion) {
    try {
      await deleteStoredFile(deletion.storage_key);
      await db.query("delete from file_deletions where storage_key=$1", [deletion.storage_key]);
    } catch {
      await db.query(
        "update file_deletions set next_attempt_at=now()+interval '1 minute' where storage_key=$1",
        [deletion.storage_key],
      );
    }
  }
  const token = randomUUID();
  const job = await db.transaction(async (query) => {
    const row = (
      await query<Job>(
        `select * from ingestion_jobs where state='queued' or (state='processing' and lease_until<now()) order by created_at for update skip locked limit 1`,
      )
    )[0];
    if (!row) return null;
    await query(
      "update ingestion_jobs set state='processing',attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=$2 where id=$1",
      [row.id, token],
    );
    await query(
      "update documents set status='processing',error=null where id=$1 and status<>'deleted'",
      [row.document_id],
    );
    return row;
  });
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void db
      .query(
        "update ingestion_jobs set lease_until=now()+interval '5 minutes' where id=$1 and lease_token=$2",
        [job.id, token],
      )
      .catch(() => {});
  }, 30_000);
  heartbeat.unref();
  try {
    const doc = (
      await db.query<{ filename: string; storage_key: string; status: string; revision: number }>(
        "select filename,storage_key,status,revision from documents where id=$1",
        [job.document_id],
      )
    )[0];
    if (!doc || doc.status === "deleted") return true;
    if (job.attempts >= 3)
      throw new Error(
        "Processing stopped after repeated worker interruptions. Review the file and retry.",
      );
    const result = await extract(doc.filename, await readStoredFile(doc.storage_key));
    await db.transaction(async (query) => {
      const current = (
        await query<{ status: string }>("select status from documents where id=$1 for update", [
          job.document_id,
        ])
      )[0];
      const owned = await query("select id from ingestion_jobs where id=$1 and lease_token=$2", [
        job.id,
        token,
      ]);
      if (!owned.length || current?.status === "deleted") return;
      await query("delete from document_chunks where document_id=$1 and revision=$2", [
        job.document_id,
        doc.revision,
      ]);
      for (const [ordinal, passage] of result.passages.entries())
        await query(
          "insert into document_chunks(id,document_id,revision,ordinal,locator,content) values($1,$2,$3,$4,$5,$6)",
          [randomUUID(), job.document_id, doc.revision, ordinal, passage.locator, passage.content],
        );
      await query("update documents set status='review',warnings=$2,updated_at=now() where id=$1", [
        job.document_id,
        JSON.stringify(result.warnings),
      ]);
      await query(
        "update ingestion_jobs set state='done',lease_until=null where id=$1 and lease_token=$2",
        [job.id, token],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : "Processing failed.";
    await db.transaction(async (query) => {
      const owned = await query(
        "update ingestion_jobs set state='failed',lease_until=null where id=$1 and lease_token=$2 returning id",
        [job.id, token],
      );
      if (owned.length)
        await query(
          "update documents set status='failed',error=$2,updated_at=now() where id=$1 and status<>'deleted'",
          [job.document_id, message],
        );
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
const state = globalThis as typeof globalThis & {
  psiWorker?: ReturnType<typeof setInterval>;
  psiWorkerBusy?: boolean;
};
export function startEmbeddedWorker() {
  if (process.env.WORKER_MODE === "external" || state.psiWorker) return;
  state.psiWorker = setInterval(() => {
    if (state.psiWorkerBusy) return;
    state.psiWorkerBusy = true;
    void processNextJob()
      .catch(() => console.error("[worker] processing loop failed"))
      .finally(() => {
        state.psiWorkerBusy = false;
      });
  }, 1200);
  state.psiWorker.unref();
}
