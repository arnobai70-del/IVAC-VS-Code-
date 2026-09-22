import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntakeExecutionHandler,
} from '../src/runtime/intake-execution-handler.js';

function createJob({
  jobId =
    'job-1',

  password =
    'secret-password',
} = {}) {
  const job = {
    jobId,

    applicationId:
      `application-${jobId}`,

    state:
      'WAITING_FOR_IP',

    allocationId:
      `allocation-${jobId}`,

    assignedIp:
      '192.0.2.10',

    port:
      8080,
  };

  Object.defineProperty(
    job,
    'executionInput',
    {
      value:
        Object.freeze({
          applicationId:
            `application-${jobId}`,

          userId:
            `user-${jobId}`,

          phone:
            '01700000000',

          password,

          passportNumber:
            'A1234567',

          documents:
            Object.freeze([]),
        }),

      enumerable:
        false,

      configurable:
        false,

      writable:
        false,
    },
  );

  return job;
}

function createCycleResult(
  jobs,
) {
  return {
    consumed:
      jobs.length,

    created:
      jobs.length,

    duplicates:
      0,

    effectiveCapacity:
      jobs.length,

    blocker:
      null,

    jobs,
  };
}

test(
  'fresh intake jobs are handed to execution worker with memory-only input',
  async () => {
    const calls = [];

    const executionWorker = {
      async run({
        jobId,
        input,
        signal,
      }) {
        calls.push({
          jobId,
          input,
          signal,
        });

        return {
          status:
            'WORKFLOW_COMPLETED',

          jobId,
        };
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const job =
      createJob();

    const summary =
      await handler
        .handleCycleResult(
          createCycleResult([
            job,
          ]),
        );

    assert.equal(
      calls.length,
      1,
    );

    assert.equal(
      calls[0].jobId,
      'job-1',
    );

    assert.equal(
      calls[0].input,
      job.executionInput,
    );

    assert.equal(
      calls[0].input.password,
      'secret-password',
    );

    assert.equal(
      calls[0].signal
        .aborted,
      false,
    );

    assert.deepEqual(
      summary,
      {
        admitted:
          1,

        workflowCompleted:
          1,

        failed:
          0,

        manualChallenges:
          0,

        aborted:
          0,

        skippedAfterStop:
          0,
      },
    );
  },
);

test(
  'multiple jobs from one intake cycle can execute without changing their handoffs',
  async () => {
    const seen =
      new Map();

    const executionWorker = {
      async run({
        jobId,
        input,
      }) {
        seen.set(
          jobId,
          input,
        );

        return {
          status:
            'WORKFLOW_COMPLETED',
        };
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const first =
      createJob({
        jobId:
          'job-1',

        password:
          'password-1',
      });

    const second =
      createJob({
        jobId:
          'job-2',

        password:
          'password-2',
      });

    const summary =
      await handler
        .handleCycleResult(
          createCycleResult([
            first,
            second,
          ]),
        );

    assert.equal(
      seen.size,
      2,
    );

    assert.equal(
      seen.get(
        'job-1',
      ),
      first.executionInput,
    );

    assert.equal(
      seen.get(
        'job-2',
      ),
      second.executionInput,
    );

    assert.equal(
      summary.admitted,
      2,
    );

    assert.equal(
      summary.workflowCompleted,
      2,
    );

    assert.equal(
      summary.failed,
      0,
    );
  },
);

test(
  'one workflow failure does not cancel sibling jobs from the same consumed cycle',
  async () => {
    const completed = [];

    const executionWorker = {
      async run({
        jobId,
      }) {
        if (
          jobId === 'job-1'
        ) {
          const error =
            new Error(
              'temporary failure',
            );

          error.code =
            'TEMPORARY_FAILURE';

          throw error;
        }

        completed.push(
          jobId,
        );

        return {
          status:
            'WORKFLOW_COMPLETED',
        };
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const summary =
      await handler
        .handleCycleResult(
          createCycleResult([
            createJob({
              jobId:
                'job-1',
            }),

            createJob({
              jobId:
                'job-2',
            }),
          ]),
        );

    assert.deepEqual(
      completed,
      [
        'job-2',
      ],
    );

    assert.equal(
      summary.admitted,
      2,
    );

    assert.equal(
      summary.workflowCompleted,
      1,
    );

    assert.equal(
      summary.failed,
      1,
    );

    assert.equal(
      summary.manualChallenges,
      0,
    );
  },
);

test(
  'manual challenge is counted separately and is not retried',
  async () => {
    let calls =
      0;

    const executionWorker = {
      async run() {
        calls +=
          1;

        const error =
          new Error(
            'manual handling required',
          );

        error.code =
          'MANUAL_CHALLENGE_REQUIRED';

        throw error;
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const summary =
      await handler
        .handleCycleResult(
          createCycleResult([
            createJob(),
          ]),
        );

    assert.equal(
      calls,
      1,
    );

    assert.equal(
      summary.workflowCompleted,
      0,
    );

    assert.equal(
      summary.failed,
      0,
    );

    assert.equal(
      summary.manualChallenges,
      1,
    );

    assert.equal(
      summary.aborted,
      0,
    );
  },
);

test(
  'stop aborts active workflow execution and waits for it to settle',
  async () => {
    let receivedSignal =
      null;

    let executionStarted;

    const started =
      new Promise(
        (resolve) => {
          executionStarted =
            resolve;
        },
      );

    const executionWorker = {
      async run({
        signal,
      }) {
        receivedSignal =
          signal;

        executionStarted();

        await new Promise(
          (
            resolve,
            reject,
          ) => {
            if (
              signal.aborted
            ) {
              const error =
                new Error(
                  'aborted',
                );

              error.name =
                'AbortError';

              reject(
                error,
              );

              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                const error =
                  new Error(
                    'aborted',
                  );

                error.name =
                  'AbortError';

                reject(
                  error,
                );
              },
              {
                once:
                  true,
              },
            );
          },
        );

        resolve();
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const handling =
      handler.handleCycleResult(
        createCycleResult([
          createJob(),
        ]),
      );

    await started;

    const stopping =
      handler.stop();

    const summary =
      await handling;

    const status =
      await stopping;

    assert.ok(
      receivedSignal,
    );

    assert.equal(
      receivedSignal.aborted,
      true,
    );

    assert.equal(
      summary.aborted,
      1,
    );

    assert.equal(
      summary.failed,
      0,
    );

    assert.equal(
      status.stopped,
      true,
    );

    assert.equal(
      status.activeExecutions,
      0,
    );
  },
);

test(
  'jobs are not admitted after handler has stopped',
  async () => {
    let calls =
      0;

    const executionWorker = {
      async run() {
        calls +=
          1;

        return {
          status:
            'WORKFLOW_COMPLETED',
        };
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    await handler.stop();

    const summary =
      await handler
        .handleCycleResult(
          createCycleResult([
            createJob({
              jobId:
                'job-1',
            }),

            createJob({
              jobId:
                'job-2',
            }),
          ]),
        );

    assert.equal(
      calls,
      0,
    );

    assert.equal(
      summary.admitted,
      0,
    );

    assert.equal(
      summary.skippedAfterStop,
      2,
    );
  },
);

test(
  'malformed execution handoff fails closed before any job starts',
  async () => {
    let calls =
      0;

    const executionWorker = {
      async run() {
        calls +=
          1;
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const validJob =
      createJob({
        jobId:
          'job-1',
      });

    const invalidJob = {
      jobId:
        'job-2',

      applicationId:
        'application-job-2',
    };

    await assert.rejects(
      handler
        .handleCycleResult(
          createCycleResult([
            validJob,
            invalidJob,
          ]),
        ),
      /intake job executionInput must be an object/,
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'overlapping direct cycle handling is rejected',
  async () => {
    let releaseFirst;

    const firstRun =
      new Promise(
        (resolve) => {
          releaseFirst =
            resolve;
        },
      );

    let firstStarted;

    const started =
      new Promise(
        (resolve) => {
          firstStarted =
            resolve;
        },
      );

    const executionWorker = {
      async run() {
        firstStarted();

        await firstRun;

        return {
          status:
            'WORKFLOW_COMPLETED',
        };
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
      });

    const firstCycle =
      handler.handleCycleResult(
        createCycleResult([
          createJob(),
        ]),
      );

    await started;

    await assert.rejects(
      handler
        .handleCycleResult(
          createCycleResult([]),
        ),
      /cannot handle overlapping cycle results/,
    );

    releaseFirst();

    await firstCycle;
  },
);

test(
  'logger receives only bounded summary data',
  async () => {
    const logCalls = [];

    const logger = {
      info(
        fields,
        message,
      ) {
        logCalls.push({
          fields,
          message,
        });
      },
    };

    const executionWorker = {
      async run() {
        return {
          status:
            'WORKFLOW_COMPLETED',
        };
      },
    };

    const handler =
      new IntakeExecutionHandler({
        executionWorker,
        logger,
      });

    await handler
      .handleCycleResult(
        createCycleResult([
          createJob({
            password:
              'must-not-be-logged',
          }),
        ]),
      );

    assert.equal(
      logCalls.length,
      1,
    );

    const serialized =
      JSON.stringify(
        logCalls,
      );

    assert.equal(
      serialized.includes(
        'must-not-be-logged',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        '01700000000',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'A1234567',
      ),
      false,
    );

    assert.match(
      serialized,
      /"workflowCompleted":1/,
    );
  },
);

test(
  'constructor validates execution worker',
  () => {
    assert.throws(
      () => {
        new IntakeExecutionHandler({
          executionWorker:
            null,
        });
      },
      /executionWorker must be an object/,
    );

    assert.throws(
      () => {
        new IntakeExecutionHandler({
          executionWorker: {},
        });
      },
      /executionWorker\.run must be a function/,
    );
  },
);