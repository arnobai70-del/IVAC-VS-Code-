import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  RETRY_DECISIONS,
} from '../src/recovery/retry-policy.js';

import {
  ExecutionTerminalFailureError,
  RetryingExecutionRunner,
} from '../src/runtime/retrying-execution-runner.js';

function createJob({
  state =
    JOB_STATES.RUNNING,

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

    failureCode:
      null,

    failureMessage:
      null,

    version,
  };
}

function createHarness({
  initialJob =
    createJob(),

  executionImplementation,
  maxRetries = 3,
  sleepImplementation =
    async () => {},
} = {}) {
  let job = {
    ...initialJob,
  };

  const transitions = [];

  const retryCalls = [];

  const sleepCalls = [];

  const markRetryReservedCalls = [];

  const executionCalls = [];

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

    incrementRetry(
      jobId,
      {
        expectedVersion,
      } = {},
    ) {
      assert.equal(
        jobId,
        'job-1',
      );

      assert.equal(
        expectedVersion,
        job.version,
      );

      retryCalls.push({
        jobId,
        expectedVersion,
      });

      job = {
        ...job,

        retryCount:
          job.retryCount + 1,

        version:
          job.version + 1,
      };

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
    markRetryReserved(
      jobId,
    ) {
      assert.equal(
        jobId,
        'job-1',
      );

      markRetryReservedCalls
        .push(
          jobId,
        );

      return {
        allocationId:
          'allocation-1',

        jobId:
          'job-1',

        ip:
          '192.0.2.10',

        port:
          8080,

        status:
          'RETRY_RESERVED',
      };
    },
  };

  const executionWorker = {
    async run(args) {
      executionCalls.push(
        args,
      );

      return executionImplementation({
        args,

        callNumber:
          executionCalls.length,

        setJobState(
          state,
        ) {
          job = {
            ...job,

            state,

            version:
              job.version + 1,
          };
        },
      });
    },
  };

  const sleepFn =
    async (
      delayMs,
      signal,
    ) => {
      sleepCalls.push({
        delayMs,
        signal,
      });

      return sleepImplementation(
        delayMs,
        signal,
      );
    };

  const runner =
    new RetryingExecutionRunner({
      executionWorker,
      jobStore,
      ipAllocator,
      maxRetries,
      sleepFn,
    });

  return {
    runner,

    transitions,

    retryCalls,

    sleepCalls,

    markRetryReservedCalls,

    executionCalls,

    getJob:
      () => ({
        ...job,
      }),
  };
}

test(
  'explicitly retryable failure consumes one durable retry and retries same job input',
  async () => {
    const input = {
      phone:
        '01700000000',

      password:
        'memory-only-secret',
    };

    const harness =
      createHarness({
        executionImplementation:
          async ({
            callNumber,
            setJobState,
          }) => {
            if (
              callNumber === 1
            ) {
              const error =
                new Error(
                  'temporary network failure',
                );

              error.code =
                'NETWORK_TIMEOUT';

              error.retryable =
                true;

              throw error;
            }

            /*
             * ExecutionWorker itself performs:
             * RETRY_PENDING -> RUNNING.
             *
             * The mock reflects that verified behavior so the
             * durable state after the successful retry matches
             * production semantics.
             */
            setJobState(
              JOB_STATES.RUNNING,
            );

            return {
              status:
                'WORKFLOW_COMPLETED',

              jobId:
                'job-1',

              allocationId:
                'allocation-1',

              workflowResult: {
                status:
                  'COMPLETED',

                workflowName:
                  'test-workflow',

                completedSteps:
                  2,
              },
            };
          },
      });

    const result =
      await harness.runner
        .run({
          jobId:
            'job-1',

          input,
        });

    assert.equal(
      result.status,
      'WORKFLOW_COMPLETED',
    );

    assert.equal(
      harness.executionCalls
        .length,
      2,
    );

    assert.equal(
      harness.executionCalls[0]
        .input,
      input,
    );

    assert.equal(
      harness.executionCalls[1]
        .input,
      input,
    );

    assert.equal(
      harness.retryCalls.length,
      1,
    );

    assert.deepEqual(
      harness
        .markRetryReservedCalls,
      [
        'job-1',
      ],
    );

    assert.equal(
      harness.transitions
        .length,
      1,
    );

    assert.equal(
      harness.transitions[0]
        .toState,
      JOB_STATES.RETRY_PENDING,
    );

    assert.equal(
      harness.transitions[0]
        .options
        .failureCode,
      'NETWORK_TIMEOUT',
    );

    assert.equal(
      harness.transitions[0]
        .options
        .failureMessage,
      'Retryable workflow execution failure; bounded retry scheduled.',
    );

    assert.equal(
      harness.sleepCalls
        .length,
      1,
    );

    assert.equal(
      harness.sleepCalls[0]
        .delayMs,
      1000,
    );

    assert.equal(
      harness
        .getJob()
        .retryCount,
      1,
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES.RUNNING,
    );
  },
);

test(
  'bounded retry delays follow existing retry policy',
  async () => {
    const harness =
      createHarness({
        executionImplementation:
          async ({
            callNumber,
            setJobState,
          }) => {
            if (
              callNumber <= 3
            ) {
              const error =
                new Error(
                  'retryable',
                );

              error.code =
                'RATE_LIMITED';

              error.retryable =
                true;

              throw error;
            }

            setJobState(
              JOB_STATES.RUNNING,
            );

            return {
              status:
                'WORKFLOW_COMPLETED',

              workflowResult: {
                status:
                  'COMPLETED',

                workflowName:
                  'test-workflow',

                completedSteps:
                  1,
              },
            };
          },
      });

    /*
     * The mock ExecutionWorker must enter RUNNING before each
     * retryable failure, just like the real ExecutionWorker.
     */
    const originalRun =
      harness.runner
        .executionWorker
        .run
        .bind(
          harness.runner
            .executionWorker,
        );

    harness.runner
      .executionWorker
      .run =
      async (
        args,
      ) => {
        if (
          harness
            .getJob()
            .state
          === JOB_STATES
            .RETRY_PENDING
        ) {
          const current =
            harness.getJob();

          /*
           * Simulate verified ExecutionWorker transition to
           * RUNNING before executing the next attempt.
           */
          harness.runner
            .jobStore
            .transitionJob(
              'job-1',
              JOB_STATES.RUNNING,
              {
                expectedVersion:
                  current.version,
              },
            );
        }

        return originalRun(
          args,
        );
      };

    const result =
      await harness.runner
        .run({
          jobId:
            'job-1',

          input: {},
        });

    assert.equal(
      result.status,
      'WORKFLOW_COMPLETED',
    );

    assert.deepEqual(
      harness.sleepCalls
        .map(
          (
            entry,
          ) =>
            entry.delayMs,
        ),
      [
        1000,
        5000,
        15000,
      ],
    );

    assert.equal(
      harness.retryCalls.length,
      3,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      3,
    );

    assert.equal(
      harness
        .getJob()
        .retryCount,
      3,
    );
  },
);

test(
  'manual challenge is never retried and consumes no retry budget',
  async () => {
    const challengeError =
      new Error(
        'manual handling required',
      );

    challengeError.code =
      'MANUAL_CHALLENGE_REQUIRED';

    const harness =
      createHarness({
        initialJob:
          createJob({
            state:
              JOB_STATES
                .WAITING_FOR_MANUAL_CHALLENGE,
          }),

        executionImplementation:
          async () => {
            throw challengeError;
          },
      });

    await assert.rejects(
      harness.runner
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

    assert.equal(
      harness.retryCalls.length,
      0,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      0,
    );

    assert.equal(
      harness.sleepCalls.length,
      0,
    );
  },
);

test(
  'shutdown abort is never retried and consumes no retry budget',
  async () => {
    const abortError =
      new Error(
        'shutdown',
      );

    abortError.name =
      'AbortError';

    const harness =
      createHarness({
        executionImplementation:
          async () => {
            throw abortError;
          },
      });

    await assert.rejects(
      harness.runner
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      (
        error,
      ) => (
        error
        === abortError
      ),
    );

    assert.equal(
      harness.retryCalls.length,
      0,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      0,
    );

    assert.equal(
      harness.sleepCalls.length,
      0,
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
  'unknown non-retryable failure becomes explicit terminal-failure signal',
  async () => {
    const sourceError =
      new Error(
        'unexpected failure text must not be persisted',
      );

    sourceError.code =
      'UNEXPECTED_FAILURE';

    const harness =
      createHarness({
        executionImplementation:
          async () => {
            throw sourceError;
          },
      });

    await assert.rejects(
      harness.runner
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      (
        error,
      ) => {
        assert.ok(
          error
          instanceof
            ExecutionTerminalFailureError,
        );

        assert.equal(
          error.code,
          'EXECUTION_TERMINAL_FAILURE',
        );

        assert.equal(
          error.retryDecision,
          RETRY_DECISIONS
            .NON_RETRYABLE,
        );

        assert.equal(
          error.failureCode,
          'UNEXPECTED_FAILURE',
        );

        assert.equal(
          error.retryCount,
          0,
        );

        assert.equal(
          error.cause,
          sourceError,
        );

        assert.equal(
          error.message.includes(
            'unexpected failure text',
          ),
          false,
        );

        return true;
      },
    );

    assert.equal(
      harness.retryCalls.length,
      0,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      0,
    );

    assert.equal(
      harness.sleepCalls.length,
      0,
    );
  },
);

test(
  'retry exhaustion becomes explicit terminal-failure signal without another attempt',
  async () => {
    const retryableError =
      new Error(
        'still failing',
      );

    retryableError.code =
      'NETWORK_TIMEOUT';

    retryableError.retryable =
      true;

    const harness =
      createHarness({
        initialJob:
          createJob({
            retryCount:
              3,
          }),

        maxRetries:
          3,

        executionImplementation:
          async () => {
            throw retryableError;
          },
      });

    await assert.rejects(
      harness.runner
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      (
        error,
      ) => {
        assert.ok(
          error
          instanceof
            ExecutionTerminalFailureError,
        );

        assert.equal(
          error.retryDecision,
          RETRY_DECISIONS
            .EXHAUSTED,
        );

        assert.equal(
          error.failureCode,
          'NETWORK_TIMEOUT',
        );

        assert.equal(
          error.retryCount,
          3,
        );

        return true;
      },
    );

    assert.equal(
      harness.executionCalls
        .length,
      1,
    );

    assert.equal(
      harness.retryCalls.length,
      0,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      0,
    );

    assert.equal(
      harness.sleepCalls.length,
      0,
    );
  },
);

test(
  'abort during retry wait leaves durable RETRY_PENDING state and same-IP reservation',
  async () => {
    const controller =
      new AbortController();

    const retryableError =
      new Error(
        'temporary',
      );

    retryableError.code =
      'NETWORK_TIMEOUT';

    retryableError.retryable =
      true;

    const harness =
      createHarness({
        executionImplementation:
          async () => {
            throw retryableError;
          },

        sleepImplementation:
          async (
            delayMs,
            signal,
          ) => {
            assert.equal(
              delayMs,
              1000,
            );

            controller.abort();

            assert.equal(
              signal.aborted,
              true,
            );

            const error =
              new Error(
                'shutdown',
              );

            error.name =
              'AbortError';

            error.code =
              'SHUTDOWN_ABORT';

            throw error;
          },
      });

    await assert.rejects(
      harness.runner
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
        error.name
        === 'AbortError'
      ),
    );

    assert.equal(
      harness.retryCalls.length,
      1,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      1,
    );

    assert.equal(
      harness
        .getJob()
        .retryCount,
      1,
    );

    assert.equal(
      harness
        .getJob()
        .state,
      JOB_STATES.RETRY_PENDING,
    );
  },
);

test(
  'retryable failure in unexpected lifecycle state fails closed',
  async () => {
    const retryableError =
      new Error(
        'temporary',
      );

    retryableError.code =
      'NETWORK_TIMEOUT';

    retryableError.retryable =
      true;

    const harness =
      createHarness({
        initialJob:
          createJob({
            state:
              JOB_STATES
                .WAITING_FOR_IP,
          }),

        executionImplementation:
          async () => {
            throw retryableError;
          },
      });

    await assert.rejects(
      harness.runner
        .run({
          jobId:
            'job-1',

          input: {},
        }),
      /unexpected state WAITING_FOR_IP/,
    );

    assert.equal(
      harness.retryCalls.length,
      0,
    );

    assert.equal(
      harness
        .markRetryReservedCalls
        .length,
      0,
    );
  },
);

test(
  'constructor validates required dependencies and retry bounds',
  () => {
    const executionWorker = {
      run() {},
    };

    const jobStore = {
      getJobById() {},

      incrementRetry() {},

      transitionJob() {},
    };

    const ipAllocator = {
      markRetryReserved() {},
    };

    assert.throws(
      () => {
        new RetryingExecutionRunner({
          executionWorker:
            null,

          jobStore,

          ipAllocator,
        });
      },
      /executionWorker must be an object/,
    );

    assert.throws(
      () => {
        new RetryingExecutionRunner({
          executionWorker,

          jobStore:
            null,

          ipAllocator,
        });
      },
      /jobStore must be an object/,
    );

    assert.throws(
      () => {
        new RetryingExecutionRunner({
          executionWorker,

          jobStore,

          ipAllocator:
            null,
        });
      },
      /ipAllocator must be an object/,
    );

    assert.throws(
      () => {
        new RetryingExecutionRunner({
          executionWorker,

          jobStore,

          ipAllocator,

          maxRetries:
            -1,
        });
      },
      /maxRetries must be a non-negative integer/,
    );

    assert.throws(
      () => {
        new RetryingExecutionRunner({
          executionWorker,

          jobStore,

          ipAllocator,

          sleepFn:
            null,
        });
      },
      /sleepFn must be a function/,
    );
  },
);