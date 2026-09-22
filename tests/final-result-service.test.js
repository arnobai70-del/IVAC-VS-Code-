import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppError,
} from '../src/core/errors.js';

import {
  closeDatabase,
  openDatabase,
} from '../src/db/database.js';

import {
  migrateDatabase,
} from '../src/db/migrations.js';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  JobStore,
} from '../src/jobs/job-store.js';

import {
  IpAllocator,
} from '../src/network/ip-allocator.js';

import {
  ProxyPool,
} from '../src/network/proxy-pool.js';

import {
  ALLOCATION_STATES,
  RELEASE_REASONS,
} from '../src/network/proxy-state.js';

import {
  PORTAL_RESULT_DELIVERY_CERTAINTY,
  PortalResultClient,
} from '../src/portal/portal-result-client.js';

import {
  FINAL_RESULT_OUTCOMES,
  normalizeFinalResult,
} from '../src/results/final-result.js';

import {
  FINAL_RESULT_ERROR_CODES,
} from '../src/results/final-result-errors.js';

import {
  FinalResultService,
} from '../src/results/final-result-service.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
  FinalResultStore,
} from '../src/results/final-result-store.js';

function createFixture({
  contract = null,
} = {}) {
  const database =
    openDatabase({
      filePath:
        ':memory:',
    });

  migrateDatabase(
    database,
  );

  const jobs =
    new JobStore(
      database,
    );

  const proxyPool =
    new ProxyPool(
      database,
    );

  proxyPool.syncFromConfig([
    {
      id:
        'proxy-1',

      ip:
        '203.0.113.70',

      port:
        8080,

      protocol:
        'http',

      enabled:
        true,
    },
  ]);

  proxyPool.recordHealthSuccess(
    'proxy-1',
    {
      latencyMs:
        10,
    },
  );

  const allocator =
    new IpAllocator(
      database,
    );

  const results =
    new FinalResultStore(
      database,
    );

  const portalResultClient =
    new PortalResultClient({
      contract,
    });

  const service =
    new FinalResultService({
      jobStore:
        jobs,

      finalResultStore:
        results,

      portalResultClient,

      ipAllocator:
        allocator,
    });

  return {
    database,
    jobs,
    proxyPool,
    allocator,
    results,
    portalResultClient,
    service,
  };
}

function createRunningJob(
  fixture,
  applicationId,
) {
  const job =
    fixture.jobs
      .createOrGetJob({
        applicationId,
      })
      .job;

  fixture.allocator
    .acquireForJob({
      jobId:
        job.id,
    });

  fixture.allocator
    .activateForJob(
      job.id,
    );

  const claimed =
    fixture.jobs
      .transitionJob(
        job.id,
        JOB_STATES.CLAIMED,
      );

  const waitingForIp =
    fixture.jobs
      .transitionJob(
        claimed.id,
        JOB_STATES.WAITING_FOR_IP,
      );

  return fixture.jobs
    .transitionJob(
      waitingForIp.id,
      JOB_STATES.RUNNING,
    );
}

test(
  'successful final result is sent once then job becomes terminal and IP releases once',
  async () => {
    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          supportsIdempotentReplay:
            true,

          async send() {
            sendCount +=
              1;

            return {
              accepted:
                true,

              statusCode:
                200,
            };
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-success',
        );

      const first =
        await fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,

            code:
              'OK',

            message:
              'Completed',

            data: {
              reference:
                'ref-1',
            },
          });

      assert.equal(
        sendCount,
        1,
      );

      assert.equal(
        first.job.state,
        JOB_STATES.COMPLETED,
      );

      assert.equal(
        first.result
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .DELIVERED,
      );

      assert.equal(
        first.ipRelease
          .released,
        true,
      );

      assert.equal(
        first.ipRelease
          .allocation
          .releaseReason,
        RELEASE_REASONS
          .JOB_COMPLETED,
      );

      const second =
        await fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,

            code:
              'OK',

            message:
              'Completed',

            data: {
              reference:
                'ref-1',
            },
          });

      assert.equal(
        sendCount,
        1,
      );

      assert.equal(
        second.deliveryReused,
        true,
      );

      assert.equal(
        second.ipRelease
          .released,
        false,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'temporary rejected delivery keeps job non-terminal and retains the same live IP',
  async () => {
    let shouldFail =
      true;

    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          async send() {
            sendCount +=
              1;

            if (
              shouldFail
            ) {
              throw new AppError(
                'Portal temporarily rejected result.',
                {
                  code:
                    'PORTAL_TEMPORARY_REJECTION',

                  retryable:
                    true,

                  details: {
                    deliveryCertainty:
                      PORTAL_RESULT_DELIVERY_CERTAINTY
                        .REJECTED,
                  },
                },
              );
            }

            return {
              accepted:
                true,

              statusCode:
                200,
            };
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-retry',
        );

      const allocationBefore =
        fixture.allocator
          .getActiveForJob(
            job.id,
          );

      await assert.rejects(
        fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,

            data: {
              reference:
                'retry-ref',
            },
          }),

        (error) => (
          error.code
          === 'PORTAL_TEMPORARY_REJECTION'
        ),
      );

      const afterFailureJob =
        fixture.jobs
          .getJobById(
            job.id,
          );

      const afterFailureAllocation =
        fixture.allocator
          .getActiveForJob(
            job.id,
          );

      const pending =
        fixture.results
          .getByJobId(
            job.id,
          );

      assert.equal(
        afterFailureJob.state,
        JOB_STATES.RUNNING,
      );

      assert.equal(
        afterFailureAllocation
          .allocationId,
        allocationBefore
          .allocationId,
      );

      assert.equal(
        afterFailureAllocation
          .status,
        ALLOCATION_STATES
          .ACTIVE,
      );

      assert.equal(
        pending.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      assert.equal(
        pending.lastErrorRetryable,
        true,
      );

      assert.equal(
        pending.lastDeliveryCertainty,
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .REJECTED,
      );

      assert.equal(
        pending.lastErrorMessage,
        'Portal final-result delivery failed (PORTAL_TEMPORARY_REJECTION).',
      );

      shouldFail =
        false;

      const completed =
        await fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,

            data: {
              reference:
                'retry-ref',
            },
          });

      assert.equal(
        sendCount,
        2,
      );

      assert.equal(
        completed.job.state,
        JOB_STATES.COMPLETED,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'uncertain non-idempotent delivery blocks duplicate replay and keeps IP',
  async () => {
    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          supportsIdempotentReplay:
            false,

          async send() {
            sendCount +=
              1;

            throw new AppError(
              'Connection closed after request transmission.',
              {
                code:
                  'PORTAL_RESULT_NETWORK_UNCERTAIN',

                retryable:
                  true,

                details: {
                  deliveryCertainty:
                    PORTAL_RESULT_DELIVERY_CERTAINTY
                      .UNCERTAIN,
                },
              },
            );
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-uncertain',
        );

      await assert.rejects(
        fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,
          }),

        (error) => (
          error.code
          === 'PORTAL_RESULT_NETWORK_UNCERTAIN'
        ),
      );

      assert.equal(
        fixture.results
          .getByJobId(
            job.id,
          )
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .UNCERTAIN,
      );

      await assert.rejects(
        fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,
          }),

        (error) => (
          error.code
          === FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_DELIVERY_UNCERTAIN
        ),
      );

      assert.equal(
        sendCount,
        1,
      );

      assert.equal(
        fixture.jobs
          .getJobById(
            job.id,
          )
          .state,
        JOB_STATES.RUNNING,
      );

      assert.ok(
        fixture.allocator
          .getActiveForJob(
            job.id,
          ),
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'unconfigured Portal contract captures result durably without terminal transition or IP release',
  async () => {
    const fixture =
      createFixture();

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-unconfigured',
        );

      await assert.rejects(
        fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,

            data: {
              reference:
                'captured',
            },
          }),

        (error) => (
          error.code
          === FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_NOT_CONFIGURED
        ),
      );

      const record =
        fixture.results
          .getByJobId(
            job.id,
          );

      assert.equal(
        record.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      assert.equal(
        record.deliveryAttempts,
        0,
      );

      assert.equal(
        fixture.jobs
          .getJobById(
            job.id,
          )
          .state,
        JOB_STATES.RUNNING,
      );

      assert.ok(
        fixture.allocator
          .getActiveForJob(
            job.id,
          ),
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'delivered durable result can finish terminal transition after interruption without resending',
  async () => {
    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          async send() {
            sendCount +=
              1;

            throw new Error(
              'send must not run for an already delivered result',
            );
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-resume-terminal',
        );

      const normalized =
        normalizeFinalResult({
          jobId:
            job.id,

          applicationId:
            job.applicationId,

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            reference:
              'already-delivered',
          },
        });

      fixture.results
        .createOrGet(
          normalized,
        );

      fixture.results
        .beginDelivery(
          job.id,
        );

      fixture.results
        .markDelivered(
          job.id,
          {
            httpStatus:
              200,
          },
        );

      const completed =
        await fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .SUCCESS,

            data: {
              reference:
                'already-delivered',
            },
          });

      assert.equal(
        sendCount,
        0,
      );

      assert.equal(
        completed.job.state,
        JOB_STATES.COMPLETED,
      );

      assert.equal(
        completed.ipRelease
          .released,
        true,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'resumeDelivery sends an existing pending durable result without reconstructing the final payload',
  async () => {
    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          async send() {
            sendCount +=
              1;

            return {
              accepted:
                true,

              statusCode:
                200,
            };
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-resume-pending',
        );

      const normalized =
        normalizeFinalResult({
          jobId:
            job.id,

          applicationId:
            job.applicationId,

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            reference:
              'durable-pending-ref',
          },
        });

      fixture.results
        .createOrGet(
          normalized,
        );

      const durableBefore =
        fixture.results
          .getByJobId(
            job.id,
          );

      assert.equal(
        durableBefore.data.reference,
        'durable-pending-ref',
      );

      const completed =
        await fixture.service
          .resumeDelivery(
            job.id,
          );

      assert.equal(
        sendCount,
        1,
      );

      assert.equal(
        completed.resultCreated,
        false,
      );

      assert.equal(
        completed.deliveryReused,
        false,
      );

      assert.equal(
        completed.job.state,
        JOB_STATES.COMPLETED,
      );

      assert.equal(
        completed.result
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .DELIVERED,
      );

      assert.equal(
        completed.result
          .data
          .reference,
        'durable-pending-ref',
      );

      assert.equal(
        completed.ipRelease
          .released,
        true,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'resumeDelivery blocks uncertain replay when verified remote idempotency is unavailable',
  async () => {
    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          supportsIdempotentReplay:
            false,

          async send() {
            sendCount +=
              1;

            throw new Error(
              'send must not run for blocked uncertain replay',
            );
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-resume-uncertain-blocked',
        );

      const normalized =
        normalizeFinalResult({
          jobId:
            job.id,

          applicationId:
            job.applicationId,

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,
        });

      fixture.results
        .createOrGet(
          normalized,
        );

      fixture.results
        .beginDelivery(
          job.id,
        );

      fixture.results
        .markUncertain(
          job.id,
          new AppError(
            'Delivery outcome unknown.',
            {
              code:
                'PORTAL_RESULT_NETWORK_UNCERTAIN',

              retryable:
                true,
            },
          ),
        );

      await assert.rejects(
        fixture.service
          .resumeDelivery(
            job.id,
          ),

        (error) => (
          error.code
          === FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_DELIVERY_UNCERTAIN
        ),
      );

      assert.equal(
        sendCount,
        0,
      );

      assert.equal(
        fixture.results
          .getByJobId(
            job.id,
          )
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .UNCERTAIN,
      );

      assert.equal(
        fixture.jobs
          .getJobById(
            job.id,
          )
          .state,
        JOB_STATES.RUNNING,
      );

      assert.ok(
        fixture.allocator
          .getActiveForJob(
            job.id,
          ),
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'resumeDelivery replays uncertain result only when verified remote idempotency is declared',
  async () => {
    let sendCount =
      0;

    const fixture =
      createFixture({
        contract: {
          supportsIdempotentReplay:
            true,

          async send() {
            sendCount +=
              1;

            return {
              accepted:
                true,

              statusCode:
                200,
            };
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-resume-uncertain-safe',
        );

      const normalized =
        normalizeFinalResult({
          jobId:
            job.id,

          applicationId:
            job.applicationId,

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            reference:
              'uncertain-safe-ref',
          },
        });

      fixture.results
        .createOrGet(
          normalized,
        );

      fixture.results
        .beginDelivery(
          job.id,
        );

      fixture.results
        .markUncertain(
          job.id,
          new AppError(
            'Delivery outcome unknown.',
            {
              code:
                'PORTAL_RESULT_NETWORK_UNCERTAIN',

              retryable:
                true,
            },
          ),
        );

      const completed =
        await fixture.service
          .resumeDelivery(
            job.id,
          );

      assert.equal(
        sendCount,
        1,
      );

      assert.equal(
        completed.job.state,
        JOB_STATES.COMPLETED,
      );

      assert.equal(
        completed.result
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .DELIVERED,
      );

      assert.equal(
        completed.ipRelease
          .released,
        true,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'failure result becomes FAILED_FINAL only after Portal acknowledgement',
  async () => {
    const fixture =
      createFixture({
        contract: {
          async send() {
            return {
              accepted:
                true,

              statusCode:
                200,
            };
          },
        },
      });

    try {
      const job =
        createRunningJob(
          fixture,
          'app-result-failed-final',
        );

      const completed =
        await fixture.service
          .finalize({
            jobId:
              job.id,

            outcome:
              FINAL_RESULT_OUTCOMES
                .FAILURE,

            code:
              'TARGET_REJECTED',

            message:
              'Target rejected the application.',
          });

      assert.equal(
        completed.job.state,
        JOB_STATES.FAILED_FINAL,
      );

      assert.equal(
        completed.job.failureCode,
        'TARGET_REJECTED',
      );

      assert.equal(
        completed.ipRelease
          .allocation
          .releaseReason,
        RELEASE_REASONS
          .FAILED_FINAL,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);