import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import {
  getS3UrlLifetimeSeconds,
  S3_USER_FILES_PREFIX,
} from "../lib/constants/s3";
import {
  contentDispositionFor,
  inlineSafeContentType,
} from "../lib/utils/media-disposition";

/**
 * Get environment variable with validation
 */
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get S3 client with credentials from environment variables
 */
export function getS3Client(): S3Client {
  const accessKeyId = getRequiredEnvVar("AWS_S3_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnvVar("AWS_S3_SECRET_ACCESS_KEY");
  const region = getRequiredEnvVar("AWS_S3_REGION");
  // Optional custom endpoint for S3-compatible backends (self-hosted MinIO,
  // Cloudflare R2, etc.). When set, path-style addressing is required so the
  // object lives at `${endpoint}/${bucket}/${key}` behind our reverse proxy.
  const endpoint = process.env.AWS_S3_ENDPOINT?.trim();

  return new S3Client({
    region,
    // Presigned browser uploads do not provide the body while signing. The
    // SDK's default WHEN_SUPPORTED behavior otherwise signs the CRC32 of an
    // empty body, which S3 rejects when the browser PUTs the real file.
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Generate unique S3 key with user prefix
 * Format: users/{userId}/{timestamp}-{uuid}.{ext}
 * Only uses file extension from fileName, UUID ensures uniqueness
 */
export function generateS3Key(userId: string, fileName: string): string {
  const timestamp = Date.now();
  const uuid = uuidv4();

  // Extract file extension, default to empty string if none
  const lastDotIndex = fileName.lastIndexOf(".");
  const extension = lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : "";

  return `${S3_USER_FILES_PREFIX}/${userId}/${timestamp}-${uuid}${extension}`;
}

/**
 * Generate presigned URL for file upload
 */
export async function generateS3UploadUrl(
  fileName: string,
  contentType: string,
  userId: string,
  contentLength?: number,
): Promise<{ uploadUrl: string; s3Key: string }> {
  try {
    const s3Client = getS3Client();
    const bucketName = getRequiredEnvVar("AWS_S3_BUCKET_NAME");
    const s3Key = generateS3Key(userId, fileName);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ContentType: contentType,
      ContentLength: contentLength,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: getS3UrlLifetimeSeconds(),
    });

    return { uploadUrl, s3Key };
  } catch (error) {
    console.error("Failed to generate S3 upload URL:", error);
    throw new Error(
      "Failed to generate upload URL: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
  }
}

/**
 * Generate presigned URL for file download.
 *
 * Segurança (stored-XSS same-origin): AWS_S3_ENDPOINT está no MESMO origin que o
 * app, então um objeto servido INLINE executa no nosso origin. Duas defesas:
 *  1) Content-Disposition por tipo — só raster/pdf vão inline; o resto vira
 *     attachment (SEM `opts.mediaType` o padrão é attachment, seguro).
 *  2) Para inline, FIXA o Content-Type ao tipo canônico seguro (não o Content-Type
 *     do OBJETO no S3, que o upload controla e pode mentir — ex. text/html salvo
 *     sob rótulo image/png). Sem o pin, inline + Content-Type-do-objeto = XSS; com
 *     ele, a resposta é image/png + inline → o browser renderiza como imagem (desde
 *     que o backend S3 HONRE o ResponseContentType — verificar no deploy, gate G1),
 *     nunca como HTML. Callers inline (imagem/pdf) passam o `media_type` do registro.
 */
export async function generateS3DownloadUrl(
  s3Key: string,
  opts?: { mediaType?: string | null; filename?: string | null },
): Promise<string> {
  try {
    const s3Client = getS3Client();
    const bucketName = getRequiredEnvVar("AWS_S3_BUCKET_NAME");

    // Definido só quando inline-safe; para attachment fica undefined (o attachment
    // já impede a renderização, então o Content-Type do objeto é irrelevante).
    const pinnedContentType = inlineSafeContentType(opts?.mediaType);
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ResponseContentDisposition: contentDispositionFor(
        opts?.mediaType,
        opts?.filename,
      ),
      ...(pinnedContentType
        ? { ResponseContentType: pinnedContentType }
        : {}),
    });

    const downloadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: getS3UrlLifetimeSeconds(),
    });

    return downloadUrl;
  } catch (error) {
    console.error("Failed to generate S3 download URL:", error);
    throw new Error(
      "Failed to generate download URL: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
  }
}

/**
 * Delete object from S3
 */
export async function deleteS3Object(s3Key: string): Promise<void> {
  try {
    const s3Client = getS3Client();
    const bucketName = getRequiredEnvVar("AWS_S3_BUCKET_NAME");

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error("Failed to delete S3 object:", error);
    throw new Error(
      "Failed to delete S3 object: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
  }
}

/**
 * Get S3 object size in bytes.
 */
export async function getS3ObjectSizeBytes(s3Key: string): Promise<number> {
  try {
    const s3Client = getS3Client();
    const bucketName = getRequiredEnvVar("AWS_S3_BUCKET_NAME");

    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const result = await s3Client.send(command);
    if (typeof result.ContentLength !== "number") {
      throw new Error("S3 object ContentLength is missing");
    }
    return result.ContentLength;
  } catch (error) {
    console.error("Failed to fetch S3 object metadata:", error);
    throw new Error(
      "Failed to fetch S3 object metadata: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
  }
}
