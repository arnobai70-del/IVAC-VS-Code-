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
  DEFAULT_CONFIG_PATH,
  getSafeConfigSummary,
  loadConfig,
} from '../src/config/loader.js';

import {
  ConfigError,
} from '../src/core/errors.js';

test('project app.json passes configuration validation', () => {
  const config = loadConfig({
    configPath:
      DEFAULT_CONFIG_PATH,
    env: {},
    loadEnvFile: false,
  });

  assert.equal(
    config.app.name,
    'ivac-automation',
  );

  assert.equal(
    config.runtime.concurrency,
    2,
  );

  assert.equal(
    config.database.file,
    'data/ivac.sqlite3',
  );

  assert.equal(
    config.network.proxyConfigFile,
    'config/proxies.json',
  );

  assert.equal(
    config.portal.pendingPath,
    '/api/application/pending',
  );
});

test('environment overrides are loaded without exposing the token in safe summary', () => {
  const temporaryDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-config-test-',
      ),
    );

  const environmentFile =
    join(
      temporaryDirectory,
      '.env.local',
    );

  writeFileSync(
    environmentFile,
    [
      'PORTAL_API_ACCESS_TOKEN=test-secret-token',
      'APP_ENV=test',
      'LOG_LEVEL=debug',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const config = loadConfig({
      configPath:
        DEFAULT_CONFIG_PATH,
      envPath:
        environmentFile,
      env: {},
      loadEnvFile: true,
    });

    assert.equal(
      config.secrets
        .portalApiAccessToken,
      'test-secret-token',
    );

    assert.equal(
      config.app.environment,
      'test',
    );

    assert.equal(
      config.logging.level,
      'debug',
    );

    const safeSummary =
      getSafeConfigSummary(config);

    const serializedSummary =
      JSON.stringify(safeSummary);

    assert.equal(
      safeSummary.secrets
        .portalApiAccessTokenConfigured,
      true,
    );

    assert.equal(
      serializedSummary.includes(
        'test-secret-token',
      ),
      false,
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

test('invalid concurrency is rejected', () => {
  const temporaryDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-config-test-',
      ),
    );

  const configFile =
    join(
      temporaryDirectory,
      'app.json',
    );

  const invalidConfig = {
    app: {
      name: 'ivac-automation',
      environment: 'test',
    },

    runtime: {
      concurrency: 0,
      jobsPerCycle: 1,
      requestDelayMs: 0,
    },

    database: {
      file: 'data/test.sqlite3',
      busyTimeoutMs: 5000,
    },

    network: {
      proxyConfigFile:
        'config/proxies.json',
      healthCheckUrl: null,
      healthTimeoutMs: 5000,
      cooldownMs: 30000,
    },

    portal: {
      baseUrl:
        'https://mrboss.live',
      pendingPath:
        '/api/application/pending',
      healthPath: null,
      timeoutMs: 10000,
    },

    otp: {
      baseUrl:
        'https://otp.cat-paymentbd.com',
      tablePath:
        '/otp_table',
      pollIntervalMs: 3000,
      timeoutMs: 120000,
    },

    target: {
      baseUrl:
        'https://api.ivacbd.com/iams/api/v1',
      timeoutMs: 15000,
    },

    logging: {
      level: 'info',
    },
  };

  writeFileSync(
    configFile,
    JSON.stringify(
      invalidConfig,
      null,
      2,
    ),
    'utf8',
  );

  try {
    assert.throws(
      () => {
        loadConfig({
          configPath:
            configFile,
          env: {},
          loadEnvFile: false,
        });
      },
      ConfigError,
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