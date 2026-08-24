import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage: MinIO / any S3-compatible service, via the AWS SDK.
 *
 * A second backend (Supabase Storage over REST) used to sit in front of this for the
 * Vercel deployment. That deployment is being retired in favour of the self-hosted Docker
 * stack, and a storage layer with one implementation is one less thing to keep in sync —
 * notably the private bucket, which Supabase never supported (its branch returned public
 * URLs for objects the S3 path serves only through short-lived presigned links).
 */

// ── S3 / MinIO ──
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
  await s3.send(new PutObjectCommand({ Bucket: opts?.private ? privateBucket : bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function deleteObject(key: string, opts?: BucketOpts) {
  await s3.send(new DeleteObjectCommand({ Bucket: opts?.private ? privateBucket : bucket, Key: key }));
}

/** Browser-reachable URL for an object (buckets are public). */
export function publicUrl(key: string) {
  const base = process.env.S3_PUBLIC_URL ?? `${endpoint}/${bucket}`;
  return `${base}/${key}`;
}

/** Presigned URLs for the PRIVATE bucket.
 *  This is how backups + attachments are read/written; the bucket has no anonymous
 *  access, so a valid short-lived signature (issued only by a guarded route) is required. */
export async function presignUpload(key: string, contentType: string, expiresIn = 600) {
  const cmd = new PutObjectCommand({ Bucket: privateBucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

export async function presignDownload(key: string, expiresIn = 600) {
  // The removed Supabase branch answered this with publicUrl(key) — an anonymous, permanent
  // link to an object in the PRIVATE bucket (per-tenant backups, document attachments).
  // There is now one path, and it is the signed, expiring one.
  const cmd = new GetObjectCommand({ Bucket: privateBucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}
