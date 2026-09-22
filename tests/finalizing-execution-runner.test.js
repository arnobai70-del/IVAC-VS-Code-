import assert from 'node:assert/strict';
import test from 'node:test';

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

      /*
       * This extra field simulates potentially sensitive or
       * otherwise non-final-result workflow data. The runner must
       * not forward it.
       */
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
  'execution failure propagates without attempting finalization',
  async () => {
    const executionError =
      new Error(
        'temporary workflow failure',
      );

    executionError.code =
      'NETWORK_TIMEOUT';

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
  'final-result delivery failure propagates after workflow completion',
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