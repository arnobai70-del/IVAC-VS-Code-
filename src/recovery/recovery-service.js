import {
  randomUUID,
} from 'node:crypto';

import {
  JOB_STATES,
  isTerminalJobState,
} from '../jobs/job-state.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
} from '../results/final-result-store.js';

import {
  RECOVERY_STATUSES,
} from './recovery-store.js';

import {
  DEFAULT_MAX_RETRIES,
  retryDateFrom,
} from './retry-policy.js';

function findWorkflowStep(
  workflow,
  stepId,
) {
  if (
    !stepId
    || !workflow
    || !Array.isArray(
      workflow.steps,
    )
  ) {
    return null;
  }

  return (
    workflow.steps.find(
      (step) =>
        step?.id === stepId,
    )
    ?? null
  );
}

function isUnsafeDocumentReplay(
  workflow,
  stepId,
) {
  const step =
    findWorkflowStep(
      workflow,
      stepId,
    );

  return (
    step?.type
    === 'documents.upload'
  );
}

export class RecoveryService {
  constructor({
    jobStore,
    ipAllocator,
    recoveryStore,
    finalResultStore,
    finalResultService,
    workflow,
    maxRetries =
      DEFAULT_MAX_RETRIES,
    bootId =
      randomUUID(),
  }) {
    if (
      !jobStore
      || typeof jobStore
        .listIncompleteJobs
        !== 'function'
    ) {
      throw new TypeError(
        'jobStore with listIncompleteJobs() is required.',
      );
    }

    if (
      !ipAllocator
      || typeof ipAllocator
        .getActiveForJob
        !== 'function'
      || typeof ipAllocator
        .markRetryReserved
        !== 'function'
    ) {
      throw new TypeError(
        'ipAllocator with recovery allocation methods is required.',
      );
    }

    if (
      !recoveryStore
      || typeof recoveryStore
        .recordRestart
        !== 'function'
    ) {
      throw new TypeError(
        'recoveryStore is required.',
      );
    }

    if (
      !finalResultStore
      || typeof finalResultStore
        .getByJobId
        !== 'function'
      || typeof finalResultStore
        .markInterruptedInFlightUncertain
        !== 'function'
    ) {
      throw new TypeError(
        'finalResultStore is required.',
      );
    }

    if (
      !finalResultService
      || typeof finalResultService
        .finalizeDeliveredRecord
        !== 'function'
    ) {
      throw new TypeError(
        'finalResultService is required.',
      );
    }

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

    if (
      typeof bootId !== 'string'
      || bootId.trim() === ''
    ) {
      throw new TypeError(
        'bootId must be a non-empty string.',
      );
    }

    this.jobStore =
      jobStore;

    this.ipAllocator =
      ipAllocator;

    this.recoveryStore =
      recoveryStore;

    this.finalResultStore =
      finalResultStore;

    this.finalResultService =
      finalResultService;

    this.workflow =
      workflow;

    this.maxRetries =
      maxRetries;

    this.bootId =
      bootId.trim();
  }

  record({
    job,
    recoveryStatus,
    reasonCode,
    nextRetryAt = null,
    sessionLost = true,
    markRecovered = true,
  }) {
    return this.recoveryStore
      .recordRestart({
        jobId:
          job.id,

        bootId:
          this.bootId,

        recoveryStatus,

        sessionLost,

        lastObservedState:
          job.state,

        lastObservedStep:
          job.currentStep,

        reasonCode,

        nextRetryAt,

        markRecovered,
      });
  }

  preserveSameIpForRetry(
    jobId,
  ) {
    const allocation =
      this.ipAllocator
        .getActiveForJob(
          jobId,
        );

    if (!allocation) {
      return null;
    }

    /*
     * This changes ACTIVE/RESERVED to RETRY_RESERVED.
     * It does NOT release the allocation and therefore
     * preserves the exact same proxy/IP for the job.
     */
    return this.ipAllocator
      .markRetryReserved(
        jobId,
      );
  }

  recoverFinalResult(
    job,
    record,
  ) {
    if (
      record.deliveryStatus
      === FINAL_RESULT_DELIVERY_STATUSES
        .IN_FLIGHT
    ) {
      this.finalResultStore
        .markInterruptedInFlightUncertain(
          job.id,
        );

      return {
        action:
          'FINAL_RESULT_UNCERTAIN',

        recovery:
          this.record({
            job,

            recoveryStatus:
              RECOVERY_STATUSES
                .FINAL_RESULT_UNCERTAIN,

            reasonCode:
              'PROCESS_RESTART_DURING_FINAL_RESULT',
          }),
      };
    }

    if (
      record.deliveryStatus
      === FINAL_RESULT_DELIVERY_STATUSES
        .UNCERTAIN
    ) {
      return {
        action:
          'FINAL_RESULT_UNCERTAIN',

        recovery:
          this.record({
            job,

            recoveryStatus:
              RECOVERY_STATUSES
                .FINAL_RESULT_UNCERTAIN,

            reasonCode:
              'FINAL_RESULT_DELIVERY_UNCERTAIN',
          }),
      };
    }

    if (
      record.deliveryStatus
      === FINAL_RESULT_DELIVERY_STATUSES
        .DELIVERED
    ) {
      const finalized =
        this.finalResultService
          .finalizeDeliveredRecord(
            record,
          );

      return {
        action:
          'FINAL_RESULT_TERMINALIZED',

        finalized,

        recovery:
          this.record({
            job:
              finalized.job,

            recoveryStatus:
              RECOVERY_STATUSES
                .FINAL_RESULT_DELIVERED,

            reasonCode:
              'FINAL_RESULT_ALREADY_DELIVERED',

            sessionLost:
              true,
          }),
      };
    }

    return {
      action:
        'FINAL_RESULT_PENDING',

      recovery:
        this.record({
          job,

          recoveryStatus:
            RECOVERY_STATUSES
              .FINAL_RESULT_PENDING,

          reasonCode:
            'FINAL_RESULT_PENDING',
        }),
    };
  }

  recoverManualChallenge(
    job,
  ) {
    return {
      action:
        'WAITING_MANUAL',

      recovery:
        this.record({
          job,

          recoveryStatus:
            RECOVERY_STATUSES
              .WAITING_MANUAL,

          reasonCode:
            'MANUAL_CHALLENGE_REQUIRED',
        }),
    };
  }

  recoverUnsafeDocumentStep(
    job,
  ) {
    this.preserveSameIpForRetry(
      job.id,
    );

    return {
      action:
        'BLOCKED_UNSAFE_REPLAY',

      recovery:
        this.record({
          job,

          recoveryStatus:
            RECOVERY_STATUSES
              .BLOCKED_UNSAFE_REPLAY,

          reasonCode:
            'DOCUMENT_UPLOAD_REPLAY_UNVERIFIED',
        }),
    };
  }

  recoverRetryPending(
    job,
  ) {
    this.preserveSameIpForRetry(
      job.id,
    );

    const retryNumber =
      Math.max(
        1,
        job.retryCount,
      );

    return {
      action:
        'RETRY_SCHEDULED',

      recovery:
        this.record({
          job,

          recoveryStatus:
            RECOVERY_STATUSES
              .RETRY_SCHEDULED,

          reasonCode:
            'PROCESS_RESTART_WHILE_RETRY_PENDING',

          nextRetryAt:
            retryDateFrom({
              retryNumber,
            }),
        }),
    };
  }

  recoverInterruptedExecution(
    job,
  ) {
    this.preserveSameIpForRetry(
      job.id,
    );

    if (
      job.retryCount
      >= this.maxRetries
    ) {
      return {
        action:
          'RETRY_EXHAUSTED',

        recovery:
          this.record({
            job,

            recoveryStatus:
              RECOVERY_STATUSES
                .RETRY_EXHAUSTED,

            reasonCode:
              'PROCESS_RESTART_RETRY_EXHAUSTED',
          }),
      };
    }

    const incremented =
      this.jobStore
        .incrementRetry(
          job.id,
          {
            expectedVersion:
              job.version,
          },
        );

    const retryNumber =
      incremented.retryCount;

    const transitioned =
      this.jobStore
        .transitionJob(
          job.id,
          JOB_STATES.RETRY_PENDING,
          {
            expectedVersion:
              incremented.version,

            currentStep:
              incremented.currentStep,
          },
        );

    return {
      action:
        'RETRY_SCHEDULED',

      job:
        transitioned,

      recovery:
        this.record({
          job:
            transitioned,

          recoveryStatus:
            RECOVERY_STATUSES
              .RETRY_SCHEDULED,

          reasonCode:
            'PROCESS_RESTART_INTERRUPTED_EXECUTION',

          nextRetryAt:
            retryDateFrom({
              retryNumber,
            }),
        }),
    };
  }

  recoverPreExecution(
    job,
  ) {
    /*
     * PENDING / CLAIMED / WAITING_FOR_IP have not yet
     * reached a durable workflow execution point.
     *
     * No session continuity is assumed and no retry
     * counter is consumed merely because the process
     * restarted.
     */
    return {
      action:
        'PRE_EXECUTION_RECOVERABLE',

      recovery:
        this.record({
          job,

          recoveryStatus:
            RECOVERY_STATUSES.NONE,

          reasonCode:
            'PROCESS_RESTART_BEFORE_EXECUTION',

          sessionLost:
            false,
        }),
    };
  }

  recoverJob(
    job,
  ) {
    if (
      !job
      || typeof job !== 'object'
    ) {
      throw new TypeError(
        'job is required.',
      );
    }

    if (
      isTerminalJobState(
        job.state,
      )
    ) {
      return {
        action:
          'TERMINAL_NOOP',

        recovery:
          null,
      };
    }

    const finalResult =
      this.finalResultStore
        .getByJobId(
          job.id,
        );

    if (finalResult) {
      return this.recoverFinalResult(
        job,
        finalResult,
      );
    }

    if (
      job.state
      === JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE
    ) {
      return this.recoverManualChallenge(
        job,
      );
    }

    if (
      isUnsafeDocumentReplay(
        this.workflow,
        job.currentStep,
      )
    ) {
      return this.recoverUnsafeDocumentStep(
        job,
      );
    }

    if (
      job.state
      === JOB_STATES.RETRY_PENDING
    ) {
      return this.recoverRetryPending(
        job,
      );
    }

    if (
      job.state
        === JOB_STATES.RUNNING
      || job.state
        === JOB_STATES.WAITING_FOR_OTP
    ) {
      return this.recoverInterruptedExecution(
        job,
      );
    }

    if (
      job.state
        === JOB_STATES.PENDING
      || job.state
        === JOB_STATES.CLAIMED
      || job.state
        === JOB_STATES.WAITING_FOR_IP
    ) {
      return this.recoverPreExecution(
        job,
      );
    }

    return {
      action:
        'BLOCKED_SESSION_LOSS',

      recovery:
        this.record({
          job,

          recoveryStatus:
            RECOVERY_STATUSES
              .BLOCKED_SESSION_LOSS,

          reasonCode:
            'SESSION_STATE_NOT_RECOVERABLE',
        }),
    };
  }

  recoverAll() {
    const jobs =
      this.jobStore
        .listIncompleteJobs();

    const results = [];

    for (const job of jobs) {
      results.push(
        {
          jobId:
            job.id,

          ...this.recoverJob(
            job,
          ),
        },
      );
    }

    return results;
  }
}