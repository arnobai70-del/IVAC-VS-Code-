import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  ManualChallengeOperations,
} from '../src/runtime/manual-challenge-operations.js';


function createJob({
  id = 'job-1',

  state =
    JOB_STATES
      .WAITING_FOR_MANUAL_CHALLENGE,

  currentStep =
    'verify_signin_otp',

  retryCount = 0,

  version = 4,
} = {}) {
  return {
    id,

    applicationId:
      'application-1',

    userId:
      'user-1',

    state,

    currentStep,

    retryCount,

    startedAt:
      '2026-01-01T00:00:00.000Z',

    completedAt:
      null,

    lastActivityAt:
      '2026-01-01T00:01:00.000Z',

    failureCode:
      state
      === JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE
        ? 'MANUAL_CHALLENGE_REQUIRED'
        : null,

    failureMessage:
      state
      === JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE
        ? 'Manual challenge handling is required.'
        : null,

    version,

    createdAt:
      '2026-01-01T00:00:00.000Z',

    updatedAt:
      '2026-01-01T00:01:00.000Z',

    /*
     * Unsafe/sensitive fixture fields are deliberate.
     * ManualChallengeOperations must never project them.
     */
    password:
      'must-not-be-returned',

    otp:
      '123456',

    cookie:
      'must-not-be-returned',
  };
}


function createAllocation({
  allocationId =
    'allocation-1',

  jobId =
    'job-1',

  status =
    'ACTIVE',
} = {}) {
  return {
    allocationId,

    jobId,

    userId:
      'user-1',

    proxyId:
      'proxy-1',

    ip:
      '203.0.113.10',

    port:
      8080,

    status,

    allocatedAt:
      '2026-01-01T00:00:00.000Z',

    activatedAt:
      '2026-01-01T00:00:30.000Z',

    lastHeartbeat:
      '2026-01-01T00:01:00.000Z',

    releasedAt:
      null,

    releaseReason:
      null,

    failureCount:
      0,

    username:
      'proxy-user',

    password:
      'proxy-password',
  };
}


function createHarness({
  job =
    createJob(),

  incompleteJobs =
    null,

  allocation =
    createAllocation(),

  resumeImplementation =
    async () => ({
      status:
        'WORKFLOW_COMPLETED',
    }),
} = {}) {
  let currentJob =
    job
      ? structuredClone(
          job,
        )
      : null;

  let currentAllocation =
    allocation
      ? structuredClone(
          allocation,
        )
      : null;

  let currentIncompleteJobs =
    incompleteJobs
      ? structuredClone(
          incompleteJobs,
        )
      : null;

  const resumeCalls =
    [];

  const jobStore = {
    getJobById(
      jobId,
    ) {
      if (
        !currentJob
        || currentJob.id
          !== jobId
      ) {
        return null;
      }

      return structuredClone(
        currentJob,
      );
    },

    listIncompleteJobs() {
      const jobs =
        currentIncompleteJobs
        ?? (
          currentJob
            ? [
                currentJob,
              ]
            : []
        );

      return structuredClone(
        jobs,
      );
    },
  };

  const ipAllocator = {
    getActiveForJob(
      jobId,
    ) {
      if (
        !currentAllocation
        || currentAllocation.jobId
          !== jobId
      ) {
        return (
          currentAllocation
          ? structuredClone(
              currentAllocation,
            )
          : null
        );
      }

      return structuredClone(
        currentAllocation,
      );
    },
  };

  const intakeExecutionHandler = {
    async resumeManualChallenge(
      args,
    ) {
      resumeCalls.push(
        structuredClone(
          args,
        ),
      );

      return resumeImplementation(
        args,
        {
          getJob() {
            return currentJob
              ? structuredClone(
                  currentJob,
                )
              : null;
          },

          setJob(
            nextJob,
          ) {
            currentJob =
              nextJob
                ? structuredClone(
                    nextJob,
                  )
                : null;
          },

          getAllocation() {
            return currentAllocation
              ? structuredClone(
                  currentAllocation,
                )
              : null;
          },

          setAllocation(
            nextAllocation,
          ) {
            currentAllocation =
              nextAllocation
                ? structuredClone(
                    nextAllocation,
                  )
                : null;
          },
        },
      );
    },
  };

  const operations =
    new ManualChallengeOperations({
      jobStore,
      ipAllocator,
      intakeExecutionHandler,
    });

  return {
    operations,

    getResumeCalls() {
      return structuredClone(
        resumeCalls,
      );
    },

    setJob(
      nextJob,
    ) {
      currentJob =
        nextJob
          ? structuredClone(
              nextJob,
            )
          : null;
    },

    setAllocation(
      nextAllocation,
    ) {
      currentAllocation =
        nextAllocation
          ? structuredClone(
              nextAllocation,
            )
          : null;
    },
  };
}


test(
  'manual challenge inspection exposes bounded operational state only',
  () => {
    const harness =
      createHarness();

    const result =
      harness.operations
        .get(
          'job-1',
        );

    assert.deepEqual(
      result,
      {
        jobId:
          'job-1',

        state:
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,

        currentStep:
          'verify_signin_otp',

        retryCount:
          0,

        version:
          4,

        manualChallengeRequired:
          true,

        liveAllocation: {
          allocationId:
            'allocation-1',

          status:
            'ACTIVE',
        },

        durableResumeEligible:
          true,
      },
    );

    assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result.liveAllocation,
      ),
      true,
    );

    const serialized =
      JSON.stringify(
        result,
      );

    assert.equal(
      serialized.includes(
        'must-not-be-returned',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        '123456',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'proxy-password',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        '203.0.113.10',
      ),
      false,
    );
  },
);


test(
  'unknown manual challenge job inspection returns null',
  () => {
    const harness =
      createHarness({
        job:
          null,

        allocation:
          null,
      });

    assert.equal(
      harness.operations
        .get(
          'missing-job',
        ),
      null,
    );
  },
);


test(
  'listWaiting returns only manual challenge jobs with bounded allocation metadata',
  () => {
    const waitingOne =
      createJob({
        id:
          'job-1',
      });

    const running =
      createJob({
        id:
          'job-2',

        state:
          JOB_STATES.RUNNING,

        currentStep:
          'sign_in',
      });

    const harness =
      createHarness({
        job:
          waitingOne,

        incompleteJobs: [
          waitingOne,
          running,
        ],

        allocation:
          createAllocation({
            jobId:
              'job-1',
          }),
      });

    const result =
      harness.operations
        .listWaiting();

    assert.equal(
      result.length,
      1,
    );

    assert.equal(
      result[0].jobId,
      'job-1',
    );

    assert.equal(
      result[0]
        .manualChallengeRequired,
      true,
    );

    assert.equal(
      result[0]
        .durableResumeEligible,
      true,
    );

    assert.equal(
      result[0]
        .liveAllocation
        .allocationId,
      'allocation-1',
    );

    assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result[0],
      ),
      true,
    );
  },
);


test(
  'explicit resume delegates exactly once and accepts no challenge solution or new input',
  async () => {
    let harness;

    harness =
      createHarness({
        resumeImplementation:
          async (
            args,
            controls,
          ) => {
            assert.deepEqual(
              args,
              {
                jobId:
                  'job-1',
              },
            );

            controls.setJob(
              createJob({
                state:
                  JOB_STATES.COMPLETED,

                currentStep:
                  null,

                version:
                  6,
              }),
            );

            controls.setAllocation(
              null,
            );

            return {
              status:
                'WORKFLOW_COMPLETED',

              executionResult: {
                status:
                  'FINALIZED',

                outcome:
                  'SUCCESS',
              },
            };
          },
      });

    const result =
      await harness.operations
        .resume({
          jobId:
            'job-1',
        });

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      1,
    );

    assert.deepEqual(
      harness
        .getResumeCalls()[0],
      {
        jobId:
          'job-1',
      },
    );

    assert.deepEqual(
      result,
      {
        jobId:
          'job-1',

        status:
          'WORKFLOW_COMPLETED',

        errorCode:
          null,

        state:
          JOB_STATES.COMPLETED,

        currentStep:
          null,

        liveAllocationPreserved:
          false,

        allocationId:
          null,
      },
    );

    const serialized =
      JSON.stringify(
        harness.getResumeCalls(),
      );

    assert.equal(
      serialized.includes(
        'password',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'otp',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'challenge',
      ),
      false,
    );
  },
);


test(
  'repeated manual challenge remains non-terminal and preserves the same allocation without auto-resume',
  async () => {
    let resumeInvocations =
      0;

    const harness =
      createHarness({
        resumeImplementation:
          async () => {
            resumeInvocations +=
              1;

            return {
              status:
                'MANUAL_CHALLENGE',

              errorName:
                'Error',

              errorCode:
                'MANUAL_CHALLENGE_REQUIRED',
            };
          },
      });

    const result =
      await harness.operations
        .resume({
          jobId:
            'job-1',
        });

    assert.equal(
      resumeInvocations,
      1,
    );

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      1,
    );

    assert.equal(
      result.status,
      'MANUAL_CHALLENGE',
    );

    assert.equal(
      result.errorCode,
      'MANUAL_CHALLENGE_REQUIRED',
    );

    assert.equal(
      result.state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );

    assert.equal(
      result.liveAllocationPreserved,
      true,
    );

    assert.equal(
      result.allocationId,
      'allocation-1',
    );
  },
);


test(
  'resume rejects a job that is not waiting for manual challenge handling',
  async () => {
    let calls =
      0;

    const harness =
      createHarness({
        job:
          createJob({
            state:
              JOB_STATES.RUNNING,
          }),

        resumeImplementation:
          async () => {
            calls +=
              1;

            return {
              status:
                'WORKFLOW_COMPLETED',
            };
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /is not waiting for manual challenge handling/,
    );

    assert.equal(
      calls,
      0,
    );

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      0,
    );
  },
);


test(
  'resume fails closed when the waiting job has no live allocation',
  async () => {
    let calls =
      0;

    const harness =
      createHarness({
        allocation:
          null,

        resumeImplementation:
          async () => {
            calls +=
              1;

            return {
              status:
                'WORKFLOW_COMPLETED',
            };
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /cannot resume manual challenge without its live IP allocation/,
    );

    assert.equal(
      calls,
      0,
    );
  },
);


test(
  'resume rejects a live allocation that belongs to another job',
  async () => {
    let calls =
      0;

    const harness =
      createHarness({
        allocation:
          createAllocation({
            jobId:
              'other-job',
          }),

        resumeImplementation:
          async () => {
            calls +=
              1;

            return {
              status:
                'WORKFLOW_COMPLETED',
            };
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /Live allocation belongs to another job/,
    );

    assert.equal(
      calls,
      0,
    );
  },
);


test(
  'non-terminal resume fails closed if allocation identity changes',
  async () => {
    let harness;

    harness =
      createHarness({
        resumeImplementation:
          async (
            args,
            controls,
          ) => {
            assert.equal(
              args.jobId,
              'job-1',
            );

            controls.setAllocation(
              createAllocation({
                allocationId:
                  'replacement-allocation',

                jobId:
                  'job-1',
              }),
            );

            return {
              status:
                'MANUAL_CHALLENGE',

              errorCode:
                'MANUAL_CHALLENGE_REQUIRED',
            };
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /Manual challenge resume changed the job allocation identity/,
    );

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      1,
    );
  },
);


test(
  'restart-context failure propagates without replacement allocation or automatic retry',
  async () => {
    let invocations =
      0;

    const harness =
      createHarness({
        resumeImplementation:
          async () => {
            invocations +=
              1;

            throw new Error(
              'Job job-1 cannot resume manual challenge because its in-memory execution context is unavailable.',
            );
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /in-memory execution context is unavailable/,
    );

    assert.equal(
      invocations,
      1,
    );

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      1,
    );

    const state =
      harness.operations
        .get(
          'job-1',
        );

    assert.equal(
      state.state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );

    assert.equal(
      state.liveAllocation
        .allocationId,
      'allocation-1',
    );

    assert.equal(
      state.durableResumeEligible,
      true,
    );
  },
);


test(
  'constructor validates manual challenge operation dependencies',
  () => {
    assert.throws(
      () => {
        new ManualChallengeOperations({
          jobStore:
            null,

          ipAllocator: {},

          intakeExecutionHandler: {},
        });
      },

      /jobStore must be an object/,
    );

    assert.throws(
      () => {
        new ManualChallengeOperations({
          jobStore: {},

          ipAllocator: {},

          intakeExecutionHandler: {},
        });
      },

      /jobStore\.getJobById must be a function/,
    );

    assert.throws(
      () => {
        new ManualChallengeOperations({
          jobStore: {
            getJobById() {},

            listIncompleteJobs() {
              return [];
            },
          },

          ipAllocator: {},

          intakeExecutionHandler: {},
        });
      },

      /ipAllocator\.getActiveForJob must be a function/,
    );

    assert.throws(
      () => {
        new ManualChallengeOperations({
          jobStore: {
            getJobById() {},

            listIncompleteJobs() {
              return [];
            },
          },

          ipAllocator: {
            getActiveForJob() {},
          },

          intakeExecutionHandler: {},
        });
      },

      /intakeExecutionHandler\.resumeManualChallenge must be a function/,
    );
  },
);
test(
  'non-terminal resume fails closed if live allocation disappears',
  async () => {
    const harness =
      createHarness({
        resumeImplementation:
          async (
            args,
            controls,
          ) => {
            assert.equal(
              args.jobId,
              'job-1',
            );

            controls.setAllocation(
              null,
            );

            return {
              status:
                'MANUAL_CHALLENGE',

              errorCode:
                'MANUAL_CHALLENGE_REQUIRED',
            };
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /lost the job live IP allocation before terminalization/,
    );

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      1,
    );
  },
);


test(
  'non-terminal resume fails closed if same allocation id changes IP binding',
  async () => {
    const harness =
      createHarness({
        resumeImplementation:
          async (
            args,
            controls,
          ) => {
            assert.equal(
              args.jobId,
              'job-1',
            );

            const current =
              controls.getAllocation();

            controls.setAllocation({
              ...current,

              ip:
                '203.0.113.99',
            });

            return {
              status:
                'MANUAL_CHALLENGE',

              errorCode:
                'MANUAL_CHALLENGE_REQUIRED',
            };
          },
      });

    await assert.rejects(
      harness.operations
        .resume({
          jobId:
            'job-1',
        }),

      /Manual challenge resume changed the job allocation identity/,
    );

    assert.equal(
      harness
        .getResumeCalls()
        .length,
      1,
    );
  },
);
