import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage with two backends:
 *  - Supabase Storage REST (when SUPABASE_URL + SUPABASE_SERVICE_KEY are set) — used on Vercel.
 *  - MinIO / S3-compatible (via AWS SDK) — used for local Docker.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "sellerctrl";
const useSupabase = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

// ── S3 / MinIO (local) ──
const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
// Public bucket: display assets only (item images, org logos, academy images) served via
// publicUrl(). Private bucket: sensitive data (per-tenant backups, document attachments)
// served ONLY through short-lived presigned URLs behind guarded routes — never anonymous.
const bucket = process.env.S3_BUCKET ?? "sellerctrl";
const privateBucket = process.env.S3_PRIVATE_BUCKET ?? "sellerctrl-private";

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

export function buildStorageKey(workspaceId: string, filename: string) {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `workspaces/${workspaceId}/${Date.now()}-${safe}`;
}

type BucketOpts = { private?: boolean };

/** Server-side upload. `private: true` targets the presigned-only private bucket
 *  (backups, attachments); default is the public display-asset bucket. */
export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string, opts?: BucketOpts) {
  if (useSupabase) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY!,
        "Content-Type": contentType,
        "x-upsert": "true",
        "cache-control": "3600",
      },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`Supabase upload failed: ${res.status} ${await res.text()}`);
    return key;
  }
  await s3.send(new PutObjectCommand({ Bucket: opts?.private ? privateBucket : bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function deleteObject(key: string, opts?: BucketOpts) {
  if (useSupabase) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY! },
    });
    return;
  }
  await s3.send(new DeleteObjectCommand({ Bucket: opts?.private ? privateBucket : bucket, Key: key }));
}

/** Browser-reachable URL for an object (buckets are public). */
export function publicUrl(key: string) {
  if (useSupabase) return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${key}`;
  const base = process.env.S3_PUBLIC_URL ?? `${endpoint}/${bucket}`;
  return `${base}/${key}`;
}

/** Presigned URLs for the PRIVATE bucket (S3/MinIO only — Supabase uses public URLs).
 *  This is how backups + attachments are read/written; the bucket has no anonymous
 *  access, so a valid short-lived signature (issued only by a guarded route) is required. */
export async function presignUpload(key: string, contentType: string, expiresIn = 600) {
  const cmd = new PutObjectCommand({ Bucket: privateBucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

export async function presignDownload(key: string, expiresIn = 600) {
  if (useSupabase) return publicUrl(key);
  const cmd = new GetObjectCommand({ Bucket: privateBucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}
