import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage on MinIO (S3-compatible) — replaces Supabase Storage.
 * `forcePathStyle` is required for MinIO.
 */
const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const bucket = process.env.S3_BUCKET ?? "sellerctrl";

export const s3 = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  },
});

export { bucket as storageBucket };

/** Presigned URL the browser can PUT a file to directly. */
export async function presignUpload(key: string, contentType: string, expiresIn = 600) {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/** Presigned URL for downloading / viewing a private object. */
export async function presignDownload(key: string, expiresIn = 600) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/** Server-side upload (used by the proxy upload route). */
export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function buildStorageKey(workspaceId: string, filename: string) {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `workspaces/${workspaceId}/${Date.now()}-${safe}`;
}

/** Browser-reachable URL for an object (bucket is download-public in dev). */
export function publicUrl(key: string) {
  const base = process.env.S3_PUBLIC_URL ?? `${endpoint}/${bucket}`;
  return `${base}/${key}`;
}
