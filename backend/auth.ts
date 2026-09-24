import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { database } from "./db.ts";
import { check, HttpError, text } from "./errors.ts";
export type User = { id: string; email: string; name: string; role: "admin" | "editor" | "reader" };
const cookieName = "psi_session";
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function validPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const rows = await (
    await database()
  ).query<{ count: number }>(
    `insert into request_limits(key,count,resets_at) values($1,1,now()+($2 * interval '1 second'))
    on conflict(key) do update set count=case when request_limits.resets_at < now() then 1 else request_limits.count+1 end,
    resets_at=case when request_limits.resets_at < now() then now()+($2 * interval '1 second') else request_limits.resets_at end returning count`,
    [key, seconds],
  );
  check(rows[0].count <= limit, 429, "Too many requests. Please try again later.");
}
export function sameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  const expected = appUrl ? new URL(appUrl).origin : new URL(request.url).origin;
  check(!origin || origin === expected, 403, "Cross-origin request rejected.");
  check(
    request.headers.get("sec-fetch-site") !== "cross-site",
    403,
    "Cross-site request rejected.",
  );
}
export async function currentUser(request: Request): Promise<User | null> {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!token || token.length > 200) return null;
  return (
    (
      await (
        await database()
      ).query<User>(
        `select u.id,u.email,u.name,u.role from app_sessions s join app_users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now()`,
        [hash(token)],
      )
    )[0] || null
  );
}
export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, "Sign in to continue.");
  return user;
}
export function requireEditor(user: User) {
  check(user.role !== "reader", 403, "An editor or administrator is required.");
}
export function requireAdmin(user: User) {
  check(user.role === "admin", 403, "An administrator is required.");
}
export async function needsSetup() {
  return (
    (await (await database()).query<{ count: string }>("select count(*) from app_users"))[0]
      .count == "0"
  );
}
function cookie(value: string, age: number, request: Request) {
  const secure = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || request.url).startsWith(
    "https:",
  );
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
}
export async function login(body: Record<string, unknown>, request: Request, setup = false) {
  await rateLimit("login:global", 80, 600);
  const email = text(body.email, "Email", 3, 200).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, "Enter a valid email.");
  const password = text(body.password, "Password", 12, 200);
  await rateLimit(`login:${hash(email)}`, 15, 600);
  const db = await database();
  if (setup) {
    const configured = process.env.SETUP_TOKEN;
    const host = new URL(request.url).hostname;
    check(
      configured
        ? typeof body.setupToken === "string" && hash(body.setupToken) === hash(configured)
        : process.env.NODE_ENV !== "production" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(host),
      403,
      "Enter the server setup token to create the initial administrator.",
    );
    await db.transaction(async (query) => {
      await query("lock table app_users in exclusive mode");
      check(
        (await query("select id from app_users limit 1")).length === 0,
        409,
        "Setup is already complete.",
      );
      await query(
        "insert into app_users(id,email,name,password_hash,role) values($1,$2,$3,$4,$5)",
        [randomUUID(), email, text(body.name, "Name", 2, 100), passwordHash(password), "admin"],
      );
    });
  }
  const row = (
    await db.query<User & { password_hash: string }>("select * from app_users where email=$1", [
      email,
    ])
  )[0];
  check(row && validPassword(password, row.password_hash), 401, "Email or password is incorrect.");
  const token = randomBytes(32).toString("hex");
  await db.query(
    "insert into app_sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '7 days')",
    [hash(token), row.id],
  );
  return Response.json(
    { user: { id: row.id, name: row.name, email: row.email, role: row.role } },
    { headers: { "Set-Cookie": cookie(token, 604800, request) } },
  );
}
export async function logout(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (token)
    await (await database()).query("delete from app_sessions where token_hash=$1", [hash(token)]);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0, request) } });
}
export async function audit(user: User, action: string, resourceId: string) {
  await (
    await database()
  ).query("insert into audit_events(id,user_id,action,resource_id) values($1,$2,$3,$4)", [
    randomUUID(),
    user.id,
    action,
    resourceId,
  ]);
}
