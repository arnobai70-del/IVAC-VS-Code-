const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 2_000;

const SENSITIVE_KEY_PATTERNS = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /password/i,
  /passwd/i,
  /passphrase/i,
  /credential/i,
  /secret/i,
  /access.?token/i,
  /refresh.?token/i,
  /api.?token/i,
  /api.?key/i,
  /^token$/i,
  /^otp$/i,
  /one.?time.?password/i,
  /session.?cookie/i,
  /proxy.?username/i,
  /proxy.?password/i,
  /private.?key/i,
  /client.?secret/i,
  /pdf.?binary/i,
  /document.?binary/i,
];

const UNSAFE_CONTAINER_KEYS = [
  /^raw$/i,
  /^payload$/i,
  /^applicationPayload$/i,
  /^portalPayload$/i,
  /^requestBody$/i,
  /^responseBody$/i,
  /^body$/i,
  /^headers$/i,
  /^session$/i,
  /^cookies$/i,
  /^cookieJar$/i,
  /^dispatcher$/i,
];

const SECRET_STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+/gi,
];

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isUnsafeContainerKey(key) {
  return UNSAFE_CONTAINER_KEYS.some((pattern) => pattern.test(key));
}

function sanitizeString(value) {
  let sanitized = value;

  for (const pattern of SECRET_STRING_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }

  if (sanitized.length > MAX_STRING_LENGTH) {
    return `${sanitized.slice(0, MAX_STRING_LENGTH)}…`;
  }

  return sanitized;
}

function sanitizeValue(value, depth, seen) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }

  if (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  ) {
    return REDACTED;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeOperationalError(value);
  }

  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]";
  }

  if (typeof value !== "object") {
    return sanitizeString(String(value));
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => sanitizeValue(item, depth + 1, seen))
        .filter((item) => item !== undefined);
    }

    if (!isPlainObject(value)) {
      return "[UNSUPPORTED_OBJECT]";
    }

    const output = Object.create(null);

    for (const [key, childValue] of Object.entries(value)) {
      if (isSensitiveKey(key) || isUnsafeContainerKey(key)) {
        output[key] = REDACTED;
        continue;
      }

      const sanitizedChild = sanitizeValue(
        childValue,
        depth + 1,
        seen,
      );

      if (sanitizedChild !== undefined) {
        output[key] = sanitizedChild;
      }
    }

    return output;
  } finally {
    seen.delete(value);
  }
}

export function sanitizeOperationalValue(value) {
  return sanitizeValue(value, 0, new WeakSet());
}

export function sanitizeOperationalError(error) {
  if (!error) {
    return null;
  }

  const safe = Object.create(null);

  if (typeof error.name === "string") {
    safe.name = sanitizeString(error.name);
  }

  if (typeof error.code === "string") {
    safe.code = sanitizeString(error.code);
  }

  if (typeof error.message === "string") {
    safe.message = sanitizeString(error.message);
  }

  if (typeof error.category === "string") {
    safe.category = sanitizeString(error.category);
  }

  if (typeof error.retryable === "boolean") {
    safe.retryable = error.retryable;
  }

  if (typeof error.statusCode === "number") {
    safe.statusCode = error.statusCode;
  }

  return safe;
}

export function isOperationalSensitiveKey(key) {
  if (typeof key !== "string") {
    return false;
  }

  return isSensitiveKey(key) || isUnsafeContainerKey(key);
}

export const OPERATIONAL_REDACTED_VALUE = REDACTED;