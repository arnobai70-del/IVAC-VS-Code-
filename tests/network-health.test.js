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
  NetworkHealthService,
} from '../src/network/network-health.js';

import {
  ProxyPool,
} from '../src/network/proxy-pool.js';

import {
  PROXY_STATES,
} from '../src/network/proxy-state.js';

function createFixture(
  requestFn,
) {
  const database =
    openDatabase({
      filePath: ':memory:',
    });

  migrateDatabase(database);

  const proxyPool =
    new ProxyPool(database);

  proxyPool.syncFromConfig([
    {
      id: 'proxy-health',
      ip: '203.0.113.91',
      port: 8080,
      protocol: 'http',
      enabled: true,
    },
  ]);

  const dispatcherPool =
    new DispatcherPool({
      proxyPool,
    });

  const networkHealth =
    new NetworkHealthService({
      proxyPool,
      dispatcherPool,
      requestFn,
    });

  return {
    database,
    proxyPool,
    dispatcherPool,
    networkHealth,
  };
}

test('successful health test marks proxy healthy and available', async () => {
  const fixture =
    createFixture(
      async (
        url,
        options,
      ) => {
        assert.equal(
          url,
          'https://health.test/',
        );

        assert.ok(
          options.dispatcher,
        );

        return {
          statusCode: 204,

          body: {
            async dump() {},
          },
        };
      },
    );

  try {
    const result =
      await fixture.networkHealth
        .testProxy(
          'proxy-health',
          {
            url:
              'https://health.test/',
            timeoutMs: 1000,
            cooldownMs: 30000,
          },
        );

    assert.equal(
      result.ok,
      true,
    );

    const proxy =
      fixture.proxyPool
        .getProxyById(
          'proxy-health',
        );

    assert.equal(
      proxy.lastHealthOk,
      true,
    );

    assert.equal(
      proxy.status,
      PROXY_STATES.AVAILABLE,
    );

    assert.equal(
      fixture.proxyPool
        .countHealthyAvailable(),
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

test('failed health test places an idle proxy in cooldown', async () => {
  const fixture =
    createFixture(
      async () => {
        throw Object.assign(
          new Error(
            'simulated timeout',
          ),
          {
            code:
              'UND_ERR_CONNECT_TIMEOUT',
          },
        );
      },
    );

  try {
    const result =
      await fixture.networkHealth
        .testProxy(
          'proxy-health',
          {
            url:
              'https://health.test/',
            timeoutMs: 1000,
            cooldownMs: 30000,
          },
        );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.errorCode,
      ERROR_CODES.NETWORK_TIMEOUT,
    );

    const proxy =
      fixture.proxyPool
        .getProxyById(
          'proxy-health',
        );

    assert.equal(
      proxy.status,
      PROXY_STATES.COOLDOWN,
    );

    assert.equal(
      proxy.lastHealthOk,
      false,
    );

    assert.equal(
      fixture.proxyPool
        .countHealthyAvailable(),
      0,
    );
  } finally {
    await fixture.dispatcherPool
      .closeAll();

    closeDatabase(
      fixture.database,
    );
  }
});