import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  SessionManager,
} from '../src/session/session-manager.js';

function createAllocation(
  jobId,
  suffix,
  proxyId = `proxy-${suffix}`,
) {
  return {
    allocationId:
      `allocation-${suffix}`,

    jobId,

    proxyId,

    ip:
      `203.0.113.${suffix}`,

    port: 8080,
  };
}

function createDispatcherPool() {
  const dispatchers =
    new Map();

  return {
    async getForAllocation(
      allocation,
    ) {
      if (
        !dispatchers.has(
          allocation.allocationId,
        )
      ) {
        dispatchers.set(
          allocation.allocationId,
          {
            allocationId:
              allocation.allocationId,

            proxyId:
              allocation.proxyId,
          },
        );
      }

      return dispatchers.get(
        allocation.allocationId,
      );
    },

    async closeForAllocation(
      allocationId,
    ) {
      return dispatchers.delete(
        allocationId,
      );
    },

    get size() {
      return dispatchers.size;
    },
  };
}

test('TEST H: different jobs receive isolated sessions, CookieJars, and dispatchers', async () => {
  const dispatcherPool =
    createDispatcherPool();

  const manager =
    new SessionManager({
      dispatcherPool,
    });

  const sessionA =
    await manager
      .createForJob({
        job: {
          id: 'job-a',
        },

        allocation:
          createAllocation(
            'job-a',
            '161',
          ),
      });

  const sessionB =
    await manager
      .createForJob({
        job: {
          id: 'job-b',
        },

        allocation:
          createAllocation(
            'job-b',
            '162',
          ),
      });

  assert.notEqual(
    sessionA,
    sessionB,
  );

  assert.notEqual(
    sessionA.cookieJar,
    sessionB.cookieJar,
  );

  assert.notEqual(
    sessionA.dispatcher,
    sessionB.dispatcher,
  );

  sessionA.cookieJar.setCookie(
    'session=A; Path=/',
    'https://example.test/',
  );

  assert.equal(
    sessionA.cookieJar
      .getCookieHeader(
        'https://example.test/',
      ),
    'session=A',
  );

  assert.equal(
    sessionB.cookieJar
      .getCookieHeader(
        'https://example.test/',
      ),
    null,
  );

  await manager.closeAll();

  assert.equal(
    dispatcherPool.size,
    0,
  );
});

test('different allocations remain dispatcher-isolated even when they reference the same proxy', async () => {
  const dispatcherPool =
    createDispatcherPool();

  const manager =
    new SessionManager({
      dispatcherPool,
    });

  const first =
    await manager
      .createForJob({
        job: {
          id: 'job-shared-a',
        },

        allocation:
          createAllocation(
            'job-shared-a',
            '171',
            'shared-proxy',
          ),
      });

  const second =
    await manager
      .createForJob({
        job: {
          id: 'job-shared-b',
        },

        allocation:
          createAllocation(
            'job-shared-b',
            '172',
            'shared-proxy',
          ),
      });

  assert.equal(
    first.proxyId,
    second.proxyId,
  );

  assert.notEqual(
    first.dispatcher,
    second.dispatcher,
  );

  await manager.closeAll();
});

test('retrying the same job and allocation reuses its session and dispatcher', async () => {
  const dispatcherPool =
    createDispatcherPool();

  const manager =
    new SessionManager({
      dispatcherPool,
    });

  const job = {
    id: 'job-retry',
  };

  const allocation =
    createAllocation(
      'job-retry',
      '181',
    );

  const first =
    await manager
      .createForJob({
        job,
        allocation,
      });

  const second =
    await manager
      .createForJob({
        job,
        allocation,
      });

  assert.equal(
    first,
    second,
  );

  assert.equal(
    first.cookieJar,
    second.cookieJar,
  );

  assert.equal(
    first.dispatcher,
    second.dispatcher,
  );

  assert.equal(
    dispatcherPool.size,
    1,
  );

  await manager.closeForJob(
    job.id,
  );

  assert.equal(
    dispatcherPool.size,
    0,
  );
});

test('session manager rejects allocation belonging to another job', async () => {
  const manager =
    new SessionManager({
      dispatcherPool:
        createDispatcherPool(),
    });

  await assert.rejects(
    () =>
      manager.createForJob({
        job: {
          id: 'job-a',
        },

        allocation:
          createAllocation(
            'job-b',
            '191',
          ),
      }),

    (error) => (
      error.code
      === ERROR_CODES
        .SESSION_ALLOCATION_MISMATCH
    ),
  );
});