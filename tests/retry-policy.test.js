import test from 'node:test';

import assert from 'node:assert/strict';

import {
  classifyRetry,
  DEFAULT_MAX_RETRIES,
  getRetryDelayMs,
  RETRY_DECISIONS,
  retryDateFrom,
} from '../src/recovery/retry-policy.js';

test(
  'retry policy retries only explicitly retryable errors',
  () => {
    const result =
      classifyRetry({
        error: {
          code:
            'TEMPORARY_NETWORK_ERROR',

          retryable:
            true,
        },

        retryCount:
          0,
      });

    assert.equal(
      result.decision,
      RETRY_DECISIONS.RETRY,
    );

    assert.equal(
      result.countRetry,
      true,
    );

    assert.equal(
      result.retryNumber,
      1,
    );

    assert.equal(
      result.delayMs,
      1_000,
    );
  },
);

test(
  'unknown errors fail closed instead of retrying',
  () => {
    const result =
      classifyRetry({
        error:
          new Error(
            'unknown failure',
          ),

        retryCount:
          0,
      });

    assert.equal(
      result.decision,
      RETRY_DECISIONS.NON_RETRYABLE,
    );

    assert.equal(
      result.countRetry,
      false,
    );

    assert.equal(
      result.retryNumber,
      null,
    );
  },
);

test(
  'manual challenge never becomes an automatic retry',
  () => {
    const result =
      classifyRetry({
        error: {
          code:
            'MANUAL_CHALLENGE_REQUIRED',

          retryable:
            true,
        },

        retryCount:
          0,
      });

    assert.equal(
      result.decision,
      RETRY_DECISIONS.MANUAL_REQUIRED,
    );

    assert.equal(
      result.countRetry,
      false,
    );
  },
);

test(
  'graceful shutdown does not consume retry budget',
  () => {
    const result =
      classifyRetry({
        error: {
          code:
            'GRACEFUL_SHUTDOWN',

          retryable:
            false,
        },

        retryCount:
          2,
      });

    assert.equal(
      result.decision,
      RETRY_DECISIONS.SHUTDOWN_INTERRUPTED,
    );

    assert.equal(
      result.countRetry,
      false,
    );

    assert.equal(
      result.retryNumber,
      null,
    );
  },
);

test(
  'AbortError is treated as shutdown interruption',
  () => {
    const error =
      new Error(
        'aborted',
      );

    error.name =
      'AbortError';

    const result =
      classifyRetry({
        error,

        retryCount:
          1,
      });

    assert.equal(
      result.decision,
      RETRY_DECISIONS.SHUTDOWN_INTERRUPTED,
    );

    assert.equal(
      result.countRetry,
      false,
    );
  },
);

test(
  'retry policy stops after the configured retry limit',
  () => {
    const result =
      classifyRetry({
        error: {
          code:
            'TEMPORARY_FAILURE',

          retryable:
            true,
        },

        retryCount:
          DEFAULT_MAX_RETRIES,

        maxRetries:
          DEFAULT_MAX_RETRIES,
      });

    assert.equal(
      result.decision,
      RETRY_DECISIONS.EXHAUSTED,
    );

    assert.equal(
      result.countRetry,
      false,
    );

    assert.equal(
      result.retryNumber,
      null,
    );
  },
);

test(
  'retry policy respects a custom retry limit',
  () => {
    const first =
      classifyRetry({
        error: {
          retryable:
            true,
        },

        retryCount:
          0,

        maxRetries:
          1,
      });

    const exhausted =
      classifyRetry({
        error: {
          retryable:
            true,
        },

        retryCount:
          1,

        maxRetries:
          1,
      });

    assert.equal(
      first.decision,
      RETRY_DECISIONS.RETRY,
    );

    assert.equal(
      exhausted.decision,
      RETRY_DECISIONS.EXHAUSTED,
    );
  },
);

test(
  'retry backoff is bounded and does not grow indefinitely',
  () => {
    assert.equal(
      getRetryDelayMs(
        1,
      ),
      1_000,
    );

    assert.equal(
      getRetryDelayMs(
        2,
      ),
      5_000,
    );

    assert.equal(
      getRetryDelayMs(
        3,
      ),
      15_000,
    );

    assert.equal(
      getRetryDelayMs(
        100,
      ),
      15_000,
    );
  },
);

test(
  'retryDateFrom calculates scheduling metadata without sleeping',
  () => {
    const now =
      new Date(
        '2026-09-22T00:00:00.000Z',
      );

    assert.equal(
      retryDateFrom({
        now,
        retryNumber:
          2,
      }),
      '2026-09-22T00:00:05.000Z',
    );
  },
);

test(
  'retry policy validates retry counts',
  () => {
    assert.throws(
      () =>
        classifyRetry({
          error: {
            retryable:
              true,
          },

          retryCount:
            -1,
        }),
      {
        name:
          'TypeError',
      },
    );

    assert.throws(
      () =>
        classifyRetry({
          error: {
            retryable:
              true,
          },

          retryCount:
            0,

          maxRetries:
            -1,
        }),
      {
        name:
          'TypeError',
      },
    );
  },
);

test(
  'retry delay validates retry number',
  () => {
    assert.throws(
      () =>
        getRetryDelayMs(
          0,
        ),
      {
        name:
          'TypeError',
      },
    );
  },
);