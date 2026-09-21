import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
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

function createTestStore() {
  const database = openDatabase({
    filePath: ':memory:',
  });

  migrateDatabase(database);

  return {
    database,
    store: new JobStore(database),
  };
}

test('new application creates one durable job and claim', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const result = store.createOrGetJob({
      applicationId: 'app-1001',
      userId: 'user-1001',
    });

    assert.equal(result.created, true);
    assert.equal(
      result.job.applicationId,
      'app-1001',
    );
    assert.equal(
      result.job.state,
      JOB_STATES.PENDING,
    );

    const claim =
      store.getClaimByJobId(result.job.id);

    assert.equal(claim.status, 'ACTIVE');
    assert.equal(
      claim.applicationId,
      'app-1001',
    );
  } finally {
    closeDatabase(database);
  }
});

test('duplicate Portal application maps to one job', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const first = store.createOrGetJob({
      applicationId: 'app-duplicate',
      userId: 'user-a',
    });

    const second = store.createOrGetJob({
      applicationId: 'app-duplicate',
      userId: 'user-a',
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(
      second.job.id,
      first.job.id,
    );

    const count = database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM jobs
        WHERE application_id = ?
      `)
      .get('app-duplicate');

    assert.equal(count.count, 1);
  } finally {
    closeDatabase(database);
  }
});

test('job transitions persist and increment version', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const created = store.createOrGetJob({
      applicationId: 'app-transition',
    });

    const claimed = store.transitionJob(
      created.job.id,
      JOB_STATES.CLAIMED,
      {
        expectedVersion:
          created.job.version,
      },
    );

    assert.equal(
      claimed.state,
      JOB_STATES.CLAIMED,
    );

    assert.equal(
      claimed.version,
      created.job.version + 1,
    );

    const waiting = store.transitionJob(
      claimed.id,
      JOB_STATES.WAITING_FOR_IP,
      {
        expectedVersion:
          claimed.version,
      },
    );

    assert.equal(
      waiting.state,
      JOB_STATES.WAITING_FOR_IP,
    );
  } finally {
    closeDatabase(database);
  }
});

test('stale job version is rejected', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const created = store.createOrGetJob({
      applicationId: 'app-version',
    });

    const claimed = store.transitionJob(
      created.job.id,
      JOB_STATES.CLAIMED,
    );

    assert.throws(
      () => {
        store.transitionJob(
          claimed.id,
          JOB_STATES.WAITING_FOR_IP,
          {
            expectedVersion:
              created.job.version,
          },
        );
      },
      (error) => (
        error.code
        === ERROR_CODES.JOB_CONFLICT
      ),
    );
  } finally {
    closeDatabase(database);
  }
});

test('retry count is durable', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const created = store.createOrGetJob({
      applicationId: 'app-retry',
    });

    const updated = store.incrementRetry(
      created.job.id,
    );

    assert.equal(updated.retryCount, 1);

    const persisted =
      store.getJobById(created.job.id);

    assert.equal(
      persisted.retryCount,
      1,
    );
  } finally {
    closeDatabase(database);
  }
});

test('terminal job releases its logical claim', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const created = store.createOrGetJob({
      applicationId: 'app-complete',
    });

    const claimed = store.transitionJob(
      created.job.id,
      JOB_STATES.CLAIMED,
    );

    const waiting = store.transitionJob(
      claimed.id,
      JOB_STATES.WAITING_FOR_IP,
    );

    const running = store.transitionJob(
      waiting.id,
      JOB_STATES.RUNNING,
    );

    const completed = store.transitionJob(
      running.id,
      JOB_STATES.COMPLETED,
    );

    assert.equal(
      completed.state,
      JOB_STATES.COMPLETED,
    );

    assert.ok(completed.completedAt);

    const claim =
      store.getClaimByJobId(completed.id);

    assert.equal(claim.status, 'RELEASED');
    assert.ok(claim.releasedAt);
  } finally {
    closeDatabase(database);
  }
});

test('terminal jobs are excluded from restart recovery list', () => {
  const {
    database,
    store,
  } = createTestStore();

  try {
    const active = store.createOrGetJob({
      applicationId: 'app-active',
    });

    const done = store.createOrGetJob({
      applicationId: 'app-done',
    });

    const claimed = store.transitionJob(
      done.job.id,
      JOB_STATES.CLAIMED,
    );

    const waiting = store.transitionJob(
      claimed.id,
      JOB_STATES.WAITING_FOR_IP,
    );

    const running = store.transitionJob(
      waiting.id,
      JOB_STATES.RUNNING,
    );

    store.transitionJob(
      running.id,
      JOB_STATES.COMPLETED,
    );

    const incomplete =
      store.listIncompleteJobs();

    assert.deepEqual(
      incomplete.map((job) => job.id),
      [active.job.id],
    );
  } finally {
    closeDatabase(database);
  }
});