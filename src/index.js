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

import {
  PortalClient,
} from './portal/portal-client.js';

import {
  loadWorkflowDefinition,
} from './workflow/loader.js';

export async function main() {
  const config =
    loadConfig();

  const logger =
    createLogger({
      level:
        config.logging.level,

      service:
        config.app.name,
    });

  logger.info(
    {
      config:
        getSafeConfigSummary(
          config,
        ),
    },
    'Configuration loaded successfully.',
  );

  const workflowPath =
    resolve(
      PROJECT_ROOT,
      config.workflow.file,
    );

  const workflow =
    loadWorkflowDefinition({
      filePath:
        workflowPath,

      maxSteps:
        config.workflow
          .maxSteps,
    });

  logger.info(
    {
      workflow: {
        name:
          workflow.name,

        version:
          workflow.version,

        enabled:
          workflow.enabled,

        stepCount:
          workflow.steps
            .length,
      },
    },
    'Workflow definition validated.',
  );

  const databasePath =
    resolve(
      PROJECT_ROOT,
      config.database.file,
    );

  const database =
    openDatabase({
      filePath:
        databasePath,

      busyTimeoutMs:
        config.database
          .busyTimeoutMs,
    });

  try {
    const migrations =
      migrateDatabase(
        database,
      );

    logger.info(
      {
        database: {
          file:
            config.database.file,

          migrationCount:
            migrations.length,

          latestMigration:
            migrations.at(-1)
              ?.version
            ?? null,
        },
      },
      'Database initialized successfully.',
    );

    const proxyConfigPath =
      resolve(
        PROJECT_ROOT,
        config.network
          .proxyConfigFile,
      );

    const proxyConfig =
      loadProxyConfig({
        filePath:
          proxyConfigPath,

        required:
          false,
      });

    const proxyPool =
      new ProxyPool(
        database,
      );

    const proxies =
      proxyPool
        .syncFromConfig(
          proxyConfig.proxies,
        );

    logger.info(
      {
        proxyPool: {
          configPresent:
            proxyConfig
              .sourceExists,

          total:
            proxies.length,

          healthyAvailable:
            proxyPool
              .countHealthyAvailable(),
        },
      },
      'Proxy pool synchronized.',
    );

    const portalClient =
      new PortalClient({
        baseUrl:
          config.portal
            .baseUrl,

        pendingPath:
          config.portal
            .pendingPath,

        healthPath:
          config.portal
            .healthPath,

        timeoutMs:
          config.portal
            .timeoutMs,

        maxResponseBytes:
          config.portal
            .maxResponseBytes,

        accessToken:
          config.secrets
            .portalApiAccessToken,
      });

    const portalHealth =
      await portalClient
        .healthCheck();

    logger.info(
      {
        portal: {
          status:
            portalHealth.status,

          reachable:
            portalHealth
              .reachable,

          authenticated:
            portalHealth
              .authenticated,

          safeToConsume:
            portalHealth
              .safeToConsume,
        },
      },
      'Portal readiness probe completed.',
    );

    logger.info(
      {
        otpIntegration: {
          mode:
            'HTML_TABLE',

          baselineMatching:
            true,

          directNetworkFallback:
            false,
        },
      },
      'OTP integration configured.',
    );

    logger.info(
      {
        documentIntegration: {
          sourceAllowlist:
            true,

          pdfContentTypeValidation:
            true,

          pdfSignatureValidation:
            true,

          boundedFileSize:
            true,

          boundedTotalSize:
            true,

          multipartUpload:
            true,

          temporaryDiskFiles:
            false,

          directNetworkFallback:
            false,
        },
      },
      'Document integration safety boundaries configured.',
    );

    logger.info(
      {
        workflowEngine: {
          safeTemplates:
            true,

          evalEnabled:
            false,

          absoluteTargetRoutes:
            false,

          challengeBypass:
            false,
        },
      },
      'Workflow engine safety boundaries configured.',
    );

    logger.info(
      {
        phase: 8,

        environment:
          config.app
            .environment,
      },
      'Application bootstrap verified.',
    );
  } finally {
    closeDatabase(
      database,
    );
  }
}

function isDirectExecution() {
  if (
    !process.argv[1]
  ) {
    return false;
  }

  return (
    resolve(
      process.argv[1],
    )
    === resolve(
      fileURLToPath(
        import.meta.url,
      ),
    )
  );
}

if (
  isDirectExecution()
) {
  main().catch(
    (error) => {
      const logger =
        createLogger();

      logger.fatal(
        {
          error:
            serializeError(
              error,
            ),
        },
        'Application startup failed.',
      );

      process.exitCode =
        1;
    },
  );
}