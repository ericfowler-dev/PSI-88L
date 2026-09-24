import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
export interface Database {
  query: Query;
  transaction: <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}
const state = globalThis as typeof globalThis & { psiDatabase?: Promise<Database> };
export const dataDir = () => resolve(process.env.DATA_DIR || ".data");
async function openDatabase(): Promise<Database> {
  let db: Database;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () => console.error("[database] idle connection error"));
    db = {
      query: async <T>(text: string, params: unknown[] = []) =>
        (await pool.query(text, params)).rows as T[],
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          const result = await fn(
            async <T>(text: string, params: unknown[] = []) =>
              (await client.query(text, params)).rows as T[],
          );
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "true")
      throw new Error("DATABASE_URL is required in production.");
    await mkdir(dataDir(), { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite(resolve(dataDir(), "postgres"));
    await pg.waitReady;
    db = {
      query: async <T>(text: string, params: unknown[] = []) =>
        params.length
          ? (await pg.query<T>(text, params)).rows
          : (((await pg.exec(text)).at(-1)?.rows || []) as T[]),
      transaction: (fn) =>
        pg.transaction((tx) =>
          fn(async <T>(text: string, params: unknown[] = []) =>
            params.length
              ? (await tx.query<T>(text, params)).rows
              : (((await tx.exec(text)).at(-1)?.rows || []) as T[]),
          ),
        ),
      close: () => pg.close(),
    };
  }
  await db.query(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  await db.transaction(async (query) => {
    await query("lock table _migrations in exclusive mode");
    const applied = new Set(
      (await query<{ name: string }>("select name from _migrations")).map((r) => r.name),
    );
    const directory = resolve("migrations");
    for (const name of (await readdir(directory)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
      if (applied.has(name)) continue;
      await query(await readFile(resolve(directory, name), "utf8"));
      await query("insert into _migrations(name) values ($1)", [name]);
    }
  });
  return db;
}
export function database() {
  return (state.psiDatabase ??= openDatabase().catch((error) => {
    state.psiDatabase = undefined;
    throw error;
  }));
}
export async function closeDatabase() {
  if (state.psiDatabase) await (await state.psiDatabase).close();
  state.psiDatabase = undefined;
}
