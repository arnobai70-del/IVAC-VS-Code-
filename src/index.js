import {
  resolve,
} from 'node:path';

import {
  fileURLToPath,
} from 'node:url';

import {
  getSafeConfigSummary,
  loadConfig,
  PROJECT_ROOT,
} from './config/loader.js';

import {
  serializeError,
} from './core/errors.js';

import {
  createLogger,
} from './core/logger.js';

import {
  closeDatabase,
  openDatabase,
} from './db/database.js';

import {
  migrateDatabase,
} from './db/migrations.js';

import {
  loadProxyConfig,
} from './network/proxy-config.js';

import {
  ProxyPool,
} from './network/proxy-pool.js';

export async function main() {
  const config = loadConfig();

  const logger = createLogger({
    level: config.logging.level,
    service: config.app.name,
  });

  logger.info(
    {
      config:
        getSafeConfigSummary(config),
    },
    'Configuration loaded successfully.',
  );

  const databasePath = resolve(
    PROJECT_ROOT,
    config.database.file,
  );

  const database = openDatabase({
    filePath: databasePath,
    busyTimeoutMs:
      config.database.busyTimeoutMs,
  });

  try {
    const migrations =
      migrateDatabase(database);

    logger.info(
      {
        database: {
          file: config.database.file,
          migrationCount:
            migrations.length,
          latestMigration:
            migrations.at(-1)?.version
            ?? null,
        },
      },
      'Database initialized successfully.',
    );

    const proxyConfigPath =
      resolve(
        PROJECT_ROOT,
        config.network.proxyConfigFile,
      );

    const proxyConfig =
      loadProxyConfig({
        filePath: proxyConfigPath,
        required: false,
      });

    const proxyPool =
      new ProxyPool(database);

    const proxies =
      proxyPool.syncFromConfig(
        proxyConfig.proxies,
      );

    logger.info(
      {
        proxyPool: {
          configPresent:
            proxyConfig.sourceExists,
          total:
            proxies.length,
          healthyAvailable:
            proxyPool
              .countHealthyAvailable(),
        },
      },
      'Proxy pool synchronized.',
    );

    logger.info(
      {
        phase: 3,
        environment:
          config.app.environment,
      },
      'Application bootstrap verified.',
    );
  } finally {
    closeDatabase(database);
  }
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return (
    resolve(process.argv[1])
    === resolve(
      fileURLToPath(import.meta.url),
    )
  );
}

if (isDirectExecution()) {
  main().catch((error) => {
    const logger = createLogger();

    logger.fatal(
      {
        error:
          serializeError(error),
      },
      'Application startup failed.',
    );

    process.exitCode = 1;
  });
}