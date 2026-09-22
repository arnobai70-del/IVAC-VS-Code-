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
  supportsIdempotentReplay,
}) {
  const database =
    openDatabase({
      filePath:
        ':memory:',
    });

  migrateDatabase(
    database,
  );

  const jobStore =
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
        '203.0.113.80',

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

  const ipAllocator =
    new IpAllocator(
      database,
    );

  const finalResultStore =
    new FinalResultStore(
      database,
    );

  let sendCount =
    0;

  const portalResultClient =
    new PortalResultClient({
      contract: {
        supportsIdempotentReplay,

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

  const finalResultService =
    new FinalResultService({
      jobStore,
      finalResultStore,
      portalResultClient,
      ipAllocator,
    });

  return {
    database,
    jobStore,
    ipAllocator,
    finalResultStore,
    finalResultService,

    getSendCount() {
      return sendCount;
    },
  };
}

function createRunningJob(
  fixture,
) {
  const job =
    fixture.jobStore
      .createOrGetJob({
        applicationId:
          'app-recovery-1',
      })
      .job;

  fixture.ipAllocator
    .acquireForJob({
      jobId:
        job.id,
    });

  fixture.ipAllocator
    .activateForJob(
      job.id,
    );

  const claimed =
    fixture.jobStore
      .transitionJob(
        job.id,
        JOB_STATES.CLAIMED,
      );

  const waitingForIp =
    fixture.jobStore
      .transitionJob(
        claimed.id,
        JOB_STATES.WAITING_FOR_IP,
      );

  return fixture.jobStore
    .transitionJob(
      waitingForIp.id,
      JOB_STATES.RUNNING,
    );
}

function createUncertainPendingResult(
  fixture,
  job,
) {
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
          'durable-recovery-ref',
      },
    });

  fixture.finalResultStore
    .createOrGet(
      normalized,
    );

  fixture.finalResultStore
    .beginDelivery(
      job.id,
    );

  return fixture.finalResultStore
    .markPendingAfterFailure(
      job.id,
      new AppError(
        'Delivery outcome could not be verified.',
        {
          code:
            'PORTAL_RESULT_NETWORK_UNCERTAIN',

          retryable:
            true,
        },
      ),
      {
        deliveryCertainty:
          PORTAL_RESULT_DELIVERY_CERTAINTY
            .UNCERTAIN,
      },
    );
}

test(
  'restart resume blocks PENDING result with prior UNCERTAIN delivery when remote idempotency is unverified',
  async () => {
    const fixture =
      createFixture({
        supportsIdempotentReplay:
          false,
      });

    try {
      const job =
        createRunningJob(
          fixture,
        );

      const pending =
        createUncertainPendingResult(
          fixture,
          job,
        );

      assert.equal(
        pending.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      assert.equal(
        pending.lastDeliveryCertainty,
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN,
      );

      await assert.rejects(
        fixture.finalResultService
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
        fixture.getSendCount(),
        0,
      );

      assert.equal(
        fixture.finalResultStore
          .getByJobId(
            job.id,
          )
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      assert.equal(
        fixture.jobStore
          .getJobById(
            job.id,
          )
          .state,
        JOB_STATES.RUNNING,
      );

      assert.ok(
        fixture.ipAllocator
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
  'restart resume may replay PENDING result with prior UNCERTAIN delivery only when remote idempotency is verified',
  async () => {
    const fixture =
      createFixture({
        supportsIdempotentReplay:
          true,
      });

    try {
      const job =
        createRunningJob(
          fixture,
        );

      createUncertainPendingResult(
        fixture,
        job,
      );

      const completed =
        await fixture.finalResultService
          .resumeDelivery(
            job.id,
          );

      assert.equal(
        fixture.getSendCount(),
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
        completed.result
          .data
          .reference,
        'durable-recovery-ref',
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