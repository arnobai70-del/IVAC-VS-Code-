import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  migrateDatabase,
} from '../src/db/migrations.js';

import {
  JobStore,
} from '../src/jobs/job-store.js';

import {
  normalizeFinalResult,
} from '../src/results/final-result.js';

import {
  FinalResultConflictError,
  PortalResultDeliveryUncertainError,
} from '../src/results/final-result-errors.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
  FinalResultStore,
} from '../src/results/final-result-store.js';

function createFixture() {
  const database =
    new Database(
      ':memory:',
    );

  database.pragma(
    'foreign_keys = ON',
  );

  migrateDatabase(
    database,
  );

  const jobStore =
    new JobStore(
      database,
    );

  const job =
    jobStore
      .createOrGetJob({
        applicationId:
          'application-final-result-1',

        userId:
          'user-1',
      })
      .job;

  const store =
    new FinalResultStore(
      database,
    );

  return {
    database,
    job,
    store,
  };
}

function createResult(
  job,
  overrides = {},
) {
  return normalizeFinalResult({
    jobId:
      job.id,

    applicationId:
      job.applicationId,

    outcome:
      'SUCCESS',

    code:
      'APPOINTMENT_CONFIRMED',

    message:
      'Appointment completed successfully.',

    data: {
      reference:
        'safe-reference-1',
    },

    ...overrides,
  });
}

test(
  'same durable final result is reused without creating a duplicate',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      const result =
        createResult(
          job,
        );

      const first =
        store.createOrGet(
          result,
        );

      const second =
        store.createOrGet(
          result,
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

      assert.equal(
        second.record.payloadHash,
        result.payloadHash,
      );

      assert.equal(
        second.record.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      const count =
        database
          .prepare(`
            SELECT COUNT(*) AS count
            FROM final_results
            WHERE job_id = ?
          `)
          .get(
            job.id,
          )
          .count;

      assert.equal(
        count,
        1,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'different final result for the same job fails closed',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      const conflicting =
        createResult(
          job,
          {
            outcome:
              'FAILURE',

            code:
              'PAYMENT_FAILED',

            message:
              'Payment failed safely.',

            data: {},
          },
        );

      assert.throws(
        () =>
          store.createOrGet(
            conflicting,
          ),
        (error) => {
          assert.ok(
            error
            instanceof FinalResultConflictError,
          );

          return true;
        },
      );
    } finally {
      database.close();
    }
  },
);

test(
  'delivery begin is exclusive and increments attempts once',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      const first =
        store.beginDelivery(
          job.id,
        );

      assert.equal(
        first.started,
        true,
      );

      assert.equal(
        first.record.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .IN_FLIGHT,
      );

      assert.equal(
        first.record.deliveryAttempts,
        1,
      );

      assert.throws(
        () =>
          store.beginDelivery(
            job.id,
          ),
        (error) => {
          assert.ok(
            error
            instanceof FinalResultConflictError,
          );

          return true;
        },
      );

      const current =
        store.getByJobId(
          job.id,
        );

      assert.equal(
        current.deliveryAttempts,
        1,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'failed delivery can return safely to pending',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      store.beginDelivery(
        job.id,
      );

      const error =
        new Error(
          'temporary failure',
        );

      error.code =
        'TEMPORARY_PORTAL_FAILURE';

      error.retryable =
        true;

      const pending =
        store.markPendingAfterFailure(
          job.id,
          error,
          {
            deliveryCertainty:
              'REJECTED',
          },
        );

      assert.equal(
        pending.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .PENDING,
      );

      assert.equal(
        pending.lastErrorCode,
        'TEMPORARY_PORTAL_FAILURE',
      );

      assert.equal(
        pending.lastErrorRetryable,
        true,
      );

      assert.equal(
        pending.lastDeliveryCertainty,
        'REJECTED',
      );

      assert.equal(
        pending.deliveryAttempts,
        1,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'uncertain delivery is persisted and blocks blind replay',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      store.beginDelivery(
        job.id,
      );

      const error =
        new Error(
          'delivery certainty unknown',
        );

      error.code =
        'PORTAL_DELIVERY_UNCERTAIN';

      const uncertain =
        store.markUncertain(
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
        () =>
          store.beginDelivery(
            job.id,
          ),
        (thrown) => {
          assert.ok(
            thrown
            instanceof PortalResultDeliveryUncertainError,
          );

          return true;
        },
      );
    } finally {
      database.close();
    }
  },
);

test(
  'restart converts stale in-flight delivery to uncertain',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      store.beginDelivery(
        job.id,
      );

      const recovered =
        store
          .markInterruptedInFlightUncertain(
            job.id,
          );

      assert.equal(
        recovered.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .UNCERTAIN,
      );

      assert.equal(
        recovered.lastErrorCode,
        'PROCESS_RESTART_DURING_DELIVERY',
      );

      assert.equal(
        recovered.lastDeliveryCertainty,
        'UNCERTAIN',
      );

      assert.equal(
        recovered.lastErrorRetryable,
        false,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'marking stale in-flight uncertain is idempotent after recovery',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      store.beginDelivery(
        job.id,
      );

      const first =
        store
          .markInterruptedInFlightUncertain(
            job.id,
          );

      const second =
        store
          .markInterruptedInFlightUncertain(
            job.id,
          );

      assert.equal(
        first.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .UNCERTAIN,
      );

      assert.equal(
        second.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .UNCERTAIN,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'listByDeliveryStatus returns only matching durable results',
  () => {
    const {
      database,
      job,
      store,
    } =
      createFixture();

    try {
      store.createOrGet(
        createResult(
          job,
        ),
      );

      const pending =
        store.listByDeliveryStatus(
          FINAL_RESULT_DELIVERY_STATUSES
            .PENDING,
        );

      const delivered =
        store.listByDeliveryStatus(
          FINAL_RESULT_DELIVERY_STATUSES
            .DELIVERED,
        );

      assert.equal(
        pending.length,
        1,
      );

      assert.equal(
        pending[0].jobId,
        job.id,
      );

      assert.equal(
        delivered.length,
        0,
      );
    } finally {
      database.close();
    }
  },
);