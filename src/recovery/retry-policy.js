export const DEFAULT_MAX_RETRIES = 3;

export const RETRY_DECISIONS =
  Object.freeze({
    RETRY:
      'RETRY',

    EXHAUSTED:
      'EXHAUSTED',

    NON_RETRYABLE:
      'NON_RETRYABLE',

    MANUAL_REQUIRED:
      'MANUAL_REQUIRED',

    SHUTDOWN_INTERRUPTED:
      'SHUTDOWN_INTERRUPTED',
  });

const MANUAL_CHALLENGE_CODES =
  new Set([
    'MANUAL_CHALLENGE_REQUIRED',
  ]);

const SHUTDOWN_CODES =
  new Set([
    'PROCESS_SHUTDOWN',
    'GRACEFUL_SHUTDOWN',
    'SHUTDOWN_ABORT',
  ]);

/*
 * These delays are scheduling metadata only.
 *
 * This module never sleeps and never blocks a worker.
 * The recovery/runtime layer may use nextRetryAt to decide
 * when a bounded retry becomes eligible.
 */
const RETRY_BACKOFF_MS =
  Object.freeze([
    1_000,
    5_000,
    15_000,
  ]);

function normalizeCode(
  error,
) {
  const value =
    error?.code;

  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    return null;
  }

  return value
    .trim()
    .toUpperCase();
}

function validateRetryCount(
  retryCount,
) {
  if (
    !Number.isInteger(
      retryCount,
    )
    || retryCount < 0
  ) {
    throw new TypeError(
      'retryCount must be a non-negative integer.',
    );
  }
}

function validateMaxRetries(
  maxRetries,
) {
  if (
    !Number.isInteger(
      maxRetries,
    )
    || maxRetries < 0
  ) {
    throw new TypeError(
      'maxRetries must be a non-negative integer.',
    );
  }
}

export function getRetryDelayMs(
  retryNumber,
) {
  if (
    !Number.isInteger(
      retryNumber,
    )
    || retryNumber < 1
  ) {
    throw new TypeError(
      'retryNumber must be a positive integer.',
    );
  }

  const index =
    Math.min(
      retryNumber - 1,
      RETRY_BACKOFF_MS.length - 1,
    );

  return RETRY_BACKOFF_MS[
    index
  ];
}

export function classifyRetry({
  error,
  retryCount,
  maxRetries =
    DEFAULT_MAX_RETRIES,
} = {}) {
  validateRetryCount(
    retryCount,
  );

  validateMaxRetries(
    maxRetries,
  );

  const code =
    normalizeCode(
      error,
    );

  if (
    code
    && MANUAL_CHALLENGE_CODES
      .has(
        code,
      )
  ) {
    return {
      decision:
        RETRY_DECISIONS
          .MANUAL_REQUIRED,

      code,

      countRetry:
        false,

      retryNumber:
        null,

      delayMs:
        null,
    };
  }

  if (
    (
      code
      && SHUTDOWN_CODES.has(
        code,
      )
    )
    || error?.name
      === 'AbortError'
  ) {
    return {
      decision:
        RETRY_DECISIONS
          .SHUTDOWN_INTERRUPTED,

      code:
        code
        ?? 'ABORTED',

      countRetry:
        false,

      retryNumber:
        null,

      delayMs:
        null,
    };
  }

  /*
   * Fail closed for errors that have not explicitly declared
   * themselves retryable.
   *
   * Unknown failures must never become an accidental
   * infinite retry loop.
   */
  if (
    error?.retryable !== true
  ) {
    return {
      decision:
        RETRY_DECISIONS
          .NON_RETRYABLE,

      code:
        code
        ?? 'NON_RETRYABLE_ERROR',

      countRetry:
        false,

      retryNumber:
        null,

      delayMs:
        null,
    };
  }

  if (
    retryCount >= maxRetries
  ) {
    return {
      decision:
        RETRY_DECISIONS
          .EXHAUSTED,

      code:
        code
        ?? 'RETRY_EXHAUSTED',

      countRetry:
        false,

      retryNumber:
        null,

      delayMs:
        null,
    };
  }

  const retryNumber =
    retryCount + 1;

  return {
    decision:
      RETRY_DECISIONS
        .RETRY,

    code:
      code
      ?? 'RETRYABLE_ERROR',

    countRetry:
      true,

    retryNumber,

    delayMs:
      getRetryDelayMs(
        retryNumber,
      ),
  };
}

export function retryDateFrom({
  now =
    new Date(),
  retryNumber,
} = {}) {
  if (
    !(
      now instanceof Date
    )
    || Number.isNaN(
      now.getTime(),
    )
  ) {
    throw new TypeError(
      'now must be a valid Date.',
    );
  }

  const delayMs =
    getRetryDelayMs(
      retryNumber,
    );

  return new Date(
    now.getTime()
    + delayMs,
  ).toISOString();
}