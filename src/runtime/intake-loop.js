function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}

function requireFunction(
  value,
  name,
) {
  if (
    typeof value !== 'function'
  ) {
    throw new TypeError(
      `${name} must be a function.`,
    );
  }

  return value;
}

function requirePositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value <= 0
  ) {
    throw new TypeError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}

function getErrorName(
  error,
) {
  if (
    error
    && typeof error.name
      === 'string'
    && error.name.length > 0
  ) {
    return error.name;
  }

  return 'Error';
}

function getErrorCode(
  error,
) {
  if (
    error
    && typeof error.code
      === 'string'
    && error.code.length > 0
  ) {
    return error.code;
  }

  return null;
}

function summarizeCycle(
  result,
) {
  return {
    consumed:
      Number.isInteger(
        result?.consumed,
      )
        ? result.consumed
        : 0,

    created:
      Number.isInteger(
        result?.created,
      )
        ? result.created
        : 0,

    duplicates:
      Number.isInteger(
        result?.duplicates,
      )
        ? result.duplicates
        : 0,

    effectiveCapacity:
      Number.isInteger(
        result?.effectiveCapacity,
      )
        ? result.effectiveCapacity
        : 0,

    blocker:
      typeof result?.blocker
        === 'string'
        ? result.blocker
        : null,

    jobCount:
      Array.isArray(
        result?.jobs,
      )
        ? result.jobs.length
        : 0,
  };
}

/*
 * Safe long-lived Portal intake scheduler.
 *
 * Safety properties:
 *
 * - only PortalIntakeService.runCycle() performs intake;
 * - cycles never overlap;
 * - a thrown intake error is NOT automatically retried;
 * - stop() never aborts an in-flight destructive intake;
 * - stop() only prevents admission of the next cycle;
 * - this component never allocates or releases an IP itself;
 * - this component never persists Portal payloads;
 * - this component never logs job/application/user payloads;
 * - no session/cookie recovery is attempted here.
 *
 * The absence of automatic retry after a thrown runCycle()
 * error is deliberate. A destructive Portal request may have
 * an uncertain remote outcome, so replay must not be assumed
 * safe without an explicit remote idempotency contract.
 */
export class IntakeLoop {
  constructor({
    portalIntakeService,
    pollIntervalMs,
    logger = null,
    onCycleResult = null,
  }) {
    requireObject(
      portalIntakeService,
      'portalIntakeService',
    );

    requireFunction(
      portalIntakeService
        .runCycle,
      'portalIntakeService.runCycle',
    );

    requirePositiveInteger(
      pollIntervalMs,
      'pollIntervalMs',
    );

    if (
      logger !== null
      && typeof logger !== 'object'
    ) {
      throw new TypeError(
        'logger must be an object or null.',
      );
    }

    if (
      onCycleResult !== null
    ) {
      requireFunction(
        onCycleResult,
        'onCycleResult',
      );
    }

    this.portalIntakeService =
      portalIntakeService;

    this.pollIntervalMs =
      pollIntervalMs;

    this.logger =
      logger;

    this.onCycleResult =
      onCycleResult;

    this.started =
      false;

    this.running =
      false;

    this.stopRequested =
      false;

    this.completedCycles =
      0;

    this.lastCycleSummary =
      null;

    this.failure =
      null;

    this.loopPromise =
      null;

    this.pendingDelayTimer =
      null;

    this.resolvePendingDelay =
      null;
  }

  start() {
    if (
      this.started
      && this.running
    ) {
      return false;
    }

    if (
      this.started
      && !this.running
    ) {
      throw new Error(
        'IntakeLoop cannot be restarted after it has stopped.',
      );
    }

    this.started =
      true;

    this.running =
      true;

    this.stopRequested =
      false;

    this.failure =
      null;

    this.loopPromise =
      this.runLoop()
        .catch(
          (error) => {
            this.failure =
              error;

            this.logError(
              {
                intakeLoop: {
                  state:
                    'FAILED',

                  errorName:
                    getErrorName(
                      error,
                    ),

                  errorCode:
                    getErrorCode(
                      error,
                    ),
                },
              },
              'Portal intake loop stopped after a cycle failure.',
            );
          },
        )
        .finally(
          () => {
            this.running =
              false;

            this.clearPendingDelay();

            this.logInfo(
              {
                intakeLoop: {
                  state:
                    this.failure
                      ? 'FAILED'
                      : 'STOPPED',

                  completedCycles:
                    this.completedCycles,

                  stopRequested:
                    this.stopRequested,
                },
              },
              'Portal intake loop finished.',
            );
          },
        );

    this.logInfo(
      {
        intakeLoop: {
          state:
            'RUNNING',

          pollIntervalMs:
            this.pollIntervalMs,

          overlappingCycles:
            false,

          automaticFailureRetry:
            false,
        },
      },
      'Portal intake loop started.',
    );

    return true;
  }

  async runLoop() {
    while (
      !this.stopRequested
    ) {
      const result =
        await this.portalIntakeService
          .runCycle();

      this.completedCycles +=
        1;

      this.lastCycleSummary =
        summarizeCycle(
          result,
        );

      this.logInfo(
        {
          intakeCycle: {
            number:
              this.completedCycles,

            ...this.lastCycleSummary,
          },
        },
        'Portal intake cycle completed.',
      );

      /*
       * The callback is intentionally downstream-only.
       *
       * IntakeLoop does not interpret job payloads and does
       * not mutate job/IP lifecycle state. A later runtime
       * execution component may consume the already-created
       * local job descriptors through this callback.
       */
      if (
        this.onCycleResult
      ) {
        await this.onCycleResult(
          result,
        );
      }

      if (
        this.stopRequested
      ) {
        break;
      }

      await this.waitForNextCycle();
    }
  }

  async stop() {
    if (
      !this.started
    ) {
      return {
        stopped:
          false,

        reason:
          'NOT_STARTED',

        completedCycles:
          this.completedCycles,

        failed:
          this.failure !== null,
      };
    }

    this.stopRequested =
      true;

    /*
     * Wake only an idle polling delay.
     *
     * There is deliberately no AbortController for an active
     * runCycle(). Interrupting a potentially destructive Portal
     * request could create an uncertain remote/local outcome.
     * Graceful shutdown therefore waits for the active cycle.
     */
    this.wakePendingDelay();

    if (
      this.loopPromise
    ) {
      await this.loopPromise;
    }

    return {
      stopped:
        true,

      reason:
        this.failure
          ? 'FAILED'
          : 'STOP_REQUESTED',

      completedCycles:
        this.completedCycles,

      failed:
        this.failure !== null,
    };
  }

  getStatus() {
    return {
      started:
        this.started,

      running:
        this.running,

      stopRequested:
        this.stopRequested,

      completedCycles:
        this.completedCycles,

      failed:
        this.failure !== null,

      failure:
        this.failure
          ? {
              name:
                getErrorName(
                  this.failure,
                ),

              code:
                getErrorCode(
                  this.failure,
                ),
            }
          : null,

      lastCycle:
        this.lastCycleSummary
          ? {
              ...this.lastCycleSummary,
            }
          : null,
    };
  }

  async waitForNextCycle() {
    if (
      this.stopRequested
    ) {
      return;
    }

    await new Promise(
      (resolveDelay) => {
        let settled =
          false;

        const finish =
          () => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            if (
              this.pendingDelayTimer
            ) {
              clearTimeout(
                this.pendingDelayTimer,
              );
            }

            this.pendingDelayTimer =
              null;

            this.resolvePendingDelay =
              null;

            resolveDelay();
          };

        this.resolvePendingDelay =
          finish;

        this.pendingDelayTimer =
          setTimeout(
            finish,
            this.pollIntervalMs,
          );
      },
    );
  }

  wakePendingDelay() {
    const resolveDelay =
      this.resolvePendingDelay;

    if (
      resolveDelay
    ) {
      resolveDelay();
    }
  }

  clearPendingDelay() {
    if (
      this.pendingDelayTimer
    ) {
      clearTimeout(
        this.pendingDelayTimer,
      );

      this.pendingDelayTimer =
        null;
    }

    const resolveDelay =
      this.resolvePendingDelay;

    this.resolvePendingDelay =
      null;

    if (
      resolveDelay
    ) {
      resolveDelay();
    }
  }

  logInfo(
    fields,
    message,
  ) {
    if (
      typeof this.logger?.info
        === 'function'
    ) {
      this.logger.info(
        fields,
        message,
      );
    }
  }

  logError(
    fields,
    message,
  ) {
    if (
      typeof this.logger?.error
        === 'function'
    ) {
      this.logger.error(
        fields,
        message,
      );
    }
  }
}