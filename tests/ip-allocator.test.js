import assert from 'node:assert/strict';

import {
  mkdtempSync,
  rmSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

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
  JobStore,
} from '../src/jobs/job-store.js';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  IpAllocator,
} from '../src/network/ip-allocator.js';

import {
  ProxyPool,
} from '../src/network/proxy-pool.js';

import {
  ALLOCATION_STATES,
  PROXY_STATES,
  RELEASE_REASONS,
} from '../src/network/proxy-state.js';

function createProxy(
  id,
  ip,
) {
  return {
    id,
    ip,
    port: 8080,
    protocol: 'http',
    enabled: true,
  };
}

function createFixture(
  proxies,
) {
  const database =
    openDatabase({
      filePath: ':memory:',
    });

  migrateDatabase(database);

  const jobs =
    new JobStore(database);

  const proxyPool =
    new ProxyPool(database);

  proxyPool.syncFromConfig(
    proxies,
  );

  for (const proxy of proxies) {
    proxyPool.recordHealthSuccess(
      proxy.id,
      {
        latencyMs: 10,
      },
    );
  }

  const allocator =
    new IpAllocator(database);

  return {
    database,
    jobs,
    proxyPool,
    allocator,
  };
}

function moveJobToRunning(
  jobs,
  jobId,
) {
  const claimed =
    jobs.transitionJob(
      jobId,
      JOB_STATES.CLAIMED,
    );

  const waiting =
    jobs.transitionJob(
      claimed.id,
      JOB_STATES.WAITING_FOR_IP,
    );

  return jobs.transitionJob(
    waiting.id,
    JOB_STATES.RUNNING,
  );
}

test('TEST A: two jobs with one IP allows only one allocation', () => {
  const fixture =
    createFixture([
      createProxy(
        'proxy-1',
        '203.0.113.31',
      ),
    ]);

  try {
    const firstJob =
      fixture.jobs
        .createOrGetJob({
          applicationId: 'app-a1',
        })
        .job;

    const secondJob =
      fixture.jobs
        .createOrGetJob({
          applicationId: 'app-a2',
        })
        .job;

    const first =
      fixture.allocator
        .acquireForJob({
          jobId: firstJob.id,
        });

    assert.equal(
      first.allocation.proxyId,
      'proxy-1',
    );

    assert.throws(
      () => {
        fixture.allocator
          .acquireForJob({
            jobId: secondJob.id,
          });
      },

      (error) => (
        error.code
        === ERROR_CODES.PROXY_UNAVAILABLE
      ),
    );

    assert.equal(
      fixture.allocator
        .listLiveAllocations()
        .length,
      1,
    );
  } finally {
    closeDatabase(
      fixture.database,
    );
  }
});

test('TEST B: two jobs with two IPs receive different proxies', () => {
  const fixture =
    createFixture([
      createProxy(
        'proxy-1',
        '203.0.113.41',
      ),

      createProxy(
        'proxy-2',
        '203.0.113.42',
      ),
    ]);

  try {
    const firstJob =
      fixture.jobs
        .createOrGetJob({
          applicationId: 'app-b1',
        })
        .job;

    const secondJob =
      fixture.jobs
        .createOrGetJob({
          applicationId: 'app-b2',
        })
        .job;

    const first =
      fixture.allocator
        .acquireForJob({
          jobId: firstJob.id,
        });

    const second =
      fixture.allocator
        .acquireForJob({
          jobId: secondJob.id,
        });

    assert.notEqual(
      first.allocation.proxyId,
      second.allocation.proxyId,
    );

    assert.notEqual(
      first.allocation.ip,
      second.allocation.ip,
    );
  } finally {
    closeDatabase(
      fixture.database,
    );
  }
});

test('TEST C and D: retry keeps the same IP locked to the same job', () => {
  const fixture =
    createFixture([
      createProxy(
        'proxy-1',
        '203.0.113.51',
      ),
    ]);

  try {
    const job =
      fixture.jobs
        .createOrGetJob({
          applicationId: 'app-retry-ip',
        })
        .job;

    const initial =
      fixture.allocator
        .acquireForJob({
          jobId: job.id,
        });

    fixture.allocator
      .activateForJob(job.id);

    const retry =
      fixture.allocator
        .markRetryReserved(
          job.id,
        );

    assert.equal(
      retry.status,
      ALLOCATION_STATES.RETRY_RESERVED,
    );

    assert.equal(
      retry.allocationId,
      initial.allocation.allocationId,
    );

    assert.equal(
      retry.ip,
      initial.allocation.ip,
    );

    const acquiredAgain =
      fixture.allocator
        .acquireForJob({
          jobId: job.id,
        });

    assert.equal(
      acquiredAgain.reused,
      true,
    );

    assert.equal(
      acquiredAgain.allocation.allocationId,
      initial.allocation.allocationId,
    );

    assert.equal(
      acquiredAgain.allocation.ip,
      initial.allocation.ip,
    );
  } finally {
    closeDatabase(
      fixture.database,
    );
  }
});

test('TEST E: completion releases an IP exactly once', () => {
  const fixture =
    createFixture([
      createProxy(
        'proxy-1',
        '203.0.113.61',
      ),
    ]);

  try {
    const job =
      fixture.jobs
        .createOrGetJob({
          applicationId: 'app-complete-ip',
        })
        .job;

    fixture.allocator
      .acquireForJob({
        jobId: job.id,
      });

    fixture.allocator
      .activateForJob(job.id);

    const running =
      moveJobToRunning(
        fixture.jobs,
        job.id,
      );

    fixture.jobs.transitionJob(
      running.id,
      JOB_STATES.COMPLETED,
    );

    const firstRelease =
      fixture.allocator
        .releaseForJob(
          job.id,
          {
            reason:
              RELEASE_REASONS.JOB_COMPLETED,
          },
        );

    const secondRelease =
      fixture.allocator
        .releaseForJob(
          job.id,
          {
            reason:
              RELEASE_REASONS.JOB_COMPLETED,
          },
        );

    assert.equal(
      firstRelease.released,
      true,
    );

    assert.equal(
      secondRelease.released,
      false,
    );

    assert.equal(
      firstRelease.allocation.status,
      ALLOCATION_STATES.RELEASED,
    );

    const proxy =
      fixture.proxyPool
        .getProxyById('proxy-1');

    assert.equal(
      proxy.status,
      PROXY_STATES.AVAILABLE,
    );
  } finally {
    closeDatabase(
      fixture.database,
    );
  }
});

test('TEST F: competing allocator instances cannot acquire the same IP', () => {
  const temporaryDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-allocation-test-',
      ),
    );

  const databasePath =
    join(
      temporaryDirectory,
      'allocation.sqlite3',
    );

  const firstDatabase =
    openDatabase({
      filePath: databasePath,
    });

  const secondDatabase =
    openDatabase({
      filePath: databasePath,
    });

  try {
    migrateDatabase(firstDatabase);
    migrateDatabase(secondDatabase);

    const jobs =
      new JobStore(firstDatabase);

    const proxyPool =
      new ProxyPool(firstDatabase);

    proxyPool.syncFromConfig([
      createProxy(
        'proxy-shared',
        '203.0.113.71',
      ),
    ]);

    proxyPool.recordHealthSuccess(
      'proxy-shared',
      {
        latencyMs: 10,
      },
    );

    const firstJob =
      jobs.createOrGetJob({
        applicationId:
          'app-concurrent-1',
      }).job;

    const secondJob =
      jobs.createOrGetJob({
        applicationId:
          'app-concurrent-2',
      }).job;

    const firstAllocator =
      new IpAllocator(
        firstDatabase,
      );

    const secondAllocator =
      new IpAllocator(
        secondDatabase,
      );

    firstAllocator.acquireForJob({
      jobId: firstJob.id,
    });

    assert.throws(
      () => {
        secondAllocator
          .acquireForJob({
            jobId:
              secondJob.id,
          });
      },

      (error) => (
        error.code
        === ERROR_CODES.PROXY_UNAVAILABLE
      ),
    );

    const live =
      firstAllocator
        .listLiveAllocations();

    assert.equal(
      live.length,
      1,
    );

    assert.equal(
      live[0].proxyId,
      'proxy-shared',
    );
  } finally {
    closeDatabase(
      secondDatabase,
    );

    closeDatabase(
      firstDatabase,
    );

    rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});