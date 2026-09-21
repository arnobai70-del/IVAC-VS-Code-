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
  DispatcherPool,
} from '../src/network/dispatcher-pool.js';

import {
  ProxyPool,
} from '../src/network/proxy-pool.js';

function createFixture() {
  const database =
    openDatabase({
      filePath: ':memory:',
    });

  migrateDatabase(database);

  const proxyPool =
    new ProxyPool(database);

  proxyPool.syncFromConfig([
    {
      id: 'proxy-1',
      ip: '203.0.113.81',
      port: 8080,
      protocol: 'http',
      enabled: true,
    },
  ]);

  const dispatcherPool =
    new DispatcherPool({
      proxyPool,
    });

  return {
    database,
    proxyPool,
    dispatcherPool,
  };
}

test('dispatcher is reused only for the same proxy configuration', async () => {
  const fixture =
    createFixture();

  try {
    const first =
      await fixture.dispatcherPool
        .getForProxy(
          'proxy-1',
          {
            allowDisabled: true,
          },
        );

    const second =
      await fixture.dispatcherPool
        .getForProxy(
          'proxy-1',
          {
            allowDisabled: true,
          },
        );

    assert.equal(
      first,
      second,
    );

    assert.equal(
      fixture.dispatcherPool.size,
      1,
    );
  } finally {
    await fixture.dispatcherPool
      .closeAll();

    closeDatabase(
      fixture.database,
    );
  }
});

test('dispatcher pool never falls back to a direct connection', async () => {
  const fixture =
    createFixture();

  try {
    await assert.rejects(
      () =>
        fixture.dispatcherPool
          .getForProxy(
            'missing-proxy',
          ),

      (error) => (
        error.code
        === ERROR_CODES.PROXY_NOT_FOUND
      ),
    );
  } finally {
    await fixture.dispatcherPool
      .closeAll();

    closeDatabase(
      fixture.database,
    );
  }
});