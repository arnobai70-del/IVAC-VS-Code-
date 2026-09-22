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
  DashboardHttpServer,
} from './dashboard/http-server.js';

import {
  OperationalService,
} from './dashboard/operational-service.js';

import {
  closeDatabase,
  openDatabase,
} from './db/database.js';

import {
  migrateDatabase,
} from './db/migrations.js';

import {
  JobStore,
} from './jobs/job-store.js';

import {
  DispatcherPool,
} from './network/dispatcher-pool.js';

import {
  IntakeReservationStore,
} from './network/intake-reservation-store.js';

import {
  IpAllocator,
} from './network/ip-allocator.js';

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
  PortalIntakeService,
} from './portal/portal-intake-service.js';

import {
  PortalMapper,
} from './portal/portal-mapper.js';

import {
  PortalResultClient,
} from './portal/portal-result-client.js';

import {
  RecoveryService,
} from './recovery/recovery-service.js';

import {
  RecoveryStore,
} from './recovery/recovery-store.js';

import {
  FinalResultService,
} from './results/final-result-service.js';

import {
  FinalResultStore,
} from './results/final-result-store.js';

import {
  GracefulShutdown,
} from './runtime/graceful-shutdown.js';

import {
  IntakeLoop,
} from './runtime/intake-loop.js';

import {
  SessionManager,
} from './session/session-manager.js';

import {
  loadWorkflowDefinition,
} from './workflow/loader.js';

function summarizeRecovery(
  results,
) {
  const actions = {};

  for (const result of results) {
    const action =
      result?.action
      ?? 'UNKNOWN';

    actions[action] =
      (
        actions[action]
        ?? 0
      ) + 1;
  }

  return {
    total:
      results.length,

    actions,
  };
}

async function stopDashboardServer(
  dashboardServer,
) {
  if (!dashboardServer) {
    return false;
  }

  if (
    typeof dashboardServer.stop
      === 'function'
  ) {
    await dashboardServer.stop();

    return true;
  }

  if (
    typeof dashboardServer.close
      === 'function'
  ) {
    await dashboardServer.close();

    return true;
  }

  return false;
}

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

  let keepDatabaseOpen =
    false;

  let dashboardServer =
    null;

  let gracefulShutdown =
    null;

  let intakeLoop =
    null;

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

    const jobStore =
      new JobStore(
        database,
      );

    const finalResultStore =
      new FinalResultStore(
        database,
      );

    const recoveryStore =
      new RecoveryStore(
        database,
      );

    const portalResultClient =
      new PortalResultClient();

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

    const ipAllocator =
      new IpAllocator(
        database,
      );

    const intakeReservationStore =
      new IntakeReservationStore(
        database,
      );

    const dispatcherPool =
      new DispatcherPool({
        proxyPool,
      });

    const sessionManager =
      new SessionManager({
        dispatcherPool,
      });

    const finalResultService =
      new FinalResultService({
        jobStore,
        finalResultStore,
        portalResultClient,
        ipAllocator,
      });

    /*
     * Recovery runs before any destructive Portal intake.
     *
     * It operates only on durable local lifecycle state.
     * No Portal application payload, OTP, cookies, session
     * state, or PDF binary is reconstructed from SQLite.
     */
    const recoveryService =
      new RecoveryService({
        jobStore,
        ipAllocator,
        recoveryStore,
        finalResultStore,
        finalResultService,
        workflow,
      });

    const recoveryResults =
      recoveryService
        .recoverAll();

    logger.info(
      {
        recovery:
          summarizeRecovery(
            recoveryResults,
          ),

        sessionRecovery: {
          durable:
            false,

          cookieRecovery:
            false,

          dispatcherRecovery:
            false,

          sameIpAllocationRecovery:
            true,
        },

        documentUploadRecovery: {
          blindReplay:
            false,

          unverifiedRemoteIdempotency:
            true,
        },
      },
      'Durable restart recovery completed.',
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

    const portalMapper =
      new PortalMapper(
        config.portal.mapping,
      );

    const portalIntakeService =
      new PortalIntakeService({
        portalClient,
        portalMapper,
        jobStore,
        proxyPool,
        ipAllocator,
        intakeReservationStore,

        configuredConcurrency:
          config.runtime
            .concurrency,

        jobsPerCycle:
          config.runtime
            .jobsPerCycle,
      });

    intakeLoop =
      new IntakeLoop({
        portalIntakeService,

        pollIntervalMs:
          config.runtime
            .intakePollIntervalMs,

        logger,
      });

    logger.info(
      {
        intake: {
          enabled:
            config.runtime
              .intakeEnabled,

          pollIntervalMs:
            config.runtime
              .intakePollIntervalMs,

          configuredConcurrency:
            config.runtime
              .concurrency,

          jobsPerCycle:
            config.runtime
              .jobsPerCycle,

          overlappingCycles:
            false,

          blindFailureRetry:
            false,

          terminalOnlyIpRelease:
            true,
        },
      },
      'Portal intake runtime configured.',
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

          restartBlindUploadReplay:
            false,
        },
      },
      'Document integration safety boundaries configured.',
    );

    logger.info(
      {
        finalResultIntegration: {
          durableLedger:
            true,

          localDuplicateSendProtection:
            true,

          terminalAfterPortalAcknowledgement:
            true,

          portalContractConfigured:
            portalResultClient
              .isConfigured(),

          remoteIdempotentReplay:
            portalResultClient
              .supportsIdempotentReplay(),

          staleInFlightOnRestart:
            'UNCERTAIN',
        },
      },
      'Final-result integration safety boundaries configured.',
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

    if (
      config.dashboard.enabled
    ) {
      const operationalService =
        new OperationalService({
          jobStore,
          ipAllocator,
          proxyPool,
          finalResultStore,

          readinessProvider:
            async () => {
              const health =
                await portalClient
                  .healthCheck();

              const capacity =
                proxyPool
                  .countHealthyAvailable();

              const portalReady =
                health.safeToConsume
                === true;

              const hasCapacity =
                typeof capacity
                  === 'number'
                && capacity > 0;

              let reason =
                'READY';

              if (
                !portalReady
              ) {
                reason =
                  'PORTAL_NOT_READY';
              } else if (
                !hasCapacity
              ) {
                reason =
                  'NO_HEALTHY_PROXY_CAPACITY';
              }

              return {
                ready:
                  portalReady
                  && hasCapacity,

                reason,

                capacity,

                checkedAt:
                  new Date()
                    .toISOString(),
              };
            },
        });

      dashboardServer =
        new DashboardHttpServer({
          operationalService,

          host:
            config.dashboard
              .host,

          port:
            config.dashboard
              .port,

          logger,
        });

      const dashboardAddress =
        await dashboardServer
          .start();

      logger.info(
        {
          dashboard: {
            enabled:
              true,

            host:
              config.dashboard
                .host,

            port:
              dashboardAddress
                ?.port
              ?? config.dashboard
                .port,

            readOnly:
              true,

            loopbackOnly:
              true,

            mutationEndpoints:
              false,
          },
        },
        'Operational dashboard API enabled.',
      );
    } else {
      logger.info(
        {
          dashboard: {
            enabled:
              false,

            readOnly:
              true,

            loopbackOnly:
              true,
          },
        },
        'Operational dashboard API is disabled.',
      );
    }

    gracefulShutdown =
      new GracefulShutdown({
        logger,

        stopIntake:
          async () => {
            if (
              intakeLoop
            ) {
              await intakeLoop
                .stop();
            }
          },

        sessionManager,

        dispatcherPool,

        stopDashboard:
          async () => {
            await stopDashboardServer(
              dashboardServer,
            );
          },

        closeDatabase:
          async () => {
            closeDatabase(
              database,
            );
          },
      });

    const hasLongLivedRuntime =
      config.dashboard.enabled
      || config.runtime
        .intakeEnabled;

    /*
     * Install shutdown handling before destructive intake is
     * admitted. This closes the race where a signal could arrive
     * after intake starts but before the stop hook exists.
     */
    if (
      hasLongLivedRuntime
    ) {
      gracefulShutdown
        .installSignalHandlers();
    }

    if (
      config.runtime
        .intakeEnabled
    ) {
      intakeLoop.start();

      logger.info(
        {
          intake: {
            enabled:
              true,

            state:
              'RUNNING',

            destructivePortalIntake:
              true,

            explicitOptIn:
              true,

            automaticFailureRetry:
              false,
          },
        },
        'Portal intake loop enabled.',
      );
    } else {
      logger.info(
        {
          intake: {
            enabled:
              false,

            state:
              'DISABLED',

            destructivePortalIntake:
              false,

            explicitOptInRequired:
              true,
          },
        },
        'Portal intake loop is disabled.',
      );
    }

    /*
     * Keep SQLite open only while a deliberate long-lived
     * runtime component exists.
     *
     * With both dashboard and intake disabled, startup remains
     * a non-destructive verification/recovery pass and the
     * database is closed normally in finally.
     */
    if (
      hasLongLivedRuntime
    ) {
      keepDatabaseOpen =
        true;
    }

    logger.info(
      {
        phase:
          12,

        environment:
          config.app
            .environment,

        dashboardEnabled:
          config.dashboard
            .enabled,

        intake: {
          enabled:
            config.runtime
              .intakeEnabled,

          explicitOptIn:
            true,

          pollIntervalMs:
            config.runtime
              .intakePollIntervalMs,

          overlappingCycles:
            false,

          blindFailureRetry:
            false,
        },

        recovery: {
          enabled:
            true,

          boundedRetry:
            true,

          sameIpPreservation:
            true,

          sessionPersistence:
            false,

          terminalOnlyIpRelease:
            true,
        },

        gracefulShutdown: {
          enabled:
            true,

          signals:
            hasLongLivedRuntime
              ? [
                  'SIGINT',
                  'SIGTERM',
                ]
              : [],

          waitsForActiveIntake:
            true,

          releasesNonTerminalIp:
            false,
        },
      },
      'Application bootstrap verified.',
    );

    return {
      phase:
        12,

      recovery:
        summarizeRecovery(
          recoveryResults,
        ),

      intake: {
        enabled:
          config.runtime
            .intakeEnabled,

        status:
          intakeLoop
            .getStatus(),
      },

      gracefulShutdown,
    };
  } finally {
    if (
      !keepDatabaseOpen
    ) {
      if (
        gracefulShutdown
      ) {
        gracefulShutdown
          .removeSignalHandlers();
      }

      closeDatabase(
        database,
      );
    }
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