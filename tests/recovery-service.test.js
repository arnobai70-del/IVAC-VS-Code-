import test from 'node:test';

import assert from 'node:assert/strict';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
} from '../src/results/final-result-store.js';

import {
  RecoveryService,
} from '../src/recovery/recovery-service.js';

import {
  RECOVERY_STATUSES,
} from '../src/recovery/recovery-store.js';

function createJob(
  overrides = {},
) {
  return {
    id:
      'job-1',

    applicationId:
      'application-1',

    userId:
      'user-1',

    state:
      JOB_STATES.RUNNING,

    currentStep:
      'step-1',

    retryCount:
      0,

    version:
      1,

    ...overrides,
  };
}

function createHarness({
  job =
    createJob(),

  allocation = {
    allocationId:
      'allocation-1',

    jobId:
      'job-1',

    proxyId:
      'proxy-1',

    ip:
      '203.0.113.10',

    port:
      8080,

    status:
      'ACTIVE',
  },

  finalResult =
    null,

  workflow = {
    steps: [
      {
        id:
          'step-1',

        type:
          'http',
      },
    ],
  },

  maxRetries =
    3,
} = {}) {
  const calls = {
    retryReserved:
      [],

    incrementRetry:
      [],

    transitionJob:
      [],

    recovery:
      [],

    markInterrupted:
      [],

    finalized:
      [],
  };

  let currentJob =
    {
      ...job,
    };

  const jobStore = {
    listIncompleteJobs() {
      return [
        {
          ...currentJob,
        },
      ];
    },

    incrementRetry(
      jobId,
      {
        expectedVersion,
      } = {},
    ) {
      calls.incrementRetry.push({
        jobId,
        expectedVersion,
      });

      assert.equal(
        expectedVersion,
        currentJob.version,
      );

      currentJob = {
        ...currentJob,

        retryCount:
          currentJob.retryCount
          + 1,

        version:
          currentJob.version
          + 1,
      };

      return {
        ...currentJob,
      };
    },

    transitionJob(
      jobId,
      toState,
      {
        expectedVersion,
        currentStep,
      } = {},
    ) {
      calls.transitionJob.push({
        jobId,
        toState,
        expectedVersion,
        currentStep,
      });

      assert.equal(
        expectedVersion,
        currentJob.version,
      );

      currentJob = {
        ...currentJob,

        state:
          toState,

        currentStep:
          currentStep
          ?? currentJob.currentStep,

        version:
          currentJob.version
          + 1,
      };

      return {
        ...currentJob,
      };
    },
  };

  const ipAllocator = {
    getActiveForJob(
      jobId,
    ) {
      if (
        !allocation
        || allocation.jobId
          !== jobId
      ) {
        return null;
      }

      return {
        ...allocation,
      };
    },

    markRetryReserved(
      jobId,
    ) {
      calls.retryReserved.push(
        jobId,
      );

      return {
        ...allocation,

        status:
          'RETRY_RESERVED',
      };
    },
  };

  const recoveryStore = {
    recordRestart(
      input,
    ) {
      calls.recovery.push({
        ...input,
      });

      return {
        jobId:
          input.jobId,

        recoveryStatus:
          input.recoveryStatus,

        sessionLost:
          input.sessionLost,

        lastObservedState:
          input.lastObservedState,

        lastObservedStep:
          input.lastObservedStep,

        lastReasonCode:
          input.reasonCode,

        nextRetryAt:
          input.nextRetryAt,

        lastRecoveryBootId:
          input.bootId,
      };
    },
  };

  let currentFinalResult =
    finalResult
      ? {
          ...finalResult,
        }
      : null;

  const finalResultStore = {
    getByJobId() {
      return currentFinalResult
        ? {
            ...currentFinalResult,
          }
        : null;
    },

    markInterruptedInFlightUncertain(
      jobId,
    ) {
      calls.markInterrupted.push(
        jobId,
      );

      currentFinalResult = {
        ...currentFinalResult,

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .UNCERTAIN,
      };

      return {
        ...currentFinalResult,
      };
    },
  };

  const finalResultService = {
    finalizeDeliveredRecord(
      record,
    ) {
      calls.finalized.push(
        record.jobId,
      );

      currentJob = {
        ...currentJob,

        state:
          record.terminalState,

        version:
          currentJob.version
          + 1,
      };

      return {
        job:
          {
            ...currentJob,
          },

        result:
          {
            ...record,
          },

        ipRelease: {
          released:
            true,
        },
      };
    },
  };

  const service =
    new RecoveryService({
      jobStore,
      ipAllocator,
      recoveryStore,
      finalResultStore,
      finalResultService,
      workflow,
      maxRetries,
      bootId:
        'boot-test-1',
    });

  return {
    service,
    calls,

    getCurrentJob() {
      return {
        ...currentJob,
      };
    },
  };
}

test(
  'interrupted RUNNING job becomes bounded RETRY_PENDING and preserves same IP',
  () => {
    const harness =
      createHarness();

    const result =
      harness.service
        .recoverJob(
          createJob(),
        );

    assert.equal(
      result.action,
      'RETRY_SCHEDULED',
    );

    assert.deepEqual(
      harness.calls.retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      harness.calls.incrementRetry.length,
      1,
    );

    assert.equal(
      harness.calls.transitionJob.length,
      1,
    );

    assert.equal(
      harness.calls.transitionJob[0]
        .toState,
      JOB_STATES.RETRY_PENDING,
    );

    assert.equal(
      result.job.retryCount,
      1,
    );

    assert.equal(
      result.job.state,
      JOB_STATES.RETRY_PENDING,
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .RETRY_SCHEDULED,
    );

    assert.ok(
      result.recovery
        .nextRetryAt,
    );
  },
);

test(
  'restart does not release a non-terminal job IP',
  () => {
    const harness =
      createHarness();

    harness.service
      .recoverJob(
        createJob(),
      );

    assert.deepEqual(
      harness.calls.retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      'releaseForJob'
      in harness.service
        .ipAllocator,
      false,
    );
  },
);

test(
  'retry exhaustion stops additional execution retries',
  () => {
    const job =
      createJob({
        retryCount:
          3,
      });

    const harness =
      createHarness({
        job,
        maxRetries:
          3,
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'RETRY_EXHAUSTED',
    );

    assert.equal(
      harness.calls.incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls.transitionJob.length,
      0,
    );

    assert.deepEqual(
      harness.calls.retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .RETRY_EXHAUSTED,
    );
  },
);

test(
  'WAITING_FOR_MANUAL_CHALLENGE is never automatically resumed',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,
      });

    const harness =
      createHarness({
        job,
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'WAITING_MANUAL',
    );

    assert.equal(
      harness.calls.incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls.transitionJob.length,
      0,
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .WAITING_MANUAL,
    );
  },
);

test(
  'documents.upload restart point is blocked from blind replay',
  () => {
    const job =
      createJob({
        currentStep:
          'upload-documents',
      });

    const harness =
      createHarness({
        job,

        workflow: {
          steps: [
            {
              id:
                'upload-documents',

              type:
                'documents.upload',
            },
          ],
        },
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'BLOCKED_UNSAFE_REPLAY',
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .BLOCKED_UNSAFE_REPLAY,
    );

    assert.equal(
      result.recovery
        .lastReasonCode,
      'DOCUMENT_UPLOAD_REPLAY_UNVERIFIED',
    );

    assert.deepEqual(
      harness.calls.retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      harness.calls.transitionJob.length,
      0,
    );
  },
);

test(
  'stale IN_FLIGHT final result becomes UNCERTAIN after restart',
  () => {
    const job =
      createJob();

    const harness =
      createHarness({
        job,

        finalResult: {
          jobId:
            job.id,

          terminalState:
            JOB_STATES.COMPLETED,

          deliveryStatus:
            FINAL_RESULT_DELIVERY_STATUSES
              .IN_FLIGHT,
        },
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'FINAL_RESULT_UNCERTAIN',
    );

    assert.deepEqual(
      harness.calls.markInterrupted,
      [
        'job-1',
      ],
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .FINAL_RESULT_UNCERTAIN,
    );

    assert.equal(
      harness.calls.finalized.length,
      0,
    );
  },
);

test(
  'already UNCERTAIN final result is not blindly replayed',
  () => {
    const job =
      createJob();

    const harness =
      createHarness({
        job,

        finalResult: {
          jobId:
            job.id,

          terminalState:
            JOB_STATES.COMPLETED,

          deliveryStatus:
            FINAL_RESULT_DELIVERY_STATUSES
              .UNCERTAIN,
        },
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'FINAL_RESULT_UNCERTAIN',
    );

    assert.equal(
      harness.calls.markInterrupted.length,
      0,
    );

    assert.equal(
      harness.calls.finalized.length,
      0,
    );
  },
);

test(
  'DELIVERED final result resumes terminalization instead of resending',
  () => {
    const job =
      createJob();

    const harness =
      createHarness({
        job,

        finalResult: {
          jobId:
            job.id,

          terminalState:
            JOB_STATES.COMPLETED,

          deliveryStatus:
            FINAL_RESULT_DELIVERY_STATUSES
              .DELIVERED,
        },
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'FINAL_RESULT_TERMINALIZED',
    );

    assert.deepEqual(
      harness.calls.finalized,
      [
        'job-1',
      ],
    );

    assert.equal(
      result.finalized.job.state,
      JOB_STATES.COMPLETED,
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .FINAL_RESULT_DELIVERED,
    );
  },
);

test(
  'PENDING final result stays pending instead of being automatically sent',
  () => {
    const job =
      createJob();

    const harness =
      createHarness({
        job,

        finalResult: {
          jobId:
            job.id,

          terminalState:
            JOB_STATES.COMPLETED,

          deliveryStatus:
            FINAL_RESULT_DELIVERY_STATUSES
              .PENDING,
        },
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'FINAL_RESULT_PENDING',
    );

    assert.equal(
      harness.calls.finalized.length,
      0,
    );

    assert.equal(
      harness.calls.markInterrupted.length,
      0,
    );

    assert.equal(
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .FINAL_RESULT_PENDING,
    );
  },
);

test(
  'pre-execution restart does not consume retry budget',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES.WAITING_FOR_IP,

        currentStep:
          null,
      });

    const harness =
      createHarness({
        job,
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'PRE_EXECUTION_RECOVERABLE',
    );

    assert.equal(
      harness.calls.incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls.transitionJob.length,
      0,
    );

    assert.equal(
      result.recovery
        .sessionLost,
      false,
    );
  },
);

test(
  'existing RETRY_PENDING state keeps retry budget unchanged on restart',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES.RETRY_PENDING,

        retryCount:
          2,
      });

    const harness =
      createHarness({
        job,
      });

    const result =
      harness.service
        .recoverJob(
          job,
        );

    assert.equal(
      result.action,
      'RETRY_SCHEDULED',
    );

    assert.equal(
      harness.calls.incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls.transitionJob.length,
      0,
    );

    assert.deepEqual(
      harness.calls.retryReserved,
      [
        'job-1',
      ],
    );
  },
);