import assert from 'node:assert/strict';
import test from 'node:test';

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
      'sign_in',

    retryCount:
      0,

    version:
      1,

    ...overrides,
  };
}


function createHarness({
  jobs = null,

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
          'sign_in',

        type:
          'http',
      },

      {
        id:
          'wait_signin_otp',

        type:
          'otp.wait',
      },

      {
        id:
          'upload-documents',

        type:
          'documents.upload',
      },
    ],
  },

  maxRetries =
    3,
} = {}) {
  const calls = {
    incrementRetry:
      [],

    transitionJob:
      [],

    retryReserved:
      [],

    recovery:
      [],

    markInterrupted:
      [],

    finalized:
      [],

    releaseForJob:
      [],
  };

  const currentJobs =
    jobs
    ?? [
      createJob(),
    ];

  const jobsById =
    new Map(
      currentJobs.map(
        (job) => [
          job.id,
          structuredClone(
            job,
          ),
        ],
      ),
    );

  let currentFinalResult =
    finalResult
      ? structuredClone(
          finalResult,
        )
      : null;

  const jobStore = {
    listIncompleteJobs() {
      return [
        ...jobsById.values(),
      ].map(
        (job) =>
          structuredClone(
            job,
          ),
      );
    },

    incrementRetry(
      jobId,
      {
        expectedVersion,
      } = {},
    ) {
      const job =
        jobsById.get(
          jobId,
        );

      assert.ok(job);

      assert.equal(
        expectedVersion,
        job.version,
      );

      calls.incrementRetry.push({
        jobId,
        expectedVersion,
      });

      const updated = {
        ...job,

        retryCount:
          job.retryCount
          + 1,

        version:
          job.version
          + 1,
      };

      jobsById.set(
        jobId,
        updated,
      );

      return structuredClone(
        updated,
      );
    },

    transitionJob(
      jobId,
      toState,
      {
        expectedVersion,
        currentStep,
      } = {},
    ) {
      const job =
        jobsById.get(
          jobId,
        );

      assert.ok(job);

      assert.equal(
        expectedVersion,
        job.version,
      );

      calls.transitionJob.push({
        jobId,
        toState,
        expectedVersion,
        currentStep,
      });

      const updated = {
        ...job,

        state:
          toState,

        currentStep:
          currentStep
          ?? job.currentStep,

        version:
          job.version
          + 1,
      };

      jobsById.set(
        jobId,
        updated,
      );

      return structuredClone(
        updated,
      );
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

      return structuredClone(
        allocation,
      );
    },

    markRetryReserved(
      jobId,
    ) {
      calls.retryReserved.push(
        jobId,
      );

      if (
        !allocation
        || allocation.jobId
          !== jobId
      ) {
        return null;
      }

      return {
        ...structuredClone(
          allocation,
        ),

        status:
          'RETRY_RESERVED',
      };
    },

    /*
     * Deliberately present only as a spy.
     * RecoveryService must never release a non-terminal allocation.
     */
    releaseForJob(
      jobId,
    ) {
      calls.releaseForJob.push(
        jobId,
      );

      throw new Error(
        'restart recovery must not release non-terminal IP allocations',
      );
    },
  };

  const recoveryStore = {
    recordRestart(
      input,
    ) {
      calls.recovery.push(
        structuredClone(
          input,
        ),
      );

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

  const finalResultStore = {
    getByJobId(
      jobId,
    ) {
      if (
        !currentFinalResult
        || currentFinalResult.jobId
          !== jobId
      ) {
        return null;
      }

      return structuredClone(
        currentFinalResult,
      );
    },

    markInterruptedInFlightUncertain(
      jobId,
    ) {
      calls.markInterrupted.push(
        jobId,
      );

      assert.ok(
        currentFinalResult,
      );

      currentFinalResult = {
        ...currentFinalResult,

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .UNCERTAIN,
      };

      return structuredClone(
        currentFinalResult,
      );
    },
  };

  const finalResultService = {
    finalizeDeliveredRecord(
      record,
    ) {
      calls.finalized.push(
        record.jobId,
      );

      const job =
        jobsById.get(
          record.jobId,
        );

      assert.ok(job);

      const terminalJob = {
        ...job,

        state:
          record.terminalState,

        version:
          job.version
          + 1,
      };

      jobsById.set(
        record.jobId,
        terminalJob,
      );

      return {
        job:
          structuredClone(
            terminalJob,
          ),

        result:
          structuredClone(
            record,
          ),

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
        'phase-37-boot',
    });

  return {
    service,
    calls,

    getJob(
      jobId =
        'job-1',
    ) {
      const job =
        jobsById.get(
          jobId,
        );

      return job
        ? structuredClone(
            job,
          )
        : null;
    },
  };
}


const preExecutionMatrix = [
  JOB_STATES.PENDING,
  JOB_STATES.CLAIMED,
  JOB_STATES.WAITING_FOR_IP,
];


for (
  const state
  of preExecutionMatrix
) {
  test(
    `restart matrix: ${state} remains pre-execution recoverable without consuming retry budget`,
    () => {
      const job =
        createJob({
          state,

          currentStep:
            null,

          retryCount:
            0,
        });

      const harness =
        createHarness({
          jobs: [
            job,
          ],
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
        result.recovery
          .recoveryStatus,
        RECOVERY_STATUSES.NONE,
      );

      assert.equal(
        result.recovery
          .sessionLost,
        false,
      );

      assert.equal(
        harness.calls
          .incrementRetry.length,
        0,
      );

      assert.equal(
        harness.calls
          .transitionJob.length,
        0,
      );

      assert.equal(
        harness.calls
          .retryReserved.length,
        0,
      );

      assert.equal(
        harness.calls
          .releaseForJob.length,
        0,
      );
    },
  );
}


const interruptedExecutionMatrix = [
  JOB_STATES.RUNNING,
  JOB_STATES.WAITING_FOR_OTP,
];


for (
  const state
  of interruptedExecutionMatrix
) {
  test(
    `restart matrix: ${state} becomes bounded RETRY_PENDING while preserving the allocation`,
    () => {
      const job =
        createJob({
          state,

          retryCount:
            0,
        });

      const harness =
        createHarness({
          jobs: [
            job,
          ],
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
        result.job.state,
        JOB_STATES.RETRY_PENDING,
      );

      assert.equal(
        result.job.retryCount,
        1,
      );

      assert.equal(
        harness.calls
          .incrementRetry.length,
        1,
      );

      assert.equal(
        harness.calls
          .transitionJob.length,
        1,
      );

      assert.deepEqual(
        harness.calls
          .retryReserved,
        [
          'job-1',
        ],
      );

      assert.equal(
        harness.calls
          .releaseForJob.length,
        0,
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
}


test(
  'restart matrix: RETRY_PENDING preserves retry budget and same allocation',
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
        jobs: [
          job,
        ],
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
      harness.calls
        .incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls
        .transitionJob.length,
      0,
    );

    assert.deepEqual(
      harness.calls
        .retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      harness.calls
        .releaseForJob.length,
      0,
    );

    assert.equal(
      harness.getJob()
        .retryCount,
      2,
    );
  },
);


test(
  'restart matrix: retry exhaustion never schedules another execution attempt',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES.RUNNING,

        retryCount:
          3,
      });

    const harness =
      createHarness({
        jobs: [
          job,
        ],

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
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .RETRY_EXHAUSTED,
    );

    assert.equal(
      harness.calls
        .incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls
        .transitionJob.length,
      0,
    );

    assert.deepEqual(
      harness.calls
        .retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      harness.calls
        .releaseForJob.length,
      0,
    );
  },
);


test(
  'restart matrix: manual challenge never auto-resumes, retries, or releases its allocation',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,

        currentStep:
          'verify_signin_otp',
      });

    const harness =
      createHarness({
        jobs: [
          job,
        ],
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
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .WAITING_MANUAL,
    );

    assert.equal(
      harness.calls
        .incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls
        .transitionJob.length,
      0,
    );

    assert.equal(
      harness.calls
        .retryReserved.length,
      0,
    );

    assert.equal(
      harness.calls
        .releaseForJob.length,
      0,
    );
  },
);


test(
  'restart matrix: document upload crash point blocks blind replay and preserves allocation',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES.RUNNING,

        currentStep:
          'upload-documents',
      });

    const harness =
      createHarness({
        jobs: [
          job,
        ],
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
      harness.calls
        .retryReserved,
      [
        'job-1',
      ],
    );

    assert.equal(
      harness.calls
        .incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls
        .transitionJob.length,
      0,
    );

    assert.equal(
      harness.calls
        .releaseForJob.length,
      0,
    );
  },
);


const finalResultMatrix = [
  {
    deliveryStatus:
      FINAL_RESULT_DELIVERY_STATUSES
        .PENDING,

    expectedAction:
      'FINAL_RESULT_PENDING',

    expectedRecoveryStatus:
      RECOVERY_STATUSES
        .FINAL_RESULT_PENDING,

    markInterrupted:
      false,

    finalized:
      false,
  },

  {
    deliveryStatus:
      FINAL_RESULT_DELIVERY_STATUSES
        .IN_FLIGHT,

    expectedAction:
      'FINAL_RESULT_UNCERTAIN',

    expectedRecoveryStatus:
      RECOVERY_STATUSES
        .FINAL_RESULT_UNCERTAIN,

    markInterrupted:
      true,

    finalized:
      false,
  },

  {
    deliveryStatus:
      FINAL_RESULT_DELIVERY_STATUSES
        .UNCERTAIN,

    expectedAction:
      'FINAL_RESULT_UNCERTAIN',

    expectedRecoveryStatus:
      RECOVERY_STATUSES
        .FINAL_RESULT_UNCERTAIN,

    markInterrupted:
      false,

    finalized:
      false,
  },

  {
    deliveryStatus:
      FINAL_RESULT_DELIVERY_STATUSES
        .DELIVERED,

    expectedAction:
      'FINAL_RESULT_TERMINALIZED',

    expectedRecoveryStatus:
      RECOVERY_STATUSES
        .FINAL_RESULT_DELIVERED,

    markInterrupted:
      false,

    finalized:
      true,
  },
];


for (
  const entry
  of finalResultMatrix
) {
  test(
    `restart matrix: final result ${entry.deliveryStatus} follows safe recovery semantics`,
    () => {
      const job =
        createJob({
          state:
            JOB_STATES.RUNNING,
        });

      const harness =
        createHarness({
          jobs: [
            job,
          ],

          finalResult: {
            jobId:
              job.id,

            terminalState:
              JOB_STATES.COMPLETED,

            deliveryStatus:
              entry.deliveryStatus,
          },
        });

      const result =
        harness.service
          .recoverJob(
            job,
          );

      assert.equal(
        result.action,
        entry.expectedAction,
      );

      assert.equal(
        result.recovery
          .recoveryStatus,
        entry
          .expectedRecoveryStatus,
      );

      assert.equal(
        harness.calls
          .markInterrupted.length,
        entry.markInterrupted
          ? 1
          : 0,
      );

      assert.equal(
        harness.calls
          .finalized.length,
        entry.finalized
          ? 1
          : 0,
      );

      assert.equal(
        harness.calls
          .incrementRetry.length,
        0,
      );

      assert.equal(
        harness.calls
          .transitionJob.length,
        0,
      );

      assert.equal(
        harness.calls
          .retryReserved.length,
        0,
      );

      assert.equal(
        harness.calls
          .releaseForJob.length,
        0,
      );
    },
  );
}


test(
  'restart matrix: durable final result takes precedence over manual challenge recovery',
  () => {
    const job =
      createJob({
        state:
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,

        currentStep:
          'verify_signin_otp',
      });

    const harness =
      createHarness({
        jobs: [
          job,
        ],

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
      result.recovery
        .recoveryStatus,
      RECOVERY_STATUSES
        .FINAL_RESULT_PENDING,
    );

    assert.equal(
      harness.calls
        .incrementRetry.length,
      0,
    );

    assert.equal(
      harness.calls
        .retryReserved.length,
      0,
    );
  },
);


for (
  const state
  of [
    JOB_STATES.COMPLETED,
    JOB_STATES.FAILED_FINAL,
  ]
) {
  test(
    `restart matrix: terminal ${state} is a strict no-op`,
    () => {
      const job =
        createJob({
          state,
        });

      const harness =
        createHarness({
          jobs: [
            job,
          ],
        });

      const result =
        harness.service
          .recoverJob(
            job,
          );

      assert.deepEqual(
        result,
        {
          action:
            'TERMINAL_NOOP',

          recovery:
            null,
        },
      );

      assert.equal(
        harness.calls
          .recovery.length,
        0,
      );

      assert.equal(
        harness.calls
          .incrementRetry.length,
        0,
      );

      assert.equal(
        harness.calls
          .transitionJob.length,
        0,
      );

      assert.equal(
        harness.calls
          .retryReserved.length,
        0,
      );

      assert.equal(
        harness.calls
          .releaseForJob.length,
        0,
      );
    },
  );
}


test(
  'restart matrix: recoverAll evaluates multiple crash states independently',
  () => {
    const running =
      createJob({
        id:
          'job-running',

        state:
          JOB_STATES.RUNNING,
      });

    const manual =
      createJob({
        id:
          'job-manual',

        state:
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,

        currentStep:
          'verify_signin_otp',
      });

    const waitingForIp =
      createJob({
        id:
          'job-pre',

        state:
          JOB_STATES.WAITING_FOR_IP,

        currentStep:
          null,
      });

    const harness =
      createHarness({
        jobs: [
          running,
          manual,
          waitingForIp,
        ],

        allocation:
          null,
      });

    const results =
      harness.service
        .recoverAll();

    assert.deepEqual(
      results.map(
        (result) => ({
          jobId:
            result.jobId,

          action:
            result.action,
        }),
      ),
      [
        {
          jobId:
            'job-running',

          action:
            'RETRY_SCHEDULED',
        },

        {
          jobId:
            'job-manual',

          action:
            'WAITING_MANUAL',
        },

        {
          jobId:
            'job-pre',

          action:
            'PRE_EXECUTION_RECOVERABLE',
        },
      ],
    );

    assert.equal(
      harness.calls
        .releaseForJob.length,
      0,
    );
  },
);
