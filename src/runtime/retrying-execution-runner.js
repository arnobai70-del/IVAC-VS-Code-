import {
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  DEFAULT_MAX_RETRIES,
  RETRY_DECISIONS,
  classifyRetry,
} from '../recovery/retry-policy.js';

function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}

function requireFunction(
  value,
  name,
) {
  if (
    typeof value !== 'function'
  ) {
    throw new TypeError(
      `${name} must be a function.`,
    );
  }

  return value;
}

function requireNonEmptyString(
  value,
  name,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function requireNonNegativeInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative integer.`,
    );
  }

  return value;
}

function createAbortError() {
  const error =
    new Error(
      'Workflow retry wait was interrupted by shutdown.',
    );

  error.name =
    'AbortError';

  error.code =
    'SHUTDOWN_ABORT';

  return error;
}

function defaultSleep(
  milliseconds,
  signal,
) {
  if (
    signal?.aborted
  ) {
    return Promise.reject(
      createAbortError(),
    );
  }

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled =
        false;

      const cleanup =
        () => {
          signal
            ?.removeEventListener(
              'abort',
              onAbort,
            );
        };

      const finish =
        () => {
          if (settled) {
            return;
          }

          settled =
            true;

          cleanup();

          resolve();
        };

      const onAbort =
        () => {
          if (settled) {
            return;
          }

          settled =
            true;

          clearTimeout(
            timer,
          );

          cleanup();

          reject(
            createAbortError(),
          );
        };

      const timer =
        setTimeout(
          finish,
          milliseconds,
        );

      signal
        ?.addEventListener(
          'abort',
          onAbort,
          {
            once:
              true,
          },
        );
    },
  );
}

export class ExecutionTerminalFailureError
  extends Error {
  constructor({
    retryDecision,
    failureCode,
    retryCount,
    cause,
  }) {
    super(
      retryDecision
        === RETRY_DECISIONS.EXHAUSTED
        ? 'Workflow execution retry limit was exhausted.'
        : 'Workflow execution failed with a non-retryable error.',
      {
        cause,
      },
    );

    this.name =
      'ExecutionTerminalFailureError';

    this.code =
      'EXECUTION_TERMINAL_FAILURE';

    this.retryDecision =
      retryDecision;

    this.failureCode =
      failureCode;

    this.retryCount =
      retryCount;
  }
}

/*
 * Bounded workflow retry wrapper.
 *
 * Normal intake execution:
 *
 *     run()
 *       -> ExecutionWorker.run()
 *
 * Explicit manual-challenge continuation:
 *
 *     resumeManualChallenge()
 *       -> first attempt:
 *            ExecutionWorker.resumeManualChallenge()
 *       -> any explicitly retryable later attempt:
 *            ExecutionWorker.run()
 *
 * This distinction is important:
 *
 * - WAITING_FOR_MANUAL_CHALLENGE is never automatically admitted;
 * - only an explicit resume call can leave that state;
 * - after explicit resume has transitioned the job back to
 *   RUNNING, ordinary retry policy may handle a later retryable
 *   workflow failure;
 * - completed workflow steps are protected from replay by the
 *   memory-only JobContext response markers in WorkflowEngine;
 * - final-result delivery remains outside this retry boundary.
 */
export class RetryingExecutionRunner {
  constructor({
    executionWorker,
    jobStore,
    ipAllocator,
    maxRetries =
      DEFAULT_MAX_RETRIES,
    sleepFn =
      defaultSleep,
  }) {
    requireObject(
      executionWorker,
      'executionWorker',
    );

    requireFunction(
      executionWorker.run,
      'executionWorker.run',
    );

    requireFunction(
      executionWorker.resumeManualChallenge,
      'executionWorker.resumeManualChallenge',
    );

    requireObject(
      jobStore,
      'jobStore',
    );

    requireFunction(
      jobStore.getJobById,
      'jobStore.getJobById',
    );

    requireFunction(
      jobStore.incrementRetry,
      'jobStore.incrementRetry',
    );

    requireFunction(
      jobStore.transitionJob,
      'jobStore.transitionJob',
    );

    requireObject(
      ipAllocator,
      'ipAllocator',
    );

    requireFunction(
      ipAllocator.markRetryReserved,
      'ipAllocator.markRetryReserved',
    );

    requireNonNegativeInteger(
      maxRetries,
      'maxRetries',
    );

    requireFunction(
      sleepFn,
      'sleepFn',
    );

    this.executionWorker =
      executionWorker;

    this.jobStore =
      jobStore;

    this.ipAllocator =
      ipAllocator;

    this.maxRetries =
      maxRetries;

    this.sleepFn =
      sleepFn;
  }

  getJob(
    jobId,
  ) {
    const job =
      this.jobStore
        .getJobById(
          jobId,
        );

    if (!job) {
      throw new Error(
        `Job ${jobId} does not exist.`,
      );
    }

    return job;
  }

  async handleFailure({
    jobId,
    error,
    signal,
  }) {
    const job =
      this.getJob(
        jobId,
      );

    const classification =
      classifyRetry({
        error,

        retryCount:
          job.retryCount,

        maxRetries:
          this.maxRetries,
      });

    if (
      classification.decision
      === RETRY_DECISIONS
        .MANUAL_REQUIRED
    ) {
      /*
       * ExecutionWorker already moved the job to
       * WAITING_FOR_MANUAL_CHALLENGE.
       *
       * Never consume retry budget and never auto-resume it.
       */
      throw error;
    }

    if (
      classification.decision
      === RETRY_DECISIONS
        .SHUTDOWN_INTERRUPTED
    ) {
      /*
       * Shutdown remains non-terminal.
       *
       * Do not increment retry count, change allocation
       * ownership, or release the IP.
       */
      throw error;
    }

    if (
      classification.decision
      === RETRY_DECISIONS
        .NON_RETRYABLE
      || classification.decision
        === RETRY_DECISIONS
          .EXHAUSTED
    ) {
      throw new ExecutionTerminalFailureError({
        retryDecision:
          classification
            .decision,

        failureCode:
          classification
            .code,

        retryCount:
          job.retryCount,

        cause:
          error,
      });
    }

    if (
      classification.decision
      !== RETRY_DECISIONS
        .RETRY
    ) {
      throw new Error(
        `Unsupported retry decision: ${classification.decision}`,
        {
          cause:
            error,
        },
      );
    }

    if (
      job.state
      !== JOB_STATES.RUNNING
    ) {
      throw new Error(
        `Retryable job ${jobId} is in unexpected state ${job.state}.`,
        {
          cause:
            error,
        },
      );
    }

    /*
     * Consume retry budget durably before another attempt.
     *
     * If shutdown happens after this point, recovery sees the
     * already-consumed budget and cannot create unlimited retries.
     */
    const retryCountedJob =
      this.jobStore
        .incrementRetry(
          jobId,
          {
            expectedVersion:
              job.version,
          },
        );

    /*
     * Keep the exact same allocation reserved for this job.
     *
     * No replacement IP is acquired.
     */
    this.ipAllocator
      .markRetryReserved(
        jobId,
      );

    const retryPendingJob =
      this.jobStore
        .transitionJob(
          jobId,
          JOB_STATES.RETRY_PENDING,
          {
            expectedVersion:
              retryCountedJob
                .version,

            failureCode:
              classification
                .code,

            failureMessage:
              'Retryable workflow execution failure; bounded retry scheduled.',
          },
        );

    if (
      retryPendingJob.retryCount
      !== classification
        .retryNumber
    ) {
      throw new Error(
        'Durable retry count does not match retry policy decision.',
      );
    }

    await this.sleepFn(
      classification
        .delayMs,
      signal,
    );
  }

  async runAttempts({
    jobId,
    input,
    signal,
    firstAttempt,
  }) {
    let attempt =
      firstAttempt;

    while (true) {
      try {
        return await attempt();
      } catch (error) {
        await this.handleFailure({
          jobId,
          error,
          signal,
        });

        /*
         * After any explicitly retryable failure, the durable job
         * is RETRY_PENDING.
         *
         * All subsequent attempts use normal ExecutionWorker.run().
         * The worker reuses the existing same-process JobContext
         * and session, while WorkflowEngine skips its already
         * completed response prefix.
         */
        attempt =
          () =>
            this.executionWorker
              .run({
                jobId,

                input,

                signal,
              });
      }
    }
  }

  async run({
    jobId,
    input = {},
    signal = null,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    requireObject(
      input,
      'input',
    );

    return this.runAttempts({
      jobId:
        normalizedJobId,

      input,

      signal,

      firstAttempt:
        () =>
          this.executionWorker
            .run({
              jobId:
                normalizedJobId,

              input,

              signal,
            }),
    });
  }

  /*
   * Explicit manual-challenge continuation.
   *
   * Calling this method is the only path through this class that
   * invokes ExecutionWorker.resumeManualChallenge().
   *
   * The first resumed attempt therefore requires:
   *
   * - durable WAITING_FOR_MANUAL_CHALLENGE state;
   * - original same-process JobContext;
   * - original session/cookies;
   * - original live IP allocation.
   *
   * If that explicit resumed attempt later fails with an error
   * declared retryable, the normal bounded retry path takes over.
   *
   * A repeated MANUAL_CHALLENGE_REQUIRED is never auto-resumed.
   */
  async resumeManualChallenge({
    jobId,
    signal = null,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    return this.runAttempts({
      jobId:
        normalizedJobId,

      /*
       * No new input is accepted here.
       *
       * Manual resume must use the original input already held in
       * the memory-only JobContext.
       */
      input: {},

      signal,

      firstAttempt:
        () =>
          this.executionWorker
            .resumeManualChallenge({
              jobId:
                normalizedJobId,

              signal,
            }),
    });
  }
}