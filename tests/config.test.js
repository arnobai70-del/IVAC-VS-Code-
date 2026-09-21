import assert from 'node:assert/strict';

import {
  mkdtempSync,
  readFileSync,
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
  const config =
    loadConfig({
      configPath:
        DEFAULT_CONFIG_PATH,

      env: {},

      loadEnvFile:
        false,
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
    config.network
      .proxyConfigFile,
    'config/proxies.json',
  );

  assert.equal(
    config.portal.pendingPath,
    '/api/application/pending',
  );

  assert.equal(
    config.otp.tablePath,
    '/otp_table',
  );

  assert.equal(
    config.otp.columns.phone,
    'Phone Number',
  );

  assert.equal(
    config.workflow.file,
    'config/workflow.json',
  );

  assert.equal(
    config.workflow.maxSteps,
    100,
  );
});

test('dashboard configuration defaults to disabled loopback-only operation', () => {
  const config =
    loadConfig({
      configPath:
        DEFAULT_CONFIG_PATH,

      env: {},

      loadEnvFile:
        false,
    });

  assert.deepEqual(
    config.dashboard,
    {
      enabled: false,
      host: '127.0.0.1',
      port: 8787,
    },
  );

  const safeSummary =
    getSafeConfigSummary(
      config,
    );

  assert.deepEqual(
    safeSummary.dashboard,
    {
      enabled: false,
      host: '127.0.0.1',
      port: 8787,
    },
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
    const config =
      loadConfig({
        configPath:
          DEFAULT_CONFIG_PATH,

        envPath:
          environmentFile,

        env: {},

        loadEnvFile:
          true,
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
      getSafeConfigSummary(
        config,
      );

    const serializedSummary =
      JSON.stringify(
        safeSummary,
      );

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

    assert.equal(
      safeSummary.workflow.file,
      'config/workflow.json',
    );

    assert.deepEqual(
      safeSummary.dashboard,
      {
        enabled: false,
        host: '127.0.0.1',
        port: 8787,
      },
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

test('dashboard rejects non-loopback bind addresses', () => {
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

  const sourceConfig =
    JSON.parse(
      readFileSync(
        DEFAULT_CONFIG_PATH,
        'utf8',
      ),
    );

  const invalidConfig = {
    ...sourceConfig,

    dashboard: {
      enabled: true,
      host: '0.0.0.0',
      port: 8787,
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

          loadEnvFile:
            false,
        });
      },

      (error) => {
        assert.ok(
          error instanceof ConfigError,
        );

        assert.equal(
          JSON.stringify(
            error.details,
          ).includes(
            'dashboard.host',
          ),
          true,
        );

        return true;
      },
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
      name:
        'ivac-automation',

      environment:
        'test',
    },

    runtime: {
      concurrency: 0,
      jobsPerCycle: 1,
      requestDelayMs: 0,
    },

    database: {
      file:
        'data/test.sqlite3',

      busyTimeoutMs:
        5000,
    },

    network: {
      proxyConfigFile:
        'config/proxies.json',

      healthCheckUrl:
        null,

      healthTimeoutMs:
        5000,

      cooldownMs:
        30000,
    },

    portal: {
      baseUrl:
        'https://mrboss.live',

      pendingPath:
        '/api/application/pending',

      healthPath:
        null,

      timeoutMs:
        10000,

      maxResponseBytes:
        1048576,

      mapping: {
        applicationId:
          'id',

        userId:
          'user_id',

        phone:
          'phone',

        password:
          'password',

        passportNumber:
          'passport_number',

        documents:
          'documents',
      },
    },

    otp: {
      baseUrl:
        'https://otp.cat-paymentbd.com',

      tablePath:
        '/otp_table',

      pollIntervalMs:
        3000,

      timeoutMs:
        120000,

      maxResponseBytes:
        2097152,

      maxRows:
        5000,

      tableSelector:
        'table',

      columns: {
        phone:
          'Phone Number',

        code:
          'OTP',

        createdAt:
          'Created At',
      },
    },

    target: {
      baseUrl:
        'https://api.ivacbd.com/iams/api/v1',

      timeoutMs:
        15000,
    },

    workflow: {
      file:
        'config/workflow.json',

      maxSteps:
        100,
    },

    logging: {
      level:
        'info',
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

          loadEnvFile:
            false,
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