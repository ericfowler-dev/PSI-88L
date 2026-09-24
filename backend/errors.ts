export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function check(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export async function jsonBody(request: Request, max = 300_000): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  check(reader, 400, "A request body is required.");
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    parts.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    check(body && typeof body === "object" && !Array.isArray(body), 400, "Expected a JSON object.");
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function text(value: unknown, name: string, min = 1, max = 200): string {
  check(
    typeof value === "string" && value.trim().length >= min && value.trim().length <= max,
    400,
    `${name} must contain ${min}–${max} characters.`,
  );
  return value.trim();
}
