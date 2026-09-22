import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionWorker,
} from '../src/runtime/execution-worker.js';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

function createJob({
  state =
    JOB_STATES.WAITING_FOR_IP,

  retryCount = 0,

  version = 1,
} = {}) {
  return {
    id:
      'job-1',

    applicationId:
      'application-1',

    userId:
      'user-1',

    state,

    currentStep:
      null,

    retryCount,

    startedAt:
      null,

    completedAt:
      null,

    lastActivityAt:
      null,

    failureCode:
      null,

    failureMessage:
      null,

    version,

    createdAt:
      '2026-01-01T00:00:00.000Z',

    updatedAt:
      '2026-01-01T00:00:00.000Z',
  };
}

function createAllocation({
  status = 'RESERVED',
} = {}) {
  return {
    allocationId:
      'allocation-1',

    jobId:
      'job-1',

    userId:
      'user-1',

    proxyId:
      'proxy-1',

    ip:
      '192.0.2.10',

    port:
      8080,

    status,

    allocatedAt:
      '2026-01-01T00:00:00.000Z',

    activatedAt:
      null,

    lastHeartbeat:
      '2026-01-01T00:00:00.000Z',

    releasedAt:
      null,

    releaseReason:
      null,

    failureCount:
      0,

    createdAt:
      '2026-01-01T00:00:00.000Z',

    updatedAt:
      '2026-01-01T00:00:00.000Z',
  };
}

function createHarness({
  initialJob =
    createJob(),

  workflowImplementation =
    async () => ({
      status:
        'COMPLETED',

      workflowName:
        'test-workflow',

      completedSteps:
        1,
    }),
} = {}) {
  let job = {
    ...initialJob,
  };

  const allocation =
    createAllocation();

  const transitionCalls = [];

  let activateCalls =
    0;

  let closeCalls =
    0;

  let releaseCalls =
    0;

  const jobStore = {
    getJobById(jobId) {
      if (
        jobId !== job.id
      ) {
        return null;
      }

      return {
        ...job,
      };
    },

    transitionJob(
      jobId,
      toState,
      options = {},
    ) {
      assert.equal(
        jobId,
        job.id,
      );

      if (
        options.expectedVersion
        !== undefined
      ) {
        assert.equal(
          options.expectedVersion,
          job.version,
        );
      }

      transitionCalls.push({
        fromState:
          job.state,

        toState,

        options: {
          ...options,
        },
      });

      job = {
        ...job,

        state:
          toState,

        currentStep:
          options.currentStep
          ?? job.currentStep,

        failureCode:
          options.failureCode
          ?? job.failureCode,

        failureMessage:
          options.failureMessage
          ?? job.failureMessage,

        version:
          job.version + 1,
      };

      return {
        ...job,
      };
    },
  };

  const ipAllocator = {
    getActiveForJob(jobId) {
      assert.equal(
        jobId,
        job.id,
      );

      return {
        ...allocation,
      };
    },

    activateForJob(jobId) {
      assert.equal(
        jobId,
        job.id,
      );

      activateCalls +=
        1;

      allocation.status =
        'ACTIVE';

      allocation.activatedAt =
        allocation.activatedAt
        ?? '2026-01-01T00:00:01.000Z';

      return {
        ...allocation,
      };
    },

    releaseForJob() {
      releaseCalls +=
        1;

      throw new Error(
        'ExecutionWorker must not release IP allocations.',
      );
    },
  };

  const dispatcher = {};

  const cookieJar = {
    clear() {},
  };

  const session = {
    sessionId:
      'session-1',

    jobId:
      job.id,

    allocationId:
      allocation.allocationId,

    proxyId:
      allocation.proxyId,

    assignedIp:
      allocation.ip,

    port:
      allocation.port,

    dispatcher,
    cookieJar,

    closed:
      false,
  };

  const sessionManager = {
    async createForJob({
      job: sessionJob,
      allocation:
        sessionAllocation,
    }) {
      assert.equal(
        sessionJob.id,
        job.id,
      );

      assert.equal(
        sessionAllocation
          .allocationId,
        allocation
          .allocationId,
      );

      assert.equal(
        sessionAllocation.ip,
        allocation.ip,
      );

      return session;
    },

    async closeForJob(jobId) {
      assert.equal(
        jobId,
        job.id,
      );

      closeCalls +=
        1;

      return true;
    },
  };

  const executeWorkflow =
    async ({
      jobContext,
      signal,
    }) => (
      workflowImplementation({
        jobContext,
        signal,
      })
    );

  const worker =
    new ExecutionWorker({
      jobStore,
      ipAllocator,
      sessionManager,
      executeWorkflow,
    });

  return {
    worker,

    jobStore,

    ipAllocator,

    sessionManager,

    transitionCalls,

    allocation,

    getJob:
      () => ({
        ...job,
      }),

    getActivateCalls:
      () => activateCalls,

    getCloseCalls:
      () => closeCalls,

    getReleaseCalls:
      () => releaseCalls,
  };
}

test(
  'successful workflow keeps job non-terminal for final-result handling',
  async () => {
    const harness =
      createHarness();

    const result =
      await harness.worker
        .run({
          jobId:
            'job-1',

          input: {
            phone:
              '01700000000',
          },
        });

    assert.equal(
      result.status,
      'WORKFLOW_COMPLETED',
    );

    assert.equal(
      result.jobId,
      'job-1',
    );

    assert.equal(
      result.allocationId,
      'allocation-1',
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES.RUNNING,
    );

    assert.equal(
      harness.transitionCalls
        .length,
      1,
    );

    assert.equal(
      harness.transitionCalls[0]
        .toState,
      JOB_STATES.RUNNING,
    );

    assert.equal(
      harness
        .getActivateCalls(),
      1,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );

    assert.equal(
      harness
        .getCloseCalls(),
      0,
    );

    const context =
      harness.worker
        .getJobContext(
          'job-1',
        );

    assert.ok(
      context,
    );

    assert.equal(
      context.allocation
        .allocationId,
      'allocation-1',
    );

    assert.equal(
      context.allocation.ip,
      '192.0.2.10',
    );

    assert.equal(
      context.result.status,
      'COMPLETED',
    );
  },
);

test(
  'manual challenge becomes WAITING_FOR_MANUAL_CHALLENGE without IP release',
  async () => {
    const challengeError =
      new Error(
        'challenge body must not be persisted',
      );

    challengeError.code =
      'MANUAL_CHALLENGE_REQUIRED';

    const harness =
      createHarness({
        workflowImplementation:
          async ({
            jobContext,
          }) => {
            jobContext
              .setCurrentStep(
                'challenge-step',
              );

            throw challengeError;
          },
      });

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      (
        error,
      ) => (
        error
        === challengeError
      ),
    );

    const job =
      harness.getJob();

    assert.equal(
      job.state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );

    assert.equal(
      job.currentStep,
      'challenge-step',
    );

    assert.equal(
      job.failureCode,
      'MANUAL_CHALLENGE_REQUIRED',
    );

    assert.equal(
      job.failureMessage,
      'Manual challenge handling is required.',
    );

    assert.equal(
      job.failureMessage.includes(
        'challenge body',
      ),
      false,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );

    assert.equal(
      harness
        .getCloseCalls(),
      0,
    );
  },
);

test(
  'generic workflow failure remains RUNNING and retains same IP',
  async () => {
    const workflowError =
      new Error(
        'temporary target failure',
      );

    workflowError.code =
      'TEMPORARY_TARGET_FAILURE';

    const harness =
      createHarness({
        workflowImplementation:
          async () => {
            throw workflowError;
          },
      });

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      (
        error,
      ) => (
        error
        === workflowError
      ),
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES.RUNNING,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );

    assert.equal(
      harness.worker
        .getJobContext(
          'job-1',
        )
        .allocation
        .allocationId,
      'allocation-1',
    );
  },
);

test(
  'shutdown abort remains non-terminal and does not release IP',
  async () => {
    const controller =
      new AbortController();

    const abortError =
      new Error(
        'shutdown',
      );

    abortError.name =
      'AbortError';

    const harness =
      createHarness({
        workflowImplementation:
          async ({
            signal,
          }) => {
            controller.abort();

            assert.equal(
              signal.aborted,
              true,
            );

            throw abortError;
          },
      });

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},

          signal:
            controller.signal,
        }),
      (
        error,
      ) => (
        error
        === abortError
      ),
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES.RUNNING,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );
  },
);

test(
  'retry execution reuses the same allocation and memory context',
  async () => {
    const harness =
      createHarness({
        initialJob:
          createJob({
            state:
              JOB_STATES
                .RETRY_PENDING,

            retryCount:
              1,
          }),
      });

    const result =
      await harness.worker
        .run({
          jobId:
            'job-1',

          input: {
            value:
              'retry-input',
          },
        });

    assert.equal(
      result.allocationId,
      'allocation-1',
    );

    const context =
      harness.worker
        .getJobContext(
          'job-1',
        );

    assert.equal(
      context.retryState.attempt,
      1,
    );

    assert.equal(
      context.allocation.ip,
      '192.0.2.10',
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );
  },
);

test(
  'execution fails closed when intake-bound allocation is missing',
  async () => {
    const harness =
      createHarness();

    harness.ipAllocator
      .getActiveForJob =
      () => null;

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      /no live intake-bound IP allocation/,
    );

    assert.equal(
      harness.transitionCalls
        .length,
      0,
    );

    assert.equal(
      harness
        .getActivateCalls(),
      0,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );
  },
);

test(
  'execution fails closed if activation changes the allocation identity',
  async () => {
    const harness =
      createHarness();

    harness.ipAllocator
      .activateForJob =
      () => ({
        ...createAllocation({
          status:
            'ACTIVE',
        }),

        allocationId:
          'different-allocation',
      });

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      /IP allocation changed/,
    );

    assert.equal(
      harness.transitionCalls
        .length,
      0,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );
  },
);

test(
  'worker rejects duplicate concurrent execution for one job',
  async () => {
    let resolveWorkflow;

    const workflowPromise =
      new Promise(
        (resolve) => {
          resolveWorkflow =
            resolve;
        },
      );

    const harness =
      createHarness({
        workflowImplementation:
          async () => {
            await workflowPromise;

            return {
              status:
                'COMPLETED',

              workflowName:
                'test-workflow',

              completedSteps:
                1,
            };
          },
      });

    const firstRun =
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        });

    await new Promise(
      (resolve) => {
        setImmediate(
          resolve,
        );
      },
    );

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      /already has an in-flight execution/,
    );

    resolveWorkflow();

    await firstRun;

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );
  },
);

test(
  'terminal memory cleanup closes session without releasing IP itself',
  async () => {
    const harness =
      createHarness({
        initialJob:
          createJob({
            state:
              JOB_STATES.WAITING_FOR_IP,
          }),
      });

    await harness.worker
      .run({
        jobId:
          'job-1',

        input: {},
      });

    harness.jobStore
      .transitionJob(
        'job-1',
        JOB_STATES.COMPLETED,
        {
          expectedVersion:
            harness
              .getJob()
              .version,
        },
      );

    const closed =
      await harness.worker
        .closeTerminalJob(
          'job-1',
        );

    assert.equal(
      closed,
      true,
    );

    assert.equal(
      harness
        .getCloseCalls(),
      1,
    );

    assert.equal(
      harness
        .getReleaseCalls(),
      0,
    );

    assert.equal(
      harness.worker
        .getJobContext(
          'job-1',
        ),
      null,
    );
  },
);

test(
  'constructor validates required dependencies',
  () => {
    const validJobStore = {
      getJobById() {},
      transitionJob() {},
    };

    const validIpAllocator = {
      getActiveForJob() {},
      activateForJob() {},
    };

    const validSessionManager = {
      createForJob() {},
      closeForJob() {},
    };

    assert.throws(
      () => {
        new ExecutionWorker({
          jobStore:
            null,

          ipAllocator:
            validIpAllocator,

          sessionManager:
            validSessionManager,

          executeWorkflow() {},
        });
      },
      /jobStore must be an object/,
    );

    assert.throws(
      () => {
        new ExecutionWorker({
          jobStore:
            validJobStore,

          ipAllocator:
            null,

          sessionManager:
            validSessionManager,

          executeWorkflow() {},
        });
      },
      /ipAllocator must be an object/,
    );

    assert.throws(
      () => {
        new ExecutionWorker({
          jobStore:
            validJobStore,

          ipAllocator:
            validIpAllocator,

          sessionManager:
            null,

          executeWorkflow() {},
        });
      },
      /sessionManager must be an object/,
    );

    assert.throws(
      () => {
        new ExecutionWorker({
          jobStore:
            validJobStore,

          ipAllocator:
            validIpAllocator,

          sessionManager:
            validSessionManager,

          executeWorkflow:
            null,
        });
      },
      /executeWorkflow must be a function/,
    );
  },
);