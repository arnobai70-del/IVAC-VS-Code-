import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FinalResultRecoveryRunner,
} from '../src/runtime/final-result-recovery-runner.js';

function createHarness({
  configured = true,
  supportsIdempotentReplay = false,
  resumeDelivery = async (
    jobId,
  ) => ({
    job: {
      id:
        jobId,

      state:
        'COMPLETED',
    },

    result: {
      deliveryStatus:
        'DELIVERED',
    },
  }),
} = {}) {
  const calls = {
    resumed:
      [],
  };

  const finalResultService = {
    async resumeDelivery(
      jobId,
    ) {
      calls.resumed.push(
        jobId,
      );

      return resumeDelivery(
        jobId,
      );
    },
  };

  const portalResultClient = {
    isConfigured() {
      return configured;
    },

    supportsIdempotentReplay() {
      return supportsIdempotentReplay;
    },
  };

  const runner =
    new FinalResultRecoveryRunner({
      finalResultService,
      portalResultClient,
    });

  return {
    runner,
    calls,
  };
}

test(
  'PENDING recovery is skipped when Portal result contract is unconfigured',
  async () => {
    const harness =
      createHarness({
        configured:
          false,
      });

    const result =
      await harness.runner
        .runOne({
          jobId:
            'job-1',

          action:
            'FINAL_RESULT_PENDING',
        });

    assert.equal(
      result.status,
      'SKIPPED',
    );

    assert.equal(
      result.reason,
      'PORTAL_RESULT_CONTRACT_NOT_CONFIGURED',
    );

    assert.deepEqual(
      harness.calls.resumed,
      [],
    );
  },
);

test(
  'PENDING recovery resumes an already-durable final result',
  async () => {
    const harness =
      createHarness();

    const result =
      await harness.runner
        .runOne({
          jobId:
            'job-1',

          action:
            'FINAL_RESULT_PENDING',
        });

    assert.equal(
      result.status,
      'DELIVERED',
    );

    assert.equal(
      result.terminalState,
      'COMPLETED',
    );

    assert.equal(
      result.deliveryStatus,
      'DELIVERED',
    );

    assert.deepEqual(
      harness.calls.resumed,
      [
        'job-1',
      ],
    );
  },
);

test(
  'UNCERTAIN recovery is skipped without verified remote idempotent replay',
  async () => {
    const harness =
      createHarness({
        supportsIdempotentReplay:
          false,
      });

    const result =
      await harness.runner
        .runOne({
          jobId:
            'job-1',

          action:
            'FINAL_RESULT_UNCERTAIN',
        });

    assert.equal(
      result.status,
      'SKIPPED',
    );

    assert.equal(
      result.reason,
      'REMOTE_IDEMPOTENT_REPLAY_UNVERIFIED',
    );

    assert.deepEqual(
      harness.calls.resumed,
      [],
    );
  },
);

test(
  'UNCERTAIN recovery may resume only when verified remote idempotent replay is declared',
  async () => {
    const harness =
      createHarness({
        supportsIdempotentReplay:
          true,
      });

    const result =
      await harness.runner
        .runOne({
          jobId:
            'job-1',

          action:
            'FINAL_RESULT_UNCERTAIN',
        });

    assert.equal(
      result.status,
      'DELIVERED',
    );

    assert.deepEqual(
      harness.calls.resumed,
      [
        'job-1',
      ],
    );
  },
);

test(
  'non-deliverable recovery actions never invoke final-result delivery',
  async () => {
    const harness =
      createHarness({
        supportsIdempotentReplay:
          true,
      });

    const result =
      await harness.runner
        .runOne({
          jobId:
            'job-1',

          action:
            'RETRY_SCHEDULED',
        });

    assert.equal(
      result.status,
      'SKIPPED',
    );

    assert.equal(
      result.reason,
      'RECOVERY_ACTION_NOT_DELIVERABLE',
    );

    assert.deepEqual(
      harness.calls.resumed,
      [],
    );
  },
);

test(
  'one failed recovery delivery does not stop later recovery results',
  async () => {
    const harness =
      createHarness({
        resumeDelivery:
          async (
            jobId,
          ) => {
            if (
              jobId
              === 'job-1'
            ) {
              const error =
                new Error(
                  'temporary failure',
                );

              error.code =
                'PORTAL_TEMPORARY_REJECTION';

              throw error;
            }

            return {
              job: {
                id:
                  jobId,

                state:
                  'COMPLETED',
              },

              result: {
                deliveryStatus:
                  'DELIVERED',
              },
            };
          },
      });

    const results =
      await harness.runner
        .run([
          {
            jobId:
              'job-1',

            action:
              'FINAL_RESULT_PENDING',
          },

          {
            jobId:
              'job-2',

            action:
              'FINAL_RESULT_PENDING',
          },
        ]);

    assert.equal(
      results.length,
      2,
    );

    assert.equal(
      results[0].status,
      'FAILED',
    );

    assert.equal(
      results[0].reason,
      'PORTAL_TEMPORARY_REJECTION',
    );

    assert.equal(
      results[1].status,
      'DELIVERED',
    );

    assert.deepEqual(
      harness.calls.resumed,
      [
        'job-1',
        'job-2',
      ],
    );
  },
);