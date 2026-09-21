import {
  existsSync,
  readFileSync,
} from 'node:fs';

import {
  dirname,
  resolve,
} from 'node:path';

import {
  fileURLToPath,
} from 'node:url';

import dotenv from 'dotenv';

import {
  ConfigError,
} from '../core/errors.js';

import {
  formatZodIssues,
  validateAppConfig,
  validateEnvironmentConfig,
} from './schema.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(currentDirectory, '..', '..');

export const DEFAULT_CONFIG_PATH = resolve(
  PROJECT_ROOT,
  'config',
  'app.json',
);

export const DEFAULT_ENV_PATH = resolve(
  PROJECT_ROOT,
  '.env.local',
);

function readJsonFile(filePath) {
  let raw;

  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ConfigError(
      `Unable to read configuration file: ${filePath}`,
      {
        cause: error,
      },
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      `Configuration file contains invalid JSON: ${filePath}`,
      {
        cause: error,
      },
    );
  }
}

function readEnvironmentFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return dotenv.parse(readFileSync(filePath));
  } catch (error) {
    throw new ConfigError(
      `Unable to read environment file: ${filePath}`,
      {
        cause: error,
      },
    );
  }
}

function deepFreeze(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Object.isFrozen(value)
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

export function loadConfig({
  configPath = DEFAULT_CONFIG_PATH,
  envPath = DEFAULT_ENV_PATH,
  env = process.env,
  loadEnvFile = true,
} = {}) {
  const rawAppConfig = readJsonFile(configPath);

  let appConfig;

  try {
    appConfig = validateAppConfig(rawAppConfig);
  } catch (error) {
    throw new ConfigError(
      'Static application configuration is invalid.',
      {
        cause: error,
        details: formatZodIssues(error),
      },
    );
  }

  const fileEnvironment = loadEnvFile
    ? readEnvironmentFile(envPath)
    : {};

  const mergedEnvironment = {
    ...fileEnvironment,
    ...env,
  };

  let environmentConfig;

  try {
    environmentConfig = validateEnvironmentConfig(
      mergedEnvironment,
    );
  } catch (error) {
    throw new ConfigError(
      'Environment configuration is invalid.',
      {
        cause: error,
        details: formatZodIssues(error),
      },
    );
  }

  const configWithOverrides = {
    ...appConfig,

    app: {
      ...appConfig.app,
      environment:
        environmentConfig.APP_ENV
        ?? appConfig.app.environment,
    },

    logging: {
      ...appConfig.logging,
      level:
        environmentConfig.LOG_LEVEL
        ?? appConfig.logging.level,
    },

    secrets: {
      portalApiAccessToken:
        environmentConfig.PORTAL_API_ACCESS_TOKEN
        ?? null,
    },
  };

  try {
    validateAppConfig(configWithOverrides);
  } catch (error) {
    throw new ConfigError(
      'Application configuration is invalid after applying environment overrides.',
      {
        cause: error,
        details: formatZodIssues(error),
      },
    );
  }

  return deepFreeze(configWithOverrides);
}

export function getSafeConfigSummary(config) {
  return {
    app: config.app,
    runtime: config.runtime,

    database: {
      file: config.database.file,
      busyTimeoutMs: config.database.busyTimeoutMs,
    },

    network: {
      proxyConfigFile: config.network.proxyConfigFile,
      healthCheckConfigured:
        Boolean(config.network.healthCheckUrl),
      healthTimeoutMs: config.network.healthTimeoutMs,
      cooldownMs: config.network.cooldownMs,
    },

    portal: {
      baseUrl: config.portal.baseUrl,
      pendingPath: config.portal.pendingPath,
      healthPathConfigured:
        Boolean(config.portal.healthPath),
      timeoutMs: config.portal.timeoutMs,
    },

    otp: {
      baseUrl: config.otp.baseUrl,
      tablePath: config.otp.tablePath,
      pollIntervalMs: config.otp.pollIntervalMs,
      timeoutMs: config.otp.timeoutMs,
    },

    target: {
      baseUrl: config.target.baseUrl,
      timeoutMs: config.target.timeoutMs,
    },

    logging: config.logging,

    secrets: {
      portalApiAccessTokenConfigured:
        Boolean(config.secrets.portalApiAccessToken),
    },
  };
}