import {
  JobContext,
} from '../jobs/job-context.js';

import {
  isTerminalJobState,
  JOB_STATES,
} from '../jobs/job-state.js';

const MANUAL_CHALLENGE_CODE =
  'MANUAL_CHALLENGE_REQUIRED';

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

function errorCode(
  error,
) {
  if (
    error
    && typeof error.code
      === 'string'
    && error.code.trim() !== ''
  ) {
    return error.code.trim();
  }

  return null;
}

function isManualChallenge(
  error,
) {
  return (
    errorCode(error)
    === MANUAL_CHALLENGE_CODE
  );
}

function isAbortRequested(
  signal,
) {
  return signal?.aborted
    === true;
}

function assertRunnableState(
  job,
) {
  if (
    job.state
    !== JOB_STATES.WAITING_FOR_IP
    && job.state
      !== JOB_STATES.RETRY_PENDING
  ) {
    throw new Error(
      `Job ${job.id} cannot begin execution from state ${job.state}.`,
    );
  }
}

function assertSameAllocation(
  before,
  after,
) {
  if (
    before.allocationId
    !== after.allocationId
    || before.jobId
      !== after.jobId
    || before.ip
      !== after.ip
    || before.port
      !== after.port
  ) {
    throw new Error(
      'IP allocation changed while execution was being activated.',
    );
  }
}

/*
 * Runs one workflow execution against an already-bound job/IP.
 *
 * Important boundaries:
 *
 * - this worker NEVER acquires a replacement IP;
 * - the intake-bound allocation must already exist;
 * - activation keeps that exact allocation/IP;
 * - retry scheduling is not performed here;
 * - retry limits remain the recovery/retry-policy concern;
 * - non-terminal errors never release an IP;
 * - shutdown/abort never releases an IP;
 * - human challenges become WAITING_FOR_MANUAL_CHALLENGE;
 * - successful workflow execution does NOT directly mark the
 *   job COMPLETED;
 * - terminalization remains the FinalResultService concern;
 * - sessions/cookies remain memory-only and are never claimed
 *   to survive restart;
 * - Portal input is accepted only as in-memory JobContext input
 *   and is never persisted by this worker.
 *
 * executeWorkflow is intentionally injected. Construction of
 * per-job TargetHttpClient, OTP service, document service, and
 * WorkflowEngine is a separate integration concern and must use
 * their verified existing contracts rather than being guessed
 * here.
 */
export class ExecutionWorker {
  constructor({
    jobStore,
    ipAllocator,
    sessionManager,
    executeWorkflow,
  }) {
    requireObject(
      jobStore,
      'jobStore',
    );

    requireFunction(
      jobStore.getJobById,
      'jobStore.getJobById',
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
      ipAllocator.getActiveForJob,
      'ipAllocator.getActiveForJob',
    );

    requireFunction(
      ipAllocator.activateForJob,
      'ipAllocator.activateForJob',
    );

    requireObject(
      sessionManager,
      'sessionManager',
    );

    requireFunction(
      sessionManager.createForJob,
      'sessionManager.createForJob',
    );

    requireFunction(
      sessionManager.closeForJob,
      'sessionManager.closeForJob',
    );

    requireFunction(
      executeWorkflow,
      'executeWorkflow',
    );

    this.jobStore =
      jobStore;

    this.ipAllocator =
      ipAllocator;

    this.sessionManager =
      sessionManager;

    this.executeWorkflow =
      executeWorkflow;

    /*
     * JobContext is intentionally memory-only.
     *
     * Reusing it within one process preserves per-job OTP,
     * responses, prepared documents, and document upload state
     * across an explicitly scheduled same-process retry.
     *
     * Nothing in this map is restart-recoverable.
     */
    this.contexts =
      new Map();

    this.inFlight =
      new Set();
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

    if (
      this.inFlight.has(
        normalizedJobId,
      )
    ) {
      throw new Error(
        `Job ${normalizedJobId} already has an in-flight execution.`,
      );
    }

    const initialJob =
      this.jobStore
        .getJobById(
          normalizedJobId,
        );

    if (!initialJob) {
      throw new Error(
        `Job ${normalizedJobId} does not exist.`,
      );
    }

    if (
      isTerminalJobState(
        initialJob.state,
      )
    ) {
      throw new Error(
        `Terminal job ${normalizedJobId} cannot execute.`,
      );
    }

    assertRunnableState(
      initialJob,
    );

    /*
     * Intake already bound an IP allocation to this job.
     *
     * Do not call acquireForJob() here. If that allocation is
     * missing, execution fails closed instead of silently
     * assigning another IP.
     */
    const reservedAllocation =
      this.ipAllocator
        .getActiveForJob(
          normalizedJobId,
        );

    if (!reservedAllocation) {
      throw new Error(
        `Job ${normalizedJobId} has no live intake-bound IP allocation.`,
      );
    }

    if (
      reservedAllocation.jobId
      !== normalizedJobId
    ) {
      throw new Error(
        'Live allocation belongs to another job.',
      );
    }

    this.inFlight.add(
      normalizedJobId,
    );

    try {
      /*
       * activateForJob() activates the existing live allocation.
       * The identity assertion prevents execution if storage ever
       * returns a different allocation/IP during activation.
       */
      const activeAllocation =
        this.ipAllocator
          .activateForJob(
            normalizedJobId,
          );

      assertSameAllocation(
        reservedAllocation,
        activeAllocation,
      );

      const runningJob =
        this.jobStore
          .transitionJob(
            normalizedJobId,
            JOB_STATES.RUNNING,
            {
              expectedVersion:
                initialJob.version,
            },
          );

      const session =
        await this.sessionManager
          .createForJob({
            job:
              runningJob,

            allocation:
              activeAllocation,
          });

      let jobContext =
        this.contexts.get(
          normalizedJobId,
        );

      if (jobContext) {
        /*
         * A same-process retry may reuse only the same allocation
         * and the same in-memory session identity.
         */
        if (
          jobContext.allocation
            .allocationId
          !== activeAllocation
            .allocationId
          || jobContext.session
            .sessionId
            !== session.sessionId
        ) {
          throw new Error(
            'Existing job context does not match the active session/allocation.',
          );
        }

        jobContext.job =
          runningJob;

        jobContext.allocation =
          activeAllocation;
      } else {
        jobContext =
          new JobContext({
            job:
              runningJob,

            allocation:
              activeAllocation,

            dispatcher:
              session.dispatcher,

            cookieJar:
              session.cookieJar,

            session,

            input,
          });

        this.contexts.set(
          normalizedJobId,
          jobContext,
        );
      }

      jobContext.setRetryState({
        attempt:
          runningJob.retryCount,

        lastErrorCode:
          null,
      });

      let workflowResult;

      try {
        workflowResult =
          await this.executeWorkflow({
            jobContext,
            signal,
          });
      } catch (error) {
        /*
         * Shutdown is deliberately non-terminal.
         *
         * GracefulShutdown owns session/dispatcher cleanup and
         * durable restart recovery owns the interrupted RUNNING
         * state. The IP remains attached to this job.
         */
        if (
          isAbortRequested(
            signal,
          )
        ) {
          throw error;
        }

        /*
         * Human/anti-bot challenges must never be bypassed or
         * automatically retried.
         *
         * Persist only the bounded error code plus a fixed safe
         * message. Never persist challenge HTML, cookies, OTPs,
         * request bodies, or arbitrary error text.
         */
        if (
          isManualChallenge(
            error,
          )
        ) {
          const latestJob =
            this.jobStore
              .getJobById(
                normalizedJobId,
              );

          if (
            latestJob?.state
            === JOB_STATES.RUNNING
          ) {
            this.jobStore
              .transitionJob(
                normalizedJobId,
                JOB_STATES
                  .WAITING_FOR_MANUAL_CHALLENGE,
                {
                  currentStep:
                    jobContext
                      .currentStep
                    ?? undefined,

                  failureCode:
                    MANUAL_CHALLENGE_CODE,

                  failureMessage:
                    'Manual challenge handling is required.',

                  expectedVersion:
                    latestJob.version,
                },
              );
          }

          throw error;
        }

        /*
         * Other failures are intentionally not converted into a
         * retry or terminal state here.
         *
         * The existing bounded retry policy must classify them.
         * Until that policy is integrated, leaving RUNNING intact
         * is safer than inventing retryability or prematurely
         * releasing the IP. Restart recovery can safely recognize
         * the interrupted RUNNING job.
         */
        throw error;
      }

      jobContext.setCurrentStep(
        null,
      );

      jobContext.setResult(
        workflowResult,
      );

      /*
       * Do not transition RUNNING -> COMPLETED here.
       *
       * Phase 9 established that terminal state and IP release
       * happen only after the existing final-result flow has
       * durably captured and, where required, acknowledged the
       * result.
       */
      return {
        status:
          'WORKFLOW_COMPLETED',

        jobId:
          normalizedJobId,

        allocationId:
          activeAllocation
            .allocationId,

        workflowResult,
      };
    } finally {
      this.inFlight.delete(
        normalizedJobId,
      );
    }
  }

  getJobContext(
    jobId,
  ) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    return this.contexts.get(
      normalizedJobId,
    )
      ?? null;
  }

  /*
   * Memory-only cleanup for an already-terminal job.
   *
   * This method never releases the IP. Terminal IP release stays
   * under the existing FinalResultService/IpAllocator lifecycle.
   */
  async closeTerminalJob(
    jobId,
  ) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    if (
      this.inFlight.has(
        normalizedJobId,
      )
    ) {
      throw new Error(
        `Cannot close terminal resources while job ${normalizedJobId} is executing.`,
      );
    }

    const job =
      this.jobStore
        .getJobById(
          normalizedJobId,
        );

    if (!job) {
      throw new Error(
        `Job ${normalizedJobId} does not exist.`,
      );
    }

    if (
      !isTerminalJobState(
        job.state,
      )
    ) {
      throw new Error(
        `Job ${normalizedJobId} is not terminal.`,
      );
    }

    this.contexts.delete(
      normalizedJobId,
    );

    return this.sessionManager
      .closeForJob(
        normalizedJobId,
      );
  }

  getStatus() {
    return {
      inFlight:
        this.inFlight.size,

      memoryContexts:
        this.contexts.size,
    };
  }
}