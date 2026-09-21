import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeDatabase,
  openDatabase,
} from '../src/db/database.js';

import {
  migrateDatabase,
} from '../src/db/migrations.js';

import {
  JobStore,
} from '../src/jobs/job-store.js';

import {
  FINAL_RESULT_OUTCOMES,
  normalizeFinalResult,
} from '../src/results/final-result.js';

import {
  FINAL_RESULT_ERROR_CODES,
} from '../src/results/final-result-errors.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
  FinalResultStore,
} from '../src/results/final-result-store.js';

function createFixture() {
  const database =
    openDatabase({
      filePath:
        ':memory:',
    });

  migrateDatabase(
    database,
  );

  return {
    database,

    jobs:
      new JobStore(
        database,
      ),

    results:
      new FinalResultStore(
        database,
      ),
  };
}

function makeResult(
  job,
  data = {},
) {
  return normalizeFinalResult({
    jobId:
      job.id,

    applicationId:
      job.applicationId,

    outcome:
      FINAL_RESULT_OUTCOMES
        .SUCCESS,

    data,
  });
}

test(
  'same durable final result is reused without creating a duplicate',
  () => {
    const fixture =
      createFixture();

    try {
      const job =
        fixture.jobs
          .createOrGetJob({
            applicationId:
              'app-final-store-1',
          })
          .job;

      const normalized =
        makeResult(
          job,
          {
            reference:
              'same',
          },
        );

      const first =
        fixture.results
          .createOrGet(
            normalized,
          );

      const second =
        fixture.results
          .createOrGet(
            normalized,
          );

      assert.equal(
        first.created,
        true,
      );

      assert.equal(
        second.created,
        false,
      );

      assert.equal(
        first.record.id,
        second.record.id,
      );

      const count =
        fixture.database
          .prepare(`
            SELECT
              COUNT(*) AS count
            FROM final_results
          `)
          .get();

      assert.equal(
        count.count,
        1,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'different final result for the same job fails closed',
  () => {
    const fixture =
      createFixture();

    try {
      const job =
        fixture.jobs
          .createOrGetJob({
            applicationId:
              'app-final-store-2',
          })
          .job;

      fixture.results
        .createOrGet(
          makeResult(
            job,
            {
              reference:
                'first',
            },
          ),
        );

      assert.throws(
        () => {
          fixture.results
            .createOrGet(
              makeResult(
                job,
                {
                  reference:
                    'different',
                },
              ),
            );
        },

        (error) => (
          error.code
          === FINAL_RESULT_ERROR_CODES
            .CONFLICT
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
  'delivery begin is exclusive and increments attempts once',
  () => {
    const fixture =
      createFixture();

    try {
      const job =
        fixture.jobs
          .createOrGetJob({
            applicationId:
              'app-final-store-3',
          })
          .job;

      fixture.results
        .createOrGet(
          makeResult(
            job,
          ),
        );

      const started =
        fixture.results
          .beginDelivery(
            job.id,
          );

      assert.equal(
        started.started,
        true,
      );

      assert.equal(
        started.record
          .deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .IN_FLIGHT,
      );

      assert.equal(
        started.record
          .deliveryAttempts,
        1,
      );

      assert.throws(
        () => {
          fixture.results
            .beginDelivery(
              job.id,
            );
        },

        (error) => (
          error.code
          === FINAL_RESULT_ERROR_CODES
            .CONFLICT
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
  'failed delivery can return safely to pending',
  () => {
    const fixture =
      createFixture();

    try {
      const job =
        fixture.jobs
          .createOrGetJob({
            applicationId:
              'app-final-store-4',
          })
          .job;

      fixture.results
        .createOrGet(
          makeResult(
            job,
          ),
        );

      fixture.results
        .beginDelivery(
          job.id,
        );

      const error =
        Object.assign(
          new Error(
            'temporary failure',
          ),
          {
            code:
              'PORTAL_TEMPORARY_REJECTION',

            retryable:
              true,
          },
        );

      const record =
        fixture.results
          .markPendingAfterFailure(
            job.id,
            error,
            {
              deliveryCertainty:
                'REJECTED',
            },
          );

      assert.equal(
        record.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      assert.equal(
        record.lastErrorCode,
        'PORTAL_TEMPORARY_REJECTION',
      );

      assert.equal(
        record.lastErrorRetryable,
        true,
      );

      assert.equal(
        record.lastDeliveryCertainty,
        'REJECTED',
      );

      assert.equal(
        record.lastErrorMessage,
        'Portal final-result delivery failed (PORTAL_TEMPORARY_REJECTION).',
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'uncertain delivery is persisted and blocks blind replay',
  () => {
    const fixture =
      createFixture();

    try {
      const job =
        fixture.jobs
          .createOrGetJob({
            applicationId:
              'app-final-store-5',
          })
          .job;

      fixture.results
        .createOrGet(
          makeResult(
            job,
          ),
        );

      fixture.results
        .beginDelivery(
          job.id,
        );

      const error =
        Object.assign(
          new Error(
            'network outcome uncertain',
          ),
          {
            code:
              'PORTAL_RESULT_NETWORK_UNCERTAIN',

            retryable:
              true,
          },
        );

      const uncertain =
        fixture.results
          .markUncertain(
            job.id,
            error,
          );

      assert.equal(
        uncertain.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .UNCERTAIN,
      );

      assert.equal(
        uncertain.lastDeliveryCertainty,
        'UNCERTAIN',
      );

      assert.throws(
        () => {
          fixture.results
            .beginDelivery(
              job.id,
            );
        },

        (thrown) => (
          thrown.code
          === FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_DELIVERY_UNCERTAIN
        ),
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);