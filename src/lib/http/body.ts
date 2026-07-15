/** Bounded request-body helpers for public endpoints. */
export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export class UnsupportedMediaTypeError extends Error {
  constructor(readonly mediaType: string | null) {
    super(
      mediaType
        ? `Unsupported media type: ${mediaType}.`
        : "A Content-Type header is required.",
    );
    this.name = "UnsupportedMediaTypeError";
  }
}

/**
 * Read a UTF-8 request body with an authoritative streamed byte limit.
 * `Content-Length` is only an early rejection because clients can omit or
 * falsify it (for example by using chunked transfer encoding).
 */
export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBytes);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Read arbitrary request bytes with a limit that does not trust Content-Length. */
export async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new SyntaxError("Invalid Content-Length header.");
    }
    if (declaredLength > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) throw new SyntaxError("Request body is empty.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Read a bounded HTML form encoded with the login page's declared media type. */
export async function readBoundedUrlEncoded(
  request: Request,
  maxBytes: number,
): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new UnsupportedMediaTypeError(mediaType);
  }

  return new URLSearchParams(await readBoundedText(request, maxBytes));
}

/**
 * Parse JSON without allowing an unbounded `request.json()` allocation.
 * Content-Length is an early rejection only; the streamed byte count remains
 * authoritative because clients can omit or falsify that header.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  return JSON.parse(await readBoundedText(request, maxBytes)) as unknown;
}
