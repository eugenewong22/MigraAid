export const CONTRACT_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export const CONTRACT_UPLOAD_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type ContractUploadErrorKey =
  | "error"
  | "errorInvalidFile"
  | "errorTooLarge"
  | "errorRateLimited"
  | "errorUnavailable";

export function validateContractUpload(file: {
  type: string;
  size: number;
}): ContractUploadErrorKey | null {
  if (!(CONTRACT_UPLOAD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "errorInvalidFile";
  }
  if (file.size > CONTRACT_UPLOAD_MAX_BYTES) return "errorTooLarge";
  return null;
}

export function contractUploadErrorForStatus(
  status: number,
): ContractUploadErrorKey {
  if (status === 413) return "errorTooLarge";
  if (status === 429) return "errorRateLimited";
  if (status === 400 || status === 415) return "errorInvalidFile";
  // 503 is the service stopping itself — a degraded limiter, a spend ceiling,
  // a flag. The generic copy tells the worker to retake the photo, which is
  // both wrong and expensive: each retry burns another of their five per
  // minute for a problem no photo can fix.
  if (status === 503) return "errorUnavailable";
  return "error";
}
