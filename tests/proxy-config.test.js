import assert from 'node:assert/strict';

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
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
  loadProxyConfig,
  validateProxyConfig,
} from '../src/network/proxy-config.js';

test('missing optional proxy file produces an empty pool', () => {
  const result =
    loadProxyConfig({
      filePath:
        join(
          tmpdir(),
          `missing-${Date.now()}.json`,
        ),

      required: false,
    });

  assert.equal(
    result.sourceExists,
    false,
  );

  assert.deepEqual(
    result.proxies,
    [],
  );
});

test('valid proxy configuration is normalized', () => {
  const temporaryDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-proxy-config-',
      ),
    );

  const filePath =
    join(
      temporaryDirectory,
      'proxies.json',
    );

  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,

      proxies: [
        {
          id: 'proxy-1',
          ip: '203.0.113.11',
          port: 8080,
          protocol: 'http',
          enabled: true,
          username: '',
          password: '',
        },
      ],
    }),
    'utf8',
  );

  try {
    const result =
      loadProxyConfig({
        filePath,
        required: true,
      });

    assert.equal(
      result.sourceExists,
      true,
    );

    assert.equal(
      result.proxies.length,
      1,
    );

    assert.equal(
      result.proxies[0].username,
      undefined,
    );
  } finally {
    rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

test('duplicate proxy endpoint is rejected', () => {
  assert.throws(
    () => {
      validateProxyConfig({
        version: 1,

        proxies: [
          {
            id: 'proxy-a',
            ip: '203.0.113.20',
            port: 8080,
          },

          {
            id: 'proxy-b',
            ip: '203.0.113.20',
            port: 8080,
          },
        ],
      });
    },

    (error) => (
      error.code
      === ERROR_CODES.PROXY_CONFIG_ERROR
    ),
  );
});