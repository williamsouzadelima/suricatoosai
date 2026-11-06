import "server-only";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { api } from "@/convex/_generated/api";
import { generateS3Key, getS3Client } from "@/convex/s3Utils";
import { getConvexClient } from "@/lib/db/convex-client";

/**
 * Sobe UMA imagem de evidência (bytes já em memória, vindos do multipart) para o
 * mesmo S3/`files` que a captura do agente usa, e devolve o file_id.
 *
 * Diferença do uploader de sandbox: aqui os bytes estão no servidor, então o PUT
 * é server-side direto (sem presigned round-trip) → sem risco de "upload
 * fantasma". Em seguida HeadObject confirma a persistência e saveSandboxGeneratedFile
 * registra o metadado em `files` (é o que grava is_attached/file_id e deixa a
 * evidência sobreviver ao purge de 24h).
 */

const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

export type UploadedEngineImage = {
  file_id: string;
  s3_key: string;
  media_type: string;
  size: number;
};

export async function uploadEngineImage(args: {
  userId: string;
  name: string;
  mediaType: string;
  bytes: Buffer;
}): Promise<UploadedEngineImage> {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("AWS_S3_BUCKET_NAME is required for engine image uploads");
  }

  const s3 = getS3Client();
  const s3Key = generateS3Key(args.userId, args.name);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: args.bytes,
      ContentType: args.mediaType,
      ContentLength: args.bytes.length,
    }),
  );

  // Confirma que o objeto está no bucket antes de registrar o metadado.
  await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Key }));

  const convex = getConvexClient();
  const saved = await convex.action(api.fileActions.saveSandboxGeneratedFile, {
    s3Key,
    name: args.name,
    mediaType: args.mediaType,
    size: args.bytes.length,
    serviceKey,
    userId: args.userId,
  });

  return {
    file_id: saved.fileId,
    s3_key: s3Key,
    media_type: args.mediaType,
    size: args.bytes.length,
  };
}
