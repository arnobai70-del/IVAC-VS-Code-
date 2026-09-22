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
  DEFAULT_MAX_RETRIES,
} from './recovery/retry-policy.js';

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
  ExecutionWorker,
} from './runtime/execution-worker.js';

import {
  FinalizingExecutionRunner,
} from './runtime/finalizing-execution-runner.js';

import {
  FinalResultRecoveryRunner,
} from './runtime/final-result-recovery-runner.js';

import {
  GracefulShutdown,
} from './runtime/graceful-shutdown.js';

import {
  IntakeExecutionHandler,
} from './runtime/intake-execution-handler.js';

import {
  IntakeLoop,
} from './runtime/intake-loop.js';

import {
  createJobWorkflowExecutor,
} from './runtime/job-workflow-executor.js';

import {
  RetryingExecutionRunner,
} from './runtime/retrying-execution-runner.js';

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

function summarizeFinalResultRecovery(
  results,
) {
  const statuses = {};
  const reasons = {};

  for (const result of results) {
    const status =
      result?.status
      ?? 'UNKNOWN';

    statuses[status] =
      (
        statuses[status]
        ?? 0
      ) + 1;

    if (
      result?.reason
    ) {
      reasons[result.reason] =
        (
          reasons[result.reason]
          ?? 0
        ) + 1;
    }
  }

  return {
    total:
      results.length,

    statuses,

    reasons,
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

function assertDestructiveRuntimeReady({
  intakeEnabled,
  workflowRuntimeEnabled,
  workflow,
  portalResultClient,
}) {
  if (!intakeEnabled) {
    return;
  }

  if (
    workflowRuntimeEnabled
    !== true
  ) {
    throw new Error(
      'Portal intake cannot be enabled while workflow runtime execution is disabled.',
    );
  }

  if (
    workflow.enabled
    !== true
  ) {
    throw new Error(
      'Portal intake cannot be enabled while the workflow definition is disabled.',
    );
  }

  if (
    !portalResultClient
      .isConfigured()
  ) {
    throw new Error(
      'Portal intake cannot be enabled until the verified Portal final-result contract is configured.',
    );
  }
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

  const workflowRuntimeEnabled =
    config.workflow.enabled
    === true;

  const workflowDefinitionEnabled =
    workflow.enabled
    === true;

  const workflowExecutionEnabled =
    workflowRuntimeEnabled
    && workflowDefinitionEnabled;

  logger.info(
    {
      workflow: {
        name:
          workflow.name,

        version:
          workflow.version,

        runtimeEnabled:
          workflowRuntimeEnabled,

        definitionEnabled:
          workflowDefinitionEnabled,

        executionEnabled:
          workflowExecutionEnabled,

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

  let intakeExecutionHandler =
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

    assertDestructiveRuntimeReady({
      intakeEnabled:
        config.runtime
          .intakeEnabled,

      workflowRuntimeEnabled,

      workflow,

      portalResultClient,
    });

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

    /*
     * Final-result restart recovery remains outside workflow
     * execution and workflow retry.
     *
     * RecoveryService first classifies/repairs durable restart
     * state. This runner may then re-enter delivery only from the
     * already-durable final-result ledger.
     *
     * With the default unconfigured Portal result contract all
     * delivery attempts remain fail-closed.
     *
     * UNCERTAIN delivery is replayed only if verified remote
     * idempotency is explicitly declared by that contract.
     */
    const finalResultRecoveryRunner =
      new FinalResultRecoveryRunner({
        finalResultService,
        portalResultClient,
      });

    const finalResultRecoveryResults =
      await finalResultRecoveryRunner
        .run(
          recoveryResults,
        );

    logger.info(
      {
        recovery:
          summarizeRecovery(
            recoveryResults,
          ),

        finalResultRecovery:
          summarizeFinalResultRecovery(
            finalResultRecoveryResults,
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

        executionInputRecovery: {
          durable:
            false,

          portalCredentialRecovery:
            false,

          documentSourceRecovery:
            false,
        },

        documentUploadRecovery: {
          blindReplay:
            false,

          unverifiedRemoteIdempotency:
            true,
        },

        manualChallengeRecovery: {
          automaticResume:
            false,

          restartResume:
            false,

          sameProcessContextRequired:
            true,

          originalSessionRequired:
            true,

          sameIpRequired:
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

    /*
     * Lowest execution layer.
     *
     * It activates only the intake-bound allocation and creates
     * the per-job memory-only session/context.
     *
     * Manual challenge continuation can only re-enter through
     * ExecutionWorker.resumeManualChallenge(), which requires the
     * original same-process JobContext/session/allocation.
     */
    const executionWorker =
      new ExecutionWorker({
        jobStore,
        ipAllocator,
        sessionManager,

        executeWorkflow:
          async ({
            jobContext,
            signal,
          }) => {
            const executor =
              createJobWorkflowExecutor({
                session:
                  jobContext.session,

                workflow,

                targetConfig:
                  config.target,

                otpConfig:
                  config.otp,

                documentConfig:
                  config.documents,

                portalAccessToken:
                  config.secrets
                    .portalApiAccessToken,

                maxSteps:
                  config.workflow
                    .maxSteps,
              });

            return executor.execute({
              jobContext,
              signal,
            });
          },
      });

    /*
     * Retry boundary wraps workflow execution only.
     *
     * Explicitly retryable failures:
     *
     * - consume durable retry budget;
     * - keep the same IP;
     * - move through RETRY_PENDING;
     * - use bounded retry-policy delay;
     * - reuse same-process session/context where possible.
     *
     * Manual challenge and shutdown are never automatically
     * retried.
     *
     * After an explicit manual resume, a later distinct retryable
     * execution failure may enter the normal bounded retry path.
     */
    const retryingExecutionRunner =
      new RetryingExecutionRunner({
        executionWorker,
        jobStore,
        ipAllocator,

        maxRetries:
          DEFAULT_MAX_RETRIES,
      });

    /*
     * Finalization is OUTSIDE the workflow retry boundary.
     *
     * This prevents a Portal final-result delivery error from
     * replaying the target workflow.
     *
     * SUCCESS becomes COMPLETED only after verified Portal
     * acknowledgement.
     *
     * NON_RETRYABLE / EXHAUSTED execution failure becomes
     * FAILED_FINAL only after verified Portal acknowledgement.
     *
     * Explicit manual resume passes through the same finalization
     * boundary only after workflow execution reaches a terminal
     * execution outcome.
     */
    const finalizingExecutionRunner =
      new FinalizingExecutionRunner({
        executionWorker:
          retryingExecutionRunner,

        finalResultService,
      });

    /*
     * Admission and shutdown ownership for both:
     *
     * - fresh intake execution;
     * - explicit same-process manual challenge resume.
     *
     * There is intentionally no automatic resume path and no
     * dashboard mutation endpoint.
     */
    intakeExecutionHandler =
      new IntakeExecutionHandler({
        executionWorker:
          finalizingExecutionRunner,

        logger,
      });

    intakeLoop =
      new IntakeLoop({
        portalIntakeService,

        pollIntervalMs:
          config.runtime
            .intakePollIntervalMs,

        logger,

        onCycleResult:
          async (
            result,
          ) => {
            await intakeExecutionHandler
              .handleCycleResult(
                result,
              );
          },
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

          executionHandoff: {
            memoryOnly:
              true,

            enumerable:
              false,

            restartRecoverable:
              false,
          },
        },
      },
      'Portal intake runtime configured.',
    );

    logger.info(
      {
        executionRuntime: {
          configured:
            true,

          workflowRuntimeEnabled:
            workflowRuntimeEnabled,

          workflowDefinitionEnabled:
            workflowDefinitionEnabled,

          workflowEnabled:
            workflowExecutionEnabled,

          intakeExecutionConnected:
            true,

          sameIpPerJob:
            true,

          replacementIpAcquisition:
            false,

          sessionPersistence:
            false,

          executionInputPersistence:
            false,

          completedStepReplay:
            false,

          partialDocumentUploadReuse:
            true,

          boundedRetry:
            true,

          maxRetries:
            DEFAULT_MAX_RETRIES,

          retryDelaysMs: [
            1000,
            5000,
            15000,
          ],

          manualChallengeRetry:
            false,

          manualChallengeResume: {
            automatic:
              false,

            explicitOnly:
              true,

            sameProcessOnly:
              true,

            originalContextRequired:
              true,

            originalSessionRequired:
              true,

            sameIpRequired:
              true,

            replacementIp:
              false,

            restartRecoverable:
              false,

            dashboardMutationEndpoint:
              false,

            externalControlConfigured:
              false,
          },

          shutdownRetry:
            false,

          unknownErrorRetry:
            false,

          finalResultOutsideRetryBoundary:
            true,

          finalizationRequired:
            true,

          terminalOnlyIpRelease:
            true,
        },
      },
      'Per-job execution runtime configured.',
    );

    logger.info(
      {
        otpIntegration: {
          mode:
            'HTML_TABLE',

          baselineMatching:
            true,

          sameJobHttpClient:
            true,

          directNetworkFallback:
            false,

          challengeBypass:
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

          sameJobHttpClient:
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

          sameProcessCompletedUploadReuse:
            true,
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

          workflowReplayOnDeliveryFailure:
            false,

          staleInFlightOnRestart:
            'UNCERTAIN',

          restartDeliveryRecovery:
            summarizeFinalResultRecovery(
              finalResultRecoveryResults,
            ),
        },
      },
      'Final-result integration safety boundaries configured.',
    );

    logger.info(
      {
        workflowEngine: {
          runtimeEnabled:
            workflowRuntimeEnabled,

          definitionEnabled:
            workflowDefinitionEnabled,

          executionEnabled:
            workflowExecutionEnabled,

          safeTemplates:
            true,

          evalEnabled:
            false,

          absoluteTargetRoutes:
            false,

          sameJobNetworkPath:
            true,

          challengeBypass:
            false,

          completedStepResume:
            true,

          nonContiguousResumeState:
            'FAIL_CLOSED',

          restartResume:
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

            mutationEndpoints:
              false,
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
            /*
             * Stop workflow admission first.
             *
             * Active fresh execution, explicit manual resume, or
             * retry wait receives an abort signal. No path releases
             * a non-terminal IP or consumes a fresh retry because
             * of shutdown.
             */
            if (
              intakeExecutionHandler
            ) {
              await intakeExecutionHandler
                .stop();
            }

            /*
             * Destructive Portal runCycle() is never aborted.
             *
             * If already active, IntakeLoop waits for it. Its
             * callback sees the stopped execution handler and
             * therefore does not admit fresh workflow execution.
             */
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

            workflowRuntimeEnabled:
              workflowRuntimeEnabled,

            workflowDefinitionEnabled:
              workflowDefinitionEnabled,

            workflowExecution:
              workflowExecutionEnabled,

            boundedWorkflowRetry:
              true,

            maxWorkflowRetries:
              DEFAULT_MAX_RETRIES,

            finalResultRequired:
              true,

            automaticDestructiveIntakeRetry:
              false,

            automaticManualChallengeResume:
              false,
          },
        },
        'Portal intake and execution loop enabled.',
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

            workflowRuntimeEnabled:
              workflowRuntimeEnabled,

            workflowDefinitionEnabled:
              workflowDefinitionEnabled,

            workflowExecution:
              false,

            explicitOptInRequired:
              true,

            automaticManualChallengeResume:
              false,
          },
        },
        'Portal intake loop is disabled.',
      );
    }

    if (
      hasLongLivedRuntime
    ) {
      keepDatabaseOpen =
        true;
    }

    logger.info(
      {
        phase:
          17,

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

          automaticManualChallengeResume:
            false,
        },

        execution: {
          connected:
            true,

          workflowRuntimeEnabled:
            workflowRuntimeEnabled,

          workflowDefinitionEnabled:
            workflowDefinitionEnabled,

          workflowEnabled:
            workflowExecutionEnabled,

          sameIpPerJob:
            true,

          replacementIp:
            false,

          inputPersistence:
            false,

          sessionPersistence:
            false,

          challengeBypass:
            false,

          completedStepReplay:
            false,

          partialDocumentUploadReuse:
            true,

          boundedRetry:
            true,

          maxRetries:
            DEFAULT_MAX_RETRIES,

          manualChallengeRetry:
            false,

          manualChallengeResume:
            true,

          manualChallengeResumeExplicitOnly:
            true,

          manualChallengeResumeSameProcessOnly:
            true,

          manualChallengeResumeRestartRecoverable:
            false,

          manualChallengeExternalControlConfigured:
            false,

          shutdownRetry:
            false,

          successRequiresFinalResult:
            true,

          terminalFailureRequiresFinalResult:
            true,

          finalResultDeliveryInsideRetryBoundary:
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

          executionInputPersistence:
            false,

          manualChallengeAutomaticResume:
            false,

          manualChallengeRestartResume:
            false,

          terminalOnlyIpRelease:
            true,

          finalResultDeliveryRecovery:
            summarizeFinalResultRecovery(
              finalResultRecoveryResults,
            ),
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

          abortsActiveWorkflow:
            true,

          abortsManualChallengeResume:
            true,

          abortsRetryWait:
            true,

          releasesNonTerminalIp:
            false,
        },
      },
      'Application bootstrap verified.',
    );

    return {
      phase:
        17,

      recovery:
        summarizeRecovery(
          recoveryResults,
        ),

      finalResultRecovery:
        summarizeFinalResultRecovery(
          finalResultRecoveryResults,
        ),

      intake: {
        enabled:
          config.runtime
            .intakeEnabled,

        status:
          intakeLoop
            .getStatus(),
      },

      execution:
        intakeExecutionHandler
          .getStatus(),

      manualChallenge: {
        resumeAvailableWithinProcess:
          true,

        explicitOnly:
          true,

        automaticResume:
          false,

        restartRecoverable:
          false,

        sameProcessContextRequired:
          true,

        sameSessionRequired:
          true,

        sameIpRequired:
          true,

        externalControlConfigured:
          false,

        dashboardMutationEndpoint:
          false,
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