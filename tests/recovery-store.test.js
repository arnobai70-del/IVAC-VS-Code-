import test from 'node:test';

import assert from 'node:assert/strict';

import Database from 'better-sqlite3';

import {
  migrateDatabase,
} from '../src/db/migrations.js';

import {
  JobStore,
} from '../src/jobs/job-store.js';

import {
  RECOVERY_STATUSES,
  RecoveryStore,
} from '../src/recovery/recovery-store.js';

function createDatabase() {
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

  return database;
}

function createJob(
  database,
) {
  const jobStore =
    new JobStore(
      database,
    );

  return jobStore
    .createOrGetJob({
      applicationId:
        'app-recovery-store-1',

      userId:
        'user-1',
    })
    .job;
}

test(
  'RecoveryStore persists non-sensitive restart metadata',
  () => {
    const database =
      createDatabase();

    try {
      const job =
        createJob(
          database,
        );

      const store =
        new RecoveryStore(
          database,
        );

      const record =
        store.recordRestart({
          jobId:
            job.id,

          bootId:
            'boot-1',

          recoveryStatus:
            RECOVERY_STATUSES
              .RETRY_SCHEDULED,

          sessionLost:
            true,

          lastObservedState:
            'RUNNING',

          lastObservedStep:
            'step-1',

          reasonCode:
            'temporary_network_failure',

          nextRetryAt:
            '2026-09-22T00:00:05.000Z',

          markRecovered:
            true,
        });

      assert.equal(
        record.jobId,
        job.id,
      );

      assert.equal(
        record.restartCount,
        1,
      );

      assert.equal(
        record.recoveryStatus,
        RECOVERY_STATUSES
          .RETRY_SCHEDULED,
      );

      assert.equal(
        record.sessionLost,
        true,
      );

      assert.equal(
        record.lastObservedState,
        'RUNNING',
      );

      assert.equal(
        record.lastObservedStep,
        'step-1',
      );

      assert.equal(
        record.lastReasonCode,
        'TEMPORARY_NETWORK_FAILURE',
      );

      assert.equal(
        record.nextRetryAt,
        '2026-09-22T00:00:05.000Z',
      );

      assert.equal(
        record.lastRecoveryBootId,
        'boot-1',
      );

      assert.ok(
        record.lastRecoveredAt,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'same boot does not increment restart count repeatedly',
  () => {
    const database =
      createDatabase();

    try {
      const job =
        createJob(
          database,
        );

      const store =
        new RecoveryStore(
          database,
        );

      const first =
        store.recordRestart({
          jobId:
            job.id,

          bootId:
            'boot-1',
        });

      const second =
        store.recordRestart({
          jobId:
            job.id,

          bootId:
            'boot-1',

          recoveryStatus:
            RECOVERY_STATUSES
              .BLOCKED_SESSION_LOSS,

          reasonCode:
            'session_state_not_recoverable',
        });

      assert.equal(
        first.restartCount,
        1,
      );

      assert.equal(
        second.restartCount,
        1,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'new boot increments restart count exactly once',
  () => {
    const database =
      createDatabase();

    try {
      const job =
        createJob(
          database,
        );

      const store =
        new RecoveryStore(
          database,
        );

      store.recordRestart({
        jobId:
          job.id,

        bootId:
          'boot-1',
      });

      const secondBoot =
        store.recordRestart({
          jobId:
            job.id,

          bootId:
            'boot-2',
      });

      const sameSecondBoot =
        store.recordRestart({
          jobId:
            job.id,

          bootId:
            'boot-2',
        });

      assert.equal(
        secondBoot.restartCount,
        2,
      );

      assert.equal(
        sameSecondBoot.restartCount,
        2,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'RecoveryStore rejects unknown recovery status',
  () => {
    const database =
      createDatabase();

    try {
      const job =
        createJob(
          database,
        );

      const store =
        new RecoveryStore(
          database,
        );

      assert.throws(
        () =>
          store.recordRestart({
            jobId:
              job.id,

            bootId:
              'boot-1',

            recoveryStatus:
              'INVALID_STATUS',
          }),
        {
          name:
            'TypeError',
        },
      );
    } finally {
      database.close();
    }
  },
);

test(
  'RecoveryStore rejects missing jobs',
  () => {
    const database =
      createDatabase();

    try {
      const store =
        new RecoveryStore(
          database,
        );

      assert.throws(
        () =>
          store.recordRestart({
            jobId:
              'missing-job',

            bootId:
              'boot-1',
          }),
        {
          name:
            'JobNotFoundError',
        },
      );
    } finally {
      database.close();
    }
  },
);

test(
  'RecoveryStore lists records by recovery status',
  () => {
    const database =
      createDatabase();

    try {
      const jobStore =
        new JobStore(
          database,
        );

      const firstJob =
        jobStore
          .createOrGetJob({
            applicationId:
              'app-recovery-list-1',
          })
          .job;

      const secondJob =
        jobStore
          .createOrGetJob({
            applicationId:
              'app-recovery-list-2',
          })
          .job;

      const store =
        new RecoveryStore(
          database,
        );

      store.recordRestart({
        jobId:
          firstJob.id,

        bootId:
          'boot-1',

        recoveryStatus:
          RECOVERY_STATUSES
            .RETRY_SCHEDULED,
      });

      store.recordRestart({
        jobId:
          secondJob.id,

        bootId:
          'boot-1',

        recoveryStatus:
          RECOVERY_STATUSES
            .WAITING_MANUAL,
      });

      const scheduled =
        store.listByStatus(
          RECOVERY_STATUSES
            .RETRY_SCHEDULED,
        );

      assert.equal(
        scheduled.length,
        1,
      );

      assert.equal(
        scheduled[0].jobId,
        firstJob.id,
      );
    } finally {
      database.close();
    }
  },
);

test(
  'RecoveryStore stores reason codes without raw sensitive error text',
  () => {
    const database =
      createDatabase();

    try {
      const job =
        createJob(
          database,
        );

      const store =
        new RecoveryStore(
          database,
        );

      const record =
        store.recordRestart({
          jobId:
            job.id,

          bootId:
            'boot-1',

          reasonCode:
            'Bearer secret-token password=abc',
        });

      assert.equal(
        record.lastReasonCode,
        'BEARER_SECRET-TOKEN_PASSWORD_ABC',
      );

      assert.equal(
        JSON.stringify(
          record,
        ).includes(
          'secret-token',
        ),
        false,
      );
    } finally {
      database.close();
    }
  },
);