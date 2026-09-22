import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RETRY_DECISIONS,
} from '../src/recovery/retry-policy.js';

import {
  ExecutionTerminalFailureError,
} from '../src/runtime/retrying-execution-runner.js';

import {
  FinalizingExecutionRunner,
} from '../src/runtime/finalizing-execution-runner.js';

function createSuccessfulExecutionResult() {
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
        'ivac-workflow',

      completedSteps:
        4,

      internalResponse: {
        password:
          'must-not-be-forwarded',
      },
    },
  };
}

test(
  'successful workflow is finalized with only whitelisted safe summary data',
  async () => {
    const workerCalls = [];

    const finalizeCalls = [];

    const executionWorker = {
      async run(args) {
        workerCalls.push(
          args,
        );

        return createSuccessfulExecutionResult();
      },
    };

    const finalResultService = {
      async finalize(args) {
        finalizeCalls.push(
          structuredClone(
            args,
          ),
        );

        return {
          job: {
            id:
              'job-1',

            state:
              'COMPLETED',
          },

          ipRelease: {
            released:
              true,
          },

          resultCreated:
            true,

          deliveryReused:
            false,
        };
      },
    };

    const runner =
      new FinalizingExecutionRunner({
        executionWorker,
        finalResultService,
      });

    const input = {
      phone:
        '01700000000',

      password:
        'super-secret-password',

      passportNumber:
        'A1234567',

      documents: [
        {
          url:
            'https://portal.example/document.pdf',
        },
      ],
    };

    const result =
      await runner.run({
        jobId:
          'job-1',

        input,
      });

    assert.equal(
      workerCalls.length,
      1,
    );

    assert.equal(
      workerCalls[0].jobId,
      'job-1',
    );

    assert.equal(
      workerCalls[0].input,
      input,
    );

    assert.equal(
      finalizeCalls.length,
      1,
    );

    assert.deepEqual(
      finalizeCalls[0],
      {
        jobId:
          'job-1',

        outcome:
          'SUCCESS',

        data: {
          workflowName:
            'ivac-workflow',

          completedSteps:
            4,
        },
      },
    );

    const serializedFinalizeCall =
      JSON.stringify(
        finalizeCalls[0],
      );

    assert.equal(
      serializedFinalizeCall.includes(
        'super-secret-password',
      ),
      false,
    );

    assert.equal(
      serializedFinalizeCall.includes(
        '01700000000',
      ),
      false,
    );

    assert.equal(
      serializedFinalizeCall.includes(
        'A1234567',
      ),
      false,
    );

    assert.equal(
      serializedFinalizeCall.includes(
        'document.pdf',
      ),
      false,
    );

    assert.equal(
      serializedFinalizeCall.includes(
        'must-not-be-forwarded',
      ),
      false,
    );

    assert.equal(
      result.status,
      'FINALIZED',
    );

    assert.equal(
      result.outcome,
      'SUCCESS',
    );

    assert.equal(
      result.jobId,
      'job-1',
    );

    assert.deepEqual(
      result.workflow,
      {
        workflowName:
          'ivac-workflow',

        completedSteps:
          4,
      },
    );

    assert.equal(
      result.finalization
        .job
        .state,
      'COMPLETED',
    );
  },
);

test(
  'non-retryable terminal execution failure is finalized as FAILURE with bounded metadata',
  async () => {
    const sourceError =
      new Error(
        'password=must-never-be-forwarded',
      );

    const terminalError =
      new ExecutionTerminalFailureError({
        retryDecision:
          RETRY_DECISIONS
            .NON_RETRYABLE,

        failureCode:
          'WORKFLOW_STEP_FAILED',

        retryCount:
          1,

        cause:
          sourceError,
      });

    const finalizeCalls = [];

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            throw terminalError;
          },
        },

        finalResultService: {
          async finalize(args) {
            finalizeCalls.push(
              structuredClone(
                args,
              ),
            );

            return {
              job: {
                id:
                  'job-1',

                state:
                  'FAILED_FINAL',
              },

              ipRelease: {
                released:
                  true,
              },
            };
          },
        },
      });

    const result =
      await runner.run({
        jobId:
          'job-1',

        input: {
          password:
            'another-secret',
        },
      });

    assert.equal(
      finalizeCalls.length,
      1,
    );

    assert.deepEqual(
      finalizeCalls[0],
      {
        jobId:
          'job-1',

        outcome:
          'FAILURE',

        code:
          'WORKFLOW_STEP_FAILED',

        message:
          'Workflow execution failed with a non-retryable error.',

        data: {
          retryDecision:
            'NON_RETRYABLE',

          retryCount:
            1,
        },
      },
    );

    const serialized =
      JSON.stringify(
        finalizeCalls[0],
      );

    assert.equal(
      serialized.includes(
        'must-never-be-forwarded',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'another-secret',
      ),
      false,
    );

    assert.equal(
      result.status,
      'FINALIZED',
    );

    assert.equal(
      result.outcome,
      'FAILURE',
    );

    assert.equal(
      result.failure.code,
      'WORKFLOW_STEP_FAILED',
    );

    assert.equal(
      result.failure.retryDecision,
      'NON_RETRYABLE',
    );

    assert.equal(
      result.failure.retryCount,
      1,
    );

    assert.equal(
      result.finalization
        .job
        .state,
      'FAILED_FINAL',
    );
  },
);

test(
  'retry exhaustion is finalized as FAILURE without another workflow attempt',
  async () => {
    const terminalError =
      new ExecutionTerminalFailureError({
        retryDecision:
          RETRY_DECISIONS
            .EXHAUSTED,

        failureCode:
          'NETWORK_TIMEOUT',

        retryCount:
          3,

        cause:
          new Error(
            'upstream timeout detail',
          ),
      });

    let executionCalls =
      0;

    const finalizeCalls = [];

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            executionCalls +=
              1;

            throw terminalError;
          },
        },

        finalResultService: {
          async finalize(args) {
            finalizeCalls.push(
              structuredClone(
                args,
              ),
            );

            return {
              job: {
                id:
                  'job-1',

                state:
                  'FAILED_FINAL',
              },
            };
          },
        },
      });

    const result =
      await runner.run({
        jobId:
          'job-1',

        input: {},
      });

    assert.equal(
      executionCalls,
      1,
    );

    assert.equal(
      finalizeCalls.length,
      1,
    );

    assert.deepEqual(
      finalizeCalls[0],
      {
        jobId:
          'job-1',

        outcome:
          'FAILURE',

        code:
          'NETWORK_TIMEOUT',

        message:
          'Workflow execution retry limit was exhausted.',

        data: {
          retryDecision:
            'EXHAUSTED',

          retryCount:
            3,
        },
      },
    );

    assert.equal(
      result.outcome,
      'FAILURE',
    );

    assert.equal(
      result.failure.retryCount,
      3,
    );
  },
);

test(
  'manual challenge propagates without failure finalization',
  async () => {
    const challengeError =
      new Error(
        'manual handling required',
      );

    challengeError.code =
      'MANUAL_CHALLENGE_REQUIRED';

    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            throw challengeError;
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;
          },
        },
      });

    await assert.rejects(
      runner.run({
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
      finalizeCalls,
      0,
    );
  },
);

test(
  'shutdown abort propagates without failure finalization',
  async () => {
    const abortError =
      new Error(
        'shutdown',
      );

    abortError.name =
      'AbortError';

    abortError.code =
      'SHUTDOWN_ABORT';

    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            throw abortError;
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;
          },
        },
      });

    await assert.rejects(
      runner.run({
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
      finalizeCalls,
      0,
    );
  },
);

test(
  'generic unclassified execution failure propagates without guessed terminalization',
  async () => {
    const executionError =
      new Error(
        'integration failure',
      );

    executionError.code =
      'INTEGRATION_FAILURE';

    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            throw executionError;
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;
          },
        },
      });

    await assert.rejects(
      runner.run({
        jobId:
          'job-1',

        input: {},
      }),
      (
        error,
      ) => (
        error
        === executionError
      ),
    );

    assert.equal(
      finalizeCalls,
      0,
    );
  },
);

test(
  'final-result delivery failure propagates after successful workflow completion',
  async () => {
    const finalizationError =
      new Error(
        'Portal result contract unavailable',
      );

    finalizationError.code =
      'PORTAL_RESULT_NOT_CONFIGURED';

    let executionCalls =
      0;

    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            executionCalls +=
              1;

            return createSuccessfulExecutionResult();
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;

            throw finalizationError;
          },
        },
      });

    await assert.rejects(
      runner.run({
        jobId:
          'job-1',

        input: {},
      }),
      (
        error,
      ) => (
        error
        === finalizationError
      ),
    );

    assert.equal(
      executionCalls,
      1,
    );

    assert.equal(
      finalizeCalls,
      1,
    );
  },
);

test(
  'final-result delivery failure propagates after terminal execution failure',
  async () => {
    const terminalError =
      new ExecutionTerminalFailureError({
        retryDecision:
          RETRY_DECISIONS
            .NON_RETRYABLE,

        failureCode:
          'WORKFLOW_STEP_FAILED',

        retryCount:
          0,

        cause:
          new Error(
            'source error',
          ),
      });

    const deliveryError =
      new Error(
        'delivery uncertain',
      );

    deliveryError.code =
      'PORTAL_RESULT_DELIVERY_UNCERTAIN';

    let executionCalls =
      0;

    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            executionCalls +=
              1;

            throw terminalError;
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;

            throw deliveryError;
          },
        },
      });

    await assert.rejects(
      runner.run({
        jobId:
          'job-1',

        input: {},
      }),
      (
        error,
      ) => (
        error
        === deliveryError
      ),
    );

    assert.equal(
      executionCalls,
      1,
    );

    assert.equal(
      finalizeCalls,
      1,
    );
  },
);

test(
  'non-completed execution result is rejected before finalization',
  async () => {
    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            return {
              status:
                'RUNNING',
            };
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;
          },
        },
      });

    await assert.rejects(
      runner.run({
        jobId:
          'job-1',

        input: {},
      }),
      /Execution result is not ready for success finalization/,
    );

    assert.equal(
      finalizeCalls,
      0,
    );
  },
);

test(
  'non-completed workflow result is rejected before finalization',
  async () => {
    let finalizeCalls =
      0;

    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            return {
              status:
                'WORKFLOW_COMPLETED',

              workflowResult: {
                status:
                  'FAILED',

                workflowName:
                  'ivac-workflow',

                completedSteps:
                  2,
              },
            };
          },
        },

        finalResultService: {
          async finalize() {
            finalizeCalls +=
              1;
          },
        },
      });

    await assert.rejects(
      runner.run({
        jobId:
          'job-1',

        input: {},
      }),
      /Workflow result is not completed/,
    );

    assert.equal(
      finalizeCalls,
      0,
    );
  },
);

test(
  'workflow summary requires valid safe fields',
  async () => {
    const runner =
      new FinalizingExecutionRunner({
        executionWorker: {
          async run() {
            return {
              status:
                'WORKFLOW_COMPLETED',

              workflowResult: {
                status:
                  'COMPLETED',

                workflowName:
                  '',

                completedSteps:
                  -1,
              },
            };
          },
        },

        finalResultService: {
          async finalize() {
            throw new Error(
              'finalize should not be called',
            );
          },
        },
      });

    await assert.rejects(
      runner.run({
        jobId:
          'job-1',

        input: {},
      }),
      /workflowResult\.workflowName must be a non-empty string/,
    );
  },
);

test(
  'constructor validates dependencies',
  () => {
    assert.throws(
      () => {
        new FinalizingExecutionRunner({
          executionWorker:
            null,

          finalResultService: {
            finalize() {},
          },
        });
      },
      /executionWorker must be an object/,
    );

    assert.throws(
      () => {
        new FinalizingExecutionRunner({
          executionWorker: {},

          finalResultService: {
            finalize() {},
          },
        });
      },
      /executionWorker\.run must be a function/,
    );

    assert.throws(
      () => {
        new FinalizingExecutionRunner({
          executionWorker: {
            run() {},
          },

          finalResultService:
            null,
        });
      },
      /finalResultService must be an object/,
    );

    assert.throws(
      () => {
        new FinalizingExecutionRunner({
          executionWorker: {
            run() {},
          },

          finalResultService: {},
        });
      },
      /finalResultService\.finalize must be a function/,
    );
  },
);