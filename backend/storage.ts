import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { dataDir } from "./db.ts";
import { check } from "./errors.ts";
function localPath(key: string) {
  check(/^[a-f0-9-]+\/[a-f0-9-]+$/.test(key), 400, "Invalid file key.");
  return resolve(dataDir(), "files", key);
}
async function s3() {
  const sdk = await import("@aws-sdk/client-s3");
  return {
    ...sdk,
    client: new sdk.S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    }),
  };
}
function checkLocal() {
  check(
    process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_STORAGE === "true",
    503,
    "Private S3 storage must be configured in production.",
  );
}
export async function putFile(key: string, bytes: Buffer, mediaType: string) {
  if (process.env.S3_BUCKET) {
    const { client, PutObjectCommand } = await s3();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: mediaType,
      }),
    );
  } else {
    checkLocal();
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  }
}
export async function readStoredFile(key: string): Promise<Buffer> {
  if (process.env.S3_BUCKET) {
    const { client, GetObjectCommand } = await s3();
    const result = await client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    check(result.Body, 404, "File not found.");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  checkLocal();
  return readFile(localPath(key));
}
export async function deleteStoredFile(key: string) {
  if (process.env.S3_BUCKET) {
    const { client, DeleteObjectCommand } = await s3();
    await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  } else {
    checkLocal();
    await unlink(localPath(key)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
