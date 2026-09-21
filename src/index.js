import {
  resolve,
} from 'node:path';

import {
  fileURLToPath,
} from 'node:url';

import {
  getSafeConfigSummary,
  loadConfig,
} from './config/loader.js';

import {
  serializeError,
} from './core/errors.js';

import {
  createLogger,
} from './core/logger.js';

export async function main() {
  const config = loadConfig();

  const logger = createLogger({
    level: config.logging.level,
    service: config.app.name,
  });

  logger.info(
    {
      config: getSafeConfigSummary(config),
    },
    'Configuration loaded successfully.',
  );

  logger.info(
    {
      phase: 1,
      environment: config.app.environment,
    },
    'Application bootstrap verified.',
  );
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return (
    resolve(process.argv[1])
    === resolve(fileURLToPath(import.meta.url))
  );
}

if (isDirectExecution()) {
  main().catch((error) => {
    const logger = createLogger();

    logger.fatal(
      {
        error: serializeError(error),
      },
      'Application startup failed.',
    );

    process.exitCode = 1;
  });
}