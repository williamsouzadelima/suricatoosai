import "server-only";

import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import type { AnySandbox } from "@/types";
import { isCentrifugoSandbox, isE2BSandbox } from "./sandbox-types";
import { buildSandboxCommandOptions } from "./sandbox-command-options";
import { generateS3UploadUrl, getS3Client } from "@/convex/s3Utils";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getConvexClient } from "@/lib/db/convex-client";
import { MAX_GENERATED_FILE_SIZE_BYTES } from "@/lib/constants/s3";
import { logger } from "@/lib/logger";

const DEFAULT_MEDIA_TYPE = "application/octet-stream";
const MAX_GENERATED_FILE_SIZE_MB =
  MAX_GENERATED_FILE_SIZE_BYTES / (1024 * 1024);
const SANDBOX_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SANDBOX_UPLOAD_STATUS_MARKER = "__HACKERAI_UPLOAD_EXIT_CODE__:";
const WINDOWS_FILE_SIZE_PATH_ENV_VAR = "HACKERAI_FILE_SIZE_PATH";
const UNSUPPORTED_WINDOWS_FILE_SIZE_PATH_CHARS = /[\0"!\r\n^]/;

export type UploadedFileInfo = {
  url: string;
  fileId: Id<"files">;
  tokens: number;
  // Metadata for file accumulator (avoids re-querying DB)
  name: string;
  mediaType: string;
  s3Key?: string;
  sizeBytes: number;
};

/**
 * Extract error message from ConvexError or regular Error
 * Ensures user-friendly error messages are properly displayed
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const errorData = error.data as { message?: string };
    return errorData?.message || error.message || "An error occurred";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shouldTryWindowsFileSizeFallback(sandbox: AnySandbox): boolean {
  return isCentrifugoSandbox(sandbox) && sandbox.isWindows();
}

function formatUnsupportedWindowsPathCharacter(character: string): string {
  switch (character) {
    case "\0":
      return "\\0";
    case "\r":
      return "\\r";
    case "\n":
      return "\\n";
    default:
      return character;
  }
}

function assertWindowsFileSizeFallbackPathSafe(fullPath: string): void {
  const unsupportedCharacter = fullPath.match(
    UNSUPPORTED_WINDOWS_FILE_SIZE_PATH_CHARS,
  )?.[0];
  if (!unsupportedCharacter) return;

  throw new Error(
    `Cannot safely get file size for Windows path containing unsupported character ${formatUnsupportedWindowsPathCharacter(unsupportedCharacter)}.`,
  );
}

function formatFileSizeFailure(
  fullPath: string,
  statResult: SandboxCommandResult,
  winResult?: SandboxCommandResult,
): Error {
  const details = [
    statResult.stderr,
    statResult.stdout,
    winResult?.stderr,
    winResult?.stdout,
  ]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("; ");

  return new Error(
    `Failed to get file size for ${fullPath}: ${
      details || `stat command failed with exit code ${statResult.exitCode}`
    }`,
  );
}

async function getSandboxFileSize(
  sandbox: AnySandbox,
  fullPath: string,
): Promise<number> {
  const quotedPath = shellQuote(fullPath);
  const commandOptions = buildSandboxCommandOptions(sandbox);
  let statResult: SandboxCommandResult;
  try {
    statResult = await sandbox.commands.run(
      `if [ ! -e ${quotedPath} ] && [ ! -L ${quotedPath} ]; then printf 'File not found: %s\\n' ${quotedPath} >&2; exit 66; fi; stat -c%s ${quotedPath} 2>/dev/null || stat -f%z ${quotedPath}`,
      { ...commandOptions, displayName: "" } as typeof commandOptions & {
        displayName?: string;
      },
    );
  } catch (error) {
    const commandResult = commandErrorToResult(error);
    if (!commandResult) {
      logger.error(
        "sandbox_generated_file_size_command_threw",
        error instanceof Error ? error : undefined,
        {
          event: "sandbox_generated_file_size_command_threw",
          service: "chat-handler",
          sandbox_type: getSandboxLogType(sandbox),
          file_name: getFileNameFromPath(fullPath),
          file_path: fullPath,
          error: errorToLog(error),
        },
      );
      throw error;
    }
    statResult = commandResult;
  }

  let fileSize = parseInt(statResult.stdout.trim(), 10);
  if (!isNaN(fileSize) && statResult.exitCode === 0) {
    return fileSize;
  }

  if (!shouldTryWindowsFileSizeFallback(sandbox)) {
    logger.error("sandbox_generated_file_size_failed", undefined, {
      event: "sandbox_generated_file_size_failed",
      service: "chat-handler",
      sandbox_type: getSandboxLogType(sandbox),
      file_name: getFileNameFromPath(fullPath),
      file_path: fullPath,
      stat_exit_code: statResult.exitCode,
      stat_stderr: statResult.stderr?.slice(0, 500),
      stat_stdout: statResult.stdout?.slice(0, 500),
    });
    throw formatFileSizeFailure(fullPath, statResult);
  }

  assertWindowsFileSizeFallbackPathSafe(fullPath);

  // Windows cmd.exe fallback: delayed expansion avoids reparsing path
  // metacharacters such as & after the command has been parsed.
  const winCommand = `setlocal EnableDelayedExpansion && for %I in ("!${WINDOWS_FILE_SIZE_PATH_ENV_VAR}!") do @echo %~zI`;
  let winResult: SandboxCommandResult;
  try {
    winResult = await sandbox.commands.run(winCommand, {
      ...commandOptions,
      envVars: {
        ...(commandOptions.envVars ?? {}),
        [WINDOWS_FILE_SIZE_PATH_ENV_VAR]: fullPath,
      },
      displayName: "",
    } as typeof commandOptions & {
      displayName?: string;
    });
  } catch (error) {
    const commandResult = commandErrorToResult(error);
    if (!commandResult) {
      logger.error(
        "sandbox_generated_file_size_windows_command_threw",
        error instanceof Error ? error : undefined,
        {
          event: "sandbox_generated_file_size_windows_command_threw",
          service: "chat-handler",
          sandbox_type: getSandboxLogType(sandbox),
          file_name: getFileNameFromPath(fullPath),
          file_path: fullPath,
          stat_exit_code: statResult.exitCode,
          stat_stderr: statResult.stderr?.slice(0, 500),
          stat_stdout: statResult.stdout?.slice(0, 500),
          error: errorToLog(error),
        },
      );
      throw error;
    }
    winResult = commandResult;
  }
  fileSize = parseInt(winResult.stdout.trim(), 10);
  if (!isNaN(fileSize) && winResult.exitCode === 0) {
    return fileSize;
  }

  logger.error("sandbox_generated_file_size_failed", undefined, {
    event: "sandbox_generated_file_size_failed",
    service: "chat-handler",
    sandbox_type: getSandboxLogType(sandbox),
    file_name: getFileNameFromPath(fullPath),
    file_path: fullPath,
    stat_exit_code: statResult.exitCode,
    stat_stderr: statResult.stderr?.slice(0, 500),
    stat_stdout: statResult.stdout?.slice(0, 500),
    windows_exit_code: winResult.exitCode,
    windows_stderr: winResult.stderr?.slice(0, 500),
    windows_stdout: winResult.stdout?.slice(0, 500),
  });
  throw formatFileSizeFailure(fullPath, statResult, winResult);
}

function assertSandboxFileSizeAllowed(fileName: string, size: number): void {
  if (size <= MAX_GENERATED_FILE_SIZE_BYTES) return;

  throw new Error(
    `File "${fileName}" exceeds the maximum generated file size limit of ${MAX_GENERATED_FILE_SIZE_MB} MB. Current size: ${(size / (1024 * 1024)).toFixed(2)} MB`,
  );
}

function getSandboxLogType(sandbox: AnySandbox): "e2b" | "centrifugo" {
  return isE2BSandbox(sandbox) ? "e2b" : "centrifugo";
}

function errorToLog(error: unknown) {
  if (error instanceof Error) {
    const commandError = error as Error & {
      exitCode?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      ...(typeof commandError.exitCode === "number"
        ? { exit_code: commandError.exitCode }
        : {}),
      ...(typeof commandError.stderr === "string" && commandError.stderr
        ? { stderr: commandError.stderr.slice(0, 500) }
        : {}),
      ...(typeof commandError.stdout === "string" && commandError.stdout
        ? { stdout: commandError.stdout.slice(0, 500) }
        : {}),
    };
  }
  return { message: String(error) };
}

function getFileNameFromPath(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() || "file";
}

type SandboxCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function commandErrorToResult(error: unknown): SandboxCommandResult | null {
  if (!(error instanceof Error)) return null;

  const commandError = error as Error & {
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };

  if (typeof commandError.exitCode !== "number") return null;

  return {
    stdout:
      typeof commandError.stdout === "string"
        ? commandError.stdout
        : error.message,
    stderr: typeof commandError.stderr === "string" ? commandError.stderr : "",
    exitCode: commandError.exitCode,
  };
}

function parseUploadResult(result: SandboxCommandResult): SandboxCommandResult {
  const statusMatch = result.stdout.match(
    new RegExp(`(?:^|\\n)${SANDBOX_UPLOAD_STATUS_MARKER}(\\d+)(?:\\n|$)`),
  );

  if (!statusMatch) return result;

  return {
    stdout: result.stdout
      .replace(
        new RegExp(`(?:^|\\n)${SANDBOX_UPLOAD_STATUS_MARKER}\\d+(?:\\n|$)`),
        "\n",
      )
      .trim(),
    stderr: result.stderr,
    exitCode: Number(statusMatch[1]),
  };
}

function formatUploadFailure(
  fullPath: string,
  result: SandboxCommandResult,
): Error {
  return new Error(
    `Failed to upload file ${fullPath}: ${
      result.stderr ||
      result.stdout ||
      `upload command failed with exit code ${result.exitCode}`
    }`,
  );
}

async function uploadGeneratedFileFromSandboxToUrl(args: {
  sandbox: AnySandbox;
  fullPath: string;
  uploadUrl: string;
  mediaType: string;
}): Promise<void> {
  const { sandbox, fullPath, uploadUrl, mediaType } = args;
  const fileName = getFileNameFromPath(fullPath);

  if (!isE2BSandbox(sandbox) && sandbox.files?.uploadToUrl) {
    try {
      await sandbox.files.uploadToUrl(fullPath, uploadUrl, mediaType);
      return;
    } catch (error) {
      logger.warn("sandbox_generated_file_native_upload_failed", {
        event: "sandbox_generated_file_native_upload_failed",
        service: "chat-handler",
        sandbox_type: getSandboxLogType(sandbox),
        file_name: fileName,
        file_path: fullPath,
        media_type: mediaType,
        error: errorToLog(error),
      });
    }
  }

  let result: SandboxCommandResult;
  const uploadCommand = `curl -fsSL -X PUT -H ${shellQuote(`Content-Type: ${mediaType}`)} --data-binary @${shellQuote(fullPath)} ${shellQuote(uploadUrl)}`;
  try {
    result = await sandbox.commands.run(
      `${uploadCommand}; status=$?; printf '\\n${SANDBOX_UPLOAD_STATUS_MARKER}%s\\n' "$status"; exit 0`,
      {
        ...buildSandboxCommandOptions(sandbox),
        timeoutMs: SANDBOX_UPLOAD_TIMEOUT_MS,
      } as ReturnType<typeof buildSandboxCommandOptions>,
    );
  } catch (error) {
    const commandResult = commandErrorToResult(error);
    if (commandResult) {
      result = commandResult;
    } else {
      logger.error(
        "sandbox_generated_file_upload_failed",
        error instanceof Error ? error : undefined,
        {
          event: "sandbox_generated_file_upload_failed",
          service: "chat-handler",
          sandbox_type: getSandboxLogType(sandbox),
          file_name: fileName,
          file_path: fullPath,
          media_type: mediaType,
          error: errorToLog(error),
        },
      );
      throw error;
    }
  }

  result = parseUploadResult(result);

  if (result.exitCode !== 0) {
    logger.error("sandbox_generated_file_upload_failed", undefined, {
      event: "sandbox_generated_file_upload_failed",
      service: "chat-handler",
      sandbox_type: getSandboxLogType(sandbox),
      file_name: fileName,
      file_path: fullPath,
      media_type: mediaType,
      exit_code: result.exitCode,
      stderr: result.stderr?.slice(0, 500),
      stdout: result.stdout?.slice(0, 500),
    });
    throw formatUploadFailure(fullPath, result);
  }
}

/**
 * Lê os bytes de um arquivo do sandbox via `base64` no canal de comando.
 * Usado pelo fallback server-side quando o upload direto do exec node não
 * persistiu o objeto. Rejeita leitura truncada (compara com o tamanho real).
 */
async function readSandboxFileBytesViaBase64(
  sandbox: AnySandbox,
  fullPath: string,
  expectedSize: number,
): Promise<Buffer> {
  const quoted = shellQuote(fullPath);
  const command = `base64 -w0 ${quoted} 2>/dev/null || base64 ${quoted}`;
  let result: SandboxCommandResult;
  try {
    result = await sandbox.commands.run(command, {
      ...buildSandboxCommandOptions(sandbox),
      timeoutMs: SANDBOX_UPLOAD_TIMEOUT_MS,
    } as ReturnType<typeof buildSandboxCommandOptions>);
  } catch (error) {
    const commandResult = commandErrorToResult(error);
    if (!commandResult) throw error;
    result = commandResult;
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `base64 read failed for ${fullPath} (exit ${result.exitCode}): ${(
        result.stderr || ""
      ).slice(0, 200)}`,
    );
  }
  const b64 = (result.stdout || "").replace(/\s+/g, "");
  if (!b64)
    throw new Error(`base64 read returned empty output for ${fullPath}`);
  const buf = Buffer.from(b64, "base64");
  // Guarda contra truncamento no canal de comando: bytes decodificados têm de
  // bater EXATAMENTE com o tamanho via stat. Divergência = leitura incompleta.
  if (buf.length !== expectedSize) {
    throw new Error(
      `sandbox base64 read truncated for ${fullPath}: expected ${expectedSize} bytes, got ${buf.length}`,
    );
  }
  return buf;
}

/**
 * Confirma que o objeto realmente persistiu no bucket após o upload. O PUT
 * pré-assinado roda DENTRO do sandbox (exec node remoto); ele pode retornar 2xx
 * sem gravar no bucket de produção (destino divergente/egress), o que deixaria um
 * `s3_key` fantasma — a evidência some do relatório silenciosamente. Se o HEAD
 * falhar, sobe os bytes pelo cliente do SERVIDOR (caminho comprovadamente
 * confiável) e revalida. Qualquer falha é lançada → a tool capture_finding já
 * trata por-evidência (mantém o achado, sem s3_key), então não há regressão.
 */
async function ensureObjectPersisted(args: {
  sandbox: AnySandbox;
  fullPath: string;
  s3Key: string;
  mediaType: string;
  fileSize: number;
  userId: string;
  name: string;
}): Promise<void> {
  const { sandbox, fullPath, s3Key, mediaType, fileSize, userId, name } = args;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) return;
  const s3 = getS3Client();
  const exists = async (): Promise<boolean> => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      return true;
    } catch {
      return false;
    }
  };

  if (await exists()) return;

  logger.warn("sandbox_upload_not_persisted_server_fallback", {
    event: "sandbox_upload_not_persisted_server_fallback",
    service: "chat-handler",
    user_id: userId,
    file_name: name,
    file_path: fullPath,
    media_type: mediaType,
    size_bytes: fileSize,
    s3_key: s3Key,
    sandbox_type: getSandboxLogType(sandbox),
  });

  const buf = await readSandboxFileBytesViaBase64(sandbox, fullPath, fileSize);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buf,
      ContentType: mediaType,
    }),
  );
  if (!(await exists())) {
    throw new Error(
      `server-side fallback upload did not persist object ${s3Key}`,
    );
  }
  logger.warn("sandbox_upload_server_fallback_ok", {
    event: "sandbox_upload_server_fallback_ok",
    service: "chat-handler",
    user_id: userId,
    file_name: name,
    media_type: mediaType,
    size_bytes: fileSize,
    s3_key: s3Key,
    sandbox_type: getSandboxLogType(sandbox),
  });
}

export async function uploadSandboxFileToConvex(args: {
  sandbox: AnySandbox;
  userId: string;
  fullPath: string;
  mediaType?: string;
  name?: string;
}): Promise<UploadedFileInfo> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is required for sandbox file uploads",
    );
  }

  if (!process.env.CONVEX_SERVICE_ROLE_KEY) {
    throw new Error(
      "CONVEX_SERVICE_ROLE_KEY is required for sandbox file uploads. " +
        "This is a server-only secret and must never be exposed to the client.",
    );
  }

  const { sandbox, userId, fullPath } = args;
  const mediaType = args.mediaType || DEFAULT_MEDIA_TYPE;
  const name = args.name || getFileNameFromPath(fullPath);
  const fileSize = await getSandboxFileSize(sandbox, fullPath);
  if (fileSize > MAX_GENERATED_FILE_SIZE_BYTES) {
    logger.warn("sandbox_generated_file_too_large", {
      event: "sandbox_generated_file_too_large",
      service: "chat-handler",
      user_id: userId,
      file_name: name,
      media_type: mediaType,
      size_bytes: fileSize,
      limit_bytes: MAX_GENERATED_FILE_SIZE_BYTES,
      sandbox_type: getSandboxLogType(sandbox),
    });
  }
  assertSandboxFileSizeAllowed(name, fileSize);
  const convex = getConvexClient();

  let uploadUrl: string;
  let s3Key: string;
  try {
    const generatedUrl = await generateS3UploadUrl(
      name,
      mediaType,
      userId,
      fileSize,
    );
    uploadUrl = generatedUrl.uploadUrl;
    s3Key = generatedUrl.s3Key;
  } catch (error) {
    logger.error(
      "sandbox_generated_file_upload_url_failed",
      error instanceof Error ? error : undefined,
      {
        event: "sandbox_generated_file_upload_url_failed",
        service: "chat-handler",
        user_id: userId,
        file_name: name,
        file_path: fullPath,
        media_type: mediaType,
        size_bytes: fileSize,
        sandbox_type: getSandboxLogType(sandbox),
        error: errorToLog(error),
      },
    );
    throw error;
  }

  try {
    await uploadGeneratedFileFromSandboxToUrl({
      sandbox,
      fullPath,
      uploadUrl,
      mediaType,
    });
  } catch (error) {
    logger.error(
      "sandbox_generated_file_upload_to_url_failed",
      error instanceof Error ? error : undefined,
      {
        event: "sandbox_generated_file_upload_to_url_failed",
        service: "chat-handler",
        user_id: userId,
        file_name: name,
        file_path: fullPath,
        media_type: mediaType,
        size_bytes: fileSize,
        s3_key: s3Key,
        sandbox_type: getSandboxLogType(sandbox),
        error: errorToLog(error),
      },
    );
    throw error;
  }

  // Defesa contra "upload fantasma": confirma que o objeto persistiu no bucket;
  // se o PUT do exec node retornou 2xx sem gravar, sobe pelo servidor e revalida.
  await ensureObjectPersisted({
    sandbox,
    fullPath,
    s3Key,
    mediaType,
    fileSize,
    userId,
    name,
  });

  try {
    const saved = await convex.action(
      api.fileActions.saveSandboxGeneratedFile,
      {
        s3Key,
        name,
        mediaType,
        size: fileSize,
        serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY!,
        userId,
      },
    );

    return {
      ...saved,
      name,
      mediaType,
      s3Key,
      sizeBytes: fileSize,
    } as UploadedFileInfo;
  } catch (error) {
    logger.error(
      "sandbox_generated_file_metadata_save_failed",
      error instanceof Error ? error : undefined,
      {
        event: "sandbox_generated_file_metadata_save_failed",
        service: "chat-handler",
        user_id: userId,
        file_name: name,
        media_type: mediaType,
        size_bytes: fileSize,
        sandbox_type: getSandboxLogType(sandbox),
        error: errorToLog(error),
      },
    );
    // Re-throw with properly extracted error message
    throw new Error(extractErrorMessage(error));
  }
}
