import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  ExecutionWorker,
} from '../src/runtime/execution-worker.js';

function createHarness() {
  let job = {
    id:
      'job-1',

    applicationId:
      'application-1',

    userId:
      'user-1',

    state:
      JOB_STATES.WAITING_FOR_IP,

    retryCount:
      0,

    version:
      1,
  };

  const allocation = {
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
  };

  const session = {
    sessionId:
      'session-1',

    jobId:
      'job-1',

    allocationId:
      'allocation-1',

    proxyId:
      'proxy-1',

    assignedIp:
      '203.0.113.10',

    port:
      8080,

    dispatcher: {},

    cookieJar: {},
  };

  const transitions = [];

  let activateCalls =
    0;

  let createSessionCalls =
    0;

  let workflowCalls =
    0;

  const jobStore = {
    getJobById(
      jobId,
    ) {
      assert.equal(
        jobId,
        'job-1',
      );

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
        'job-1',
      );

      assert.equal(
        options.expectedVersion,
        job.version,
      );

      transitions.push({
        from:
          job.state,

        to:
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
          ?? job.currentStep
          ?? null,

        failureCode:
          options.failureCode
          ?? job.failureCode
          ?? null,

        failureMessage:
          options.failureMessage
          ?? job.failureMessage
          ?? null,

        version:
          job.version + 1,
      };

      return {
        ...job,
      };
    },
  };

  const ipAllocator = {
    getActiveForJob(
      jobId,
    ) {
      assert.equal(
        jobId,
        'job-1',
      );

      return {
        ...allocation,
      };
    },

    activateForJob(
      jobId,
    ) {
      assert.equal(
        jobId,
        'job-1',
      );

      activateCalls +=
        1;

      return {
        ...allocation,
      };
    },
  };

  const sessionManager = {
    async createForJob({
      job:
        suppliedJob,

      allocation:
        suppliedAllocation,
    }) {
      createSessionCalls +=
        1;

      assert.equal(
        suppliedJob.id,
        'job-1',
      );

      assert.equal(
        suppliedAllocation
          .allocationId,
        'allocation-1',
      );

      return session;
    },

    async closeForJob() {
      return true;
    },
  };

  const executeWorkflow =
    async ({
      jobContext,
    }) => {
      workflowCalls +=
        1;

      if (
        workflowCalls === 1
      ) {
        /*
         * Simulate first step already completed and the second
         * step encountering a human challenge.
         */
        jobContext.setResponse(
          'login',
          {
            statusCode:
              200,

            data: {
              token:
                'memory-only-token',
            },
          },
        );

        jobContext.setCurrentStep(
          'challenge_step',
        );

        const error =
          new Error(
            'challenge page details must not be persisted',
          );

        error.code =
          'MANUAL_CHALLENGE_REQUIRED';

        throw error;
      }

      /*
       * The same JobContext must survive the explicit resume.
       */
      assert.equal(
        jobContext.hasResponse(
          'login',
        ),
        true,
      );

      assert.equal(
        jobContext.currentStep,
        'challenge_step',
      );

      assert.equal(
        jobContext.session
          .sessionId,
        'session-1',
      );

      assert.equal(
        jobContext.allocation
          .allocationId,
        'allocation-1',
      );

      return {
        status:
          'COMPLETED',

        workflowName:
          'manual-resume-test',

        completedSteps:
          2,
      };
    };

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

    allocation,

    session,

    transitions,

    getJob:
      () => ({
        ...job,
      }),

    getActivateCalls:
      () =>
        activateCalls,

    getCreateSessionCalls:
      () =>
        createSessionCalls,

    getWorkflowCalls:
      () =>
        workflowCalls,
  };
}

test(
  'manual challenge stops normal execution and preserves in-memory context',
  async () => {
    const harness =
      createHarness();

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {
            phone:
              '01700000000',

            password:
              'memory-only-password',
          },
        }),
      (
        error,
      ) => (
        error.code
        === 'MANUAL_CHALLENGE_REQUIRED'
      ),
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );

    assert.equal(
      harness
        .getJob()
        .retryCount,
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
      context.currentStep,
      'challenge_step',
    );

    assert.equal(
      context.hasResponse(
        'login',
      ),
      true,
    );

    assert.equal(
      context.input
        .password,
      'memory-only-password',
    );

    assert.equal(
      harness
        .getActivateCalls(),
      1,
    );

    assert.equal(
      harness
        .getCreateSessionCalls(),
      1,
    );
  },
);

test(
  'normal run cannot auto-resume WAITING_FOR_MANUAL_CHALLENGE',
  async () => {
    const harness =
      createHarness();

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
        error.code
        === 'MANUAL_CHALLENGE_REQUIRED'
      ),
    );

    const workflowCallsBefore =
      harness
        .getWorkflowCalls();

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      /cannot begin execution from state WAITING_FOR_MANUAL_CHALLENGE/,
    );

    assert.equal(
      harness
        .getWorkflowCalls(),
      workflowCallsBefore,
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );
  },
);

test(
  'explicit manual resume keeps same IP, session, context, and retry count',
  async () => {
    const harness =
      createHarness();

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {
            phone:
              '01700000000',
          },
        }),
      (
        error,
      ) => (
        error.code
        === 'MANUAL_CHALLENGE_REQUIRED'
      ),
    );

    const contextBefore =
      harness.worker
        .getJobContext(
          'job-1',
        );

    const result =
      await harness.worker
        .resumeManualChallenge({
          jobId:
            'job-1',
        });

    const contextAfter =
      harness.worker
        .getJobContext(
          'job-1',
        );

    assert.equal(
      contextAfter,
      contextBefore,
    );

    assert.equal(
      result.status,
      'WORKFLOW_COMPLETED',
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
      harness
        .getJob()
        .retryCount,
      0,
    );

    /*
     * activateForJob() and createForJob() occurred only during the
     * original run. Explicit manual resume did neither.
     */
    assert.equal(
      harness
        .getActivateCalls(),
      1,
    );

    assert.equal(
      harness
        .getCreateSessionCalls(),
      1,
    );

    assert.equal(
      harness
        .getWorkflowCalls(),
      2,
    );

    assert.deepEqual(
      harness.transitions
        .map(
          (
            transition,
          ) => [
            transition.from,
            transition.to,
          ],
        ),
      [
        [
          JOB_STATES
            .WAITING_FOR_IP,

          JOB_STATES.RUNNING,
        ],

        [
          JOB_STATES.RUNNING,

          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,
        ],

        [
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,

          JOB_STATES.RUNNING,
        ],
      ],
    );
  },
);

test(
  'manual resume fails closed after restart when in-memory context is unavailable',
  async () => {
    const harness =
      createHarness();

    await assert.rejects(
      harness.worker
        .run({
          jobId:
            'job-1',

          input: {
            password:
              'memory-only-password',
          },
        }),
      (
        error,
      ) => (
        error.code
        === 'MANUAL_CHALLENGE_REQUIRED'
      ),
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );

    /*
     * Simulate a process restart: durable job/allocation remain,
     * but a fresh ExecutionWorker has no memory-only JobContext.
     */
    let createSessionCalls =
      0;

    let workflowCalls =
      0;

    const restartedWorker =
      new ExecutionWorker({
        jobStore:
          harness.jobStore,

        ipAllocator:
          harness.ipAllocator,

        sessionManager: {
          async createForJob() {
            createSessionCalls +=
              1;

            return harness.session;
          },

          async closeForJob() {
            return true;
          },
        },

        async executeWorkflow() {
          workflowCalls +=
            1;

          throw new Error(
            'must not execute',
          );
        },
      });

    await assert.rejects(
      restartedWorker
        .resumeManualChallenge({
          jobId:
            'job-1',
        }),
      /in-memory execution context is unavailable/,
    );

    assert.equal(
      createSessionCalls,
      0,
    );

    assert.equal(
      workflowCalls,
      0,
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES
        .WAITING_FOR_MANUAL_CHALLENGE,
    );

    assert.equal(
      harness
        .getJob()
        .retryCount,
      0,
    );
  },
);

test(
  'manual resume requires the durable job to still be waiting for manual challenge',
  async () => {
    const harness =
      createHarness();

    await assert.rejects(
      harness.worker
        .resumeManualChallenge({
          jobId:
            'job-1',
        }),
      /cannot resume a manual challenge from state WAITING_FOR_IP/,
    );

    assert.equal(
      harness
        .getWorkflowCalls(),
      0,
    );

    assert.equal(
      harness
        .getCreateSessionCalls(),
      0,
    );

    assert.equal(
      harness
        .getActivateCalls(),
      0,
    );
  },
);