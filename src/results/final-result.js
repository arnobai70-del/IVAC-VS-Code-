import {
  createHash,
} from 'node:crypto';

import {
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  FinalResultValidationError,
} from './final-result-errors.js';

export const FINAL_RESULT_OUTCOMES =
  Object.freeze({
    SUCCESS:
      'SUCCESS',

    FAILURE:
      'FAILURE',
  });

const FORBIDDEN_KEYS =
  new Set([
    'proto',
    'prototype',
    'constructor',
    'password',
    'passwd',
    'secret',
    'token',
    'accesstoken',
    'portalapiaccesstoken',
    'authorization',
    'proxyauthorization',
    'cookie',
    'setcookie',
    'setcookies',
    'otp',
    'otpcode',
  ]);

const FORBIDDEN_KEY_FRAGMENTS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'otp',
  'pdf',
  'binary',
  'buffer',
  'base64',
];

const SENSITIVE_TEXT_PATTERNS = [
  /\bauthorization\s*[:=]\s*bearer\s+\S+/i,

  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,

  /\b(?:password|passwd|secret)\s*[:=]\s*\S+/i,

  /\b(?:access[_\s-]?token|api[_\s-]?token|token)\s*[:=]\s*\S+/i,

  /\botp(?:\s*code)?\s*[:=]\s*[A-Za-z0-9-]+/i,

  /\bcookie\s*[:=]\s*\S+/i,

  /\bset-cookie\s*[:=]\s*\S+/i,

  /%PDF-\d/i,

  /\bJVBERi0[A-Za-z0-9+/=]*/i,
];

const MAX_TEXT_LENGTH =
  2_000;

const MAX_CODE_LENGTH =
  128;

const MAX_DATA_BYTES =
  64 * 1024;

const MAX_DEPTH =
  8;

const MAX_ARRAY_ITEMS =
  200;

const MAX_OBJECT_KEYS =
  200;

function normalizeIdentifier(
  value,
  fieldName,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new FinalResultValidationError(
      `${fieldName} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function assertSafeText(
  value,
  fieldName,
) {
  for (
    const pattern
    of SENSITIVE_TEXT_PATTERNS
  ) {
    if (
      pattern.test(
        value,
      )
    ) {
      throw new FinalResultValidationError(
        `${fieldName} contains sensitive or binary-like content.`,
      );
    }
  }
}

function normalizeOptionalText(
  value,
  fieldName,
  maxLength,
) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== 'string'
    && typeof value !== 'number'
    && typeof value !== 'boolean'
  ) {
    throw new FinalResultValidationError(
      `${fieldName} must be text-compatible.`,
    );
  }

  const normalized =
    String(value)
      .trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length
    > maxLength
  ) {
    throw new FinalResultValidationError(
      `${fieldName} exceeds the allowed length.`,
    );
  }

  assertSafeText(
    normalized,
    fieldName,
  );

  return normalized;
}

function normalizeKey(key) {
  return String(key)
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      '',
    );
}

function assertSafeKey(key) {
  const normalized =
    normalizeKey(
      key,
    );

  if (
    FORBIDDEN_KEYS
      .has(
        normalized,
      )
    || FORBIDDEN_KEY_FRAGMENTS
      .some(
        (fragment) =>
          normalized.includes(
            fragment,
          ),
      )
  ) {
    throw new FinalResultValidationError(
      `Final result data contains forbidden field: ${key}`,
    );
  }
}

function isBinaryLike(value) {
  return (
    Buffer.isBuffer(
      value,
    )
    || value
      instanceof ArrayBuffer
    || ArrayBuffer
      .isView(
        value,
      )
  );
}

function normalizeJsonValue(
  value,
  {
    depth = 0,
    path = 'data',
  } = {},
) {
  if (
    depth > MAX_DEPTH
  ) {
    throw new FinalResultValidationError(
      `Final result ${path} exceeds the maximum nesting depth.`,
    );
  }

  if (
    isBinaryLike(
      value,
    )
  ) {
    throw new FinalResultValidationError(
      `Final result ${path} must not contain binary data.`,
    );
  }

  if (
    value === null
    || typeof value
      === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value
    === 'string'
  ) {
    assertSafeText(
      value,
      path,
    );

    return value;
  }

  if (
    typeof value
    === 'number'
  ) {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      throw new FinalResultValidationError(
        `Final result ${path} contains a non-finite number.`,
      );
    }

    return value;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    if (
      value.length
      > MAX_ARRAY_ITEMS
    ) {
      throw new FinalResultValidationError(
        `Final result ${path} contains too many array items.`,
      );
    }

    return value.map(
      (
        item,
        index,
      ) =>
        normalizeJsonValue(
          item,
          {
            depth:
              depth + 1,

            path:
              `${path}[${index}]`,
          },
        ),
    );
  }

  if (
    typeof value !== 'object'
    || Object.getPrototypeOf(
      value,
    )
      !== Object.prototype
  ) {
    throw new FinalResultValidationError(
      `Final result ${path} must contain JSON-safe values only.`,
    );
  }

  const entries =
    Object.entries(
      value,
    );

  if (
    entries.length
    > MAX_OBJECT_KEYS
  ) {
    throw new FinalResultValidationError(
      `Final result ${path} contains too many object fields.`,
    );
  }

  const output = {};

  for (
    const [
      key,
      child,
    ]
    of entries
  ) {
    assertSafeKey(
      key,
    );

    if (
      child === undefined
      || typeof child
        === 'function'
      || typeof child
        === 'symbol'
      || typeof child
        === 'bigint'
    ) {
      throw new FinalResultValidationError(
        `Final result ${path}.${key} is not JSON-safe.`,
      );
    }

    output[key] =
      normalizeJsonValue(
        child,
        {
          depth:
            depth + 1,

          path:
            `${path}.${key}`,
        },
      );
  }

  return output;
}

function canonicalize(value) {
  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      canonicalize,
    );
  }

  if (
    value !== null
    && typeof value
      === 'object'
  ) {
    const output = {};

    for (
      const key
      of Object.keys(
        value,
      )
        .sort()
    ) {
      output[key] =
        canonicalize(
          value[key],
        );
    }

    return output;
  }

  return value;
}

function sha256(value) {
  return createHash(
    'sha256',
  )
    .update(
      value,
    )
    .digest(
      'hex',
    );
}

function deepFreeze(value) {
  if (
    value === null
    || typeof value
      !== 'object'
    || Object.isFrozen(
      value,
    )
  ) {
    return value;
  }

  for (
    const child
    of Object.values(
      value,
    )
  ) {
    deepFreeze(
      child,
    );
  }

  return Object.freeze(
    value,
  );
}

export function normalizeFinalResult({
  jobId,
  applicationId,
  outcome,
  code = null,
  message = null,
  data = {},
}) {
  const normalizedJobId =
    normalizeIdentifier(
      jobId,
      'jobId',
    );

  const normalizedApplicationId =
    normalizeIdentifier(
      applicationId,
      'applicationId',
    );

  if (
    !Object.values(
      FINAL_RESULT_OUTCOMES,
    )
      .includes(
        outcome,
      )
  ) {
    throw new FinalResultValidationError(
      'Final result outcome must be SUCCESS or FAILURE.',
    );
  }

  const normalizedData =
    normalizeJsonValue(
      data,
    );

  if (
    normalizedData === null
    || Array.isArray(
      normalizedData,
    )
    || typeof normalizedData
      !== 'object'
  ) {
    throw new FinalResultValidationError(
      'Final result data must be a plain object.',
    );
  }

  const payload = {
    version:
      1,

    outcome,

    code:
      normalizeOptionalText(
        code,
        'code',
        MAX_CODE_LENGTH,
      ),

    message:
      normalizeOptionalText(
        message,
        'message',
        MAX_TEXT_LENGTH,
      ),

    data:
      normalizedData,
  };

  const canonicalPayload =
    JSON.stringify(
      canonicalize(
        payload,
      ),
    );

  if (
    Buffer.byteLength(
      canonicalPayload,
      'utf8',
    )
    > MAX_DATA_BYTES
  ) {
    throw new FinalResultValidationError(
      'Final result payload exceeds the allowed size.',
    );
  }

  const payloadHash =
    sha256(
      canonicalPayload,
    );

  const idempotencyKey =
    sha256(
      [
        'ivac-final-result-v1',
        normalizedJobId,
        normalizedApplicationId,
        payloadHash,
      ].join(
        '\u0000',
      ),
    );

  const terminalState =
    outcome
    === FINAL_RESULT_OUTCOMES
      .SUCCESS
      ? JOB_STATES
        .COMPLETED
      : JOB_STATES
        .FAILED_FINAL;

  return deepFreeze({
    jobId:
      normalizedJobId,

    applicationId:
      normalizedApplicationId,

    outcome,

    terminalState,

    code:
      payload.code,

    message:
      payload.message,

    data:
      normalizedData,

    canonicalPayload,

    payloadHash,

    idempotencyKey,
  });
}