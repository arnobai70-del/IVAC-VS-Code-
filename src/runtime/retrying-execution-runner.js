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

/*
 * Safe wrapper used only for errors that the existing retry
 * policy classified as terminal execution failures.
 *
 * Raw error text is deliberately not copied into public fields.
 * A later finalization layer may use failureCode,
 * retryDecision, and retryCount to create a bounded safe
 * FAILURE final result.
 */
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
 * Adds bounded same-process retry around ExecutionWorker only.
 *
 * Important:
 *
 *     ExecutionWorker
 *         -> RetryingExecutionRunner
 *         -> FinalizingExecutionRunner
 *
 * FinalResultService must remain OUTSIDE this retry boundary.
 * Otherwise a Portal final-result delivery failure could replay
 * the already-completed target workflow.
 *
 * Safety boundaries:
 *
 * - only explicitly retryable errors are retried;
 * - retries preserve the same job and same IP allocation;
 * - this class never calls acquireForJob();
 * - retry allocation becomes RETRY_RESERVED, never released;
 * - retry count is durable in JobStore;
 * - manual challenge is never retried;
 * - shutdown/AbortError never consumes retry budget;
 * - unknown/non-retryable errors fail closed;
 * - exhausted retry becomes an explicit terminal-failure signal;
 * - no raw error message is persisted;
 * - execution input remains the same in-memory object;
 * - no claim is made that input/session survives restart.
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

    while (true) {
      try {
        return await this.executionWorker
          .run({
            jobId:
              normalizedJobId,

            input,

            signal,
          });
      } catch (error) {
        const job =
          this.getJob(
            normalizedJobId,
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
           * ExecutionWorker already moves a detected human
           * challenge to WAITING_FOR_MANUAL_CHALLENGE.
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

        /*
         * A normal retryable workflow failure should still be
         * RUNNING here.
         *
         * Manual challenge and shutdown were handled above.
         * Anything else fails closed rather than forcing an
         * invalid lifecycle transition.
         */
        if (
          job.state
          !== JOB_STATES.RUNNING
        ) {
          throw new Error(
            `Retryable job ${normalizedJobId} is in unexpected state ${job.state}.`,
            {
              cause:
                error,
            },
          );
        }

        /*
         * Consume retry budget durably before scheduling another
         * attempt.
         *
         * If the process stops after this point, restart recovery
         * sees the consumed retry budget and cannot accidentally
         * grant unlimited attempts.
         */
        const retryCountedJob =
          this.jobStore
            .incrementRetry(
              normalizedJobId,
              {
                expectedVersion:
                  job.version,
              },
            );

        /*
         * Keep the exact same live allocation tied to the job.
         *
         * markRetryReserved() does not acquire another proxy/IP.
         */
        this.ipAllocator
          .markRetryReserved(
            normalizedJobId,
          );

        const retryPendingJob =
          this.jobStore
            .transitionJob(
              normalizedJobId,
              JOB_STATES.RETRY_PENDING,
              {
                expectedVersion:
                  retryCountedJob
                    .version,

                failureCode:
                  classification
                    .code,

                /*
                 * Fixed bounded text only.
                 * Never persist the arbitrary upstream error
                 * message.
                 */
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

        /*
         * The wait is abort-aware and uses only bounded delay
         * metadata supplied by retry-policy.js.
         *
         * Abort leaves the job RETRY_PENDING with the same IP.
         * Restart recovery can then reason from durable state.
         */
        await this.sleepFn(
          classification
            .delayMs,
          signal,
        );

        /*
         * Loop back into ExecutionWorker.
         *
         * It explicitly accepts RETRY_PENDING and activates the
         * same live allocation. Same-process SessionManager and
         * JobContext reuse preserve the same dispatcher/session
         * without claiming restart persistence.
         */
      }
    }
  }
}