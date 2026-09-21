function requireFunctionOrNull(
  value,
  name,
) {
  if (
    value !== null
    && value !== undefined
    && typeof value !== 'function'
  ) {
    throw new TypeError(
      `${name} must be a function, null, or undefined.`,
    );
  }

  return value ?? null;
}

function requirePositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}

function createShutdownError(
  signal,
) {
  const error =
    new Error(
      `Process shutdown requested by ${signal}.`,
    );

  error.name =
    'AbortError';

  error.code =
    'GRACEFUL_SHUTDOWN';

  error.retryable =
    false;

  return error;
}

function timeoutPromise(
  timeoutMs,
) {
  return new Promise(
    (resolve) => {
      const timer =
        setTimeout(
          () => {
            resolve({
              timedOut:
                true,
            });
          },
          timeoutMs,
        );

      timer.unref?.();
    },
  );
}

export class GracefulShutdown {
  constructor({
    logger = null,
    stopIntake = null,
    sessionManager = null,
    dispatcherPool = null,
    stopDashboard = null,
    closeDatabase = null,
    settleTimeoutMs = 10_000,
  } = {}) {
    if (
      logger !== null
      && typeof logger !== 'object'
    ) {
      throw new TypeError(
        'logger must be an object or null.',
      );
    }

    if (
      sessionManager !== null
      && (
        typeof sessionManager !== 'object'
        || typeof sessionManager.closeAll
          !== 'function'
      )
    ) {
      throw new TypeError(
        'sessionManager must provide closeAll().',
      );
    }

    if (
      dispatcherPool !== null
      && (
        typeof dispatcherPool !== 'object'
        || typeof dispatcherPool.closeAll
          !== 'function'
      )
    ) {
      throw new TypeError(
        'dispatcherPool must provide closeAll().',
      );
    }

    this.logger =
      logger;

    this.stopIntake =
      requireFunctionOrNull(
        stopIntake,
        'stopIntake',
      );

    this.sessionManager =
      sessionManager;

    this.dispatcherPool =
      dispatcherPool;

    this.stopDashboard =
      requireFunctionOrNull(
        stopDashboard,
        'stopDashboard',
      );

    this.closeDatabase =
      requireFunctionOrNull(
        closeDatabase,
        'closeDatabase',
      );

    this.settleTimeoutMs =
      requirePositiveInteger(
        settleTimeoutMs,
        'settleTimeoutMs',
      );

    this.inFlight =
      new Map();

    this.acceptingWork =
      true;

    this.shutdownPromise =
      null;

    this.signalHandlers =
      new Map();
  }

  get isShuttingDown() {
    return !this.acceptingWork;
  }

  get inFlightCount() {
    return this.inFlight.size;
  }

  assertAcceptingWork() {
    if (
      !this.acceptingWork
    ) {
      const error =
        new Error(
          'Runtime is shutting down and is not accepting new work.',
        );

      error.code =
        'RUNTIME_SHUTTING_DOWN';

      error.retryable =
        true;

      throw error;
    }
  }

  trackInFlight(
    promise,
    {
      abortController = null,
    } = {},
  ) {
    this.assertAcceptingWork();

    if (
      !promise
      || typeof promise.then
        !== 'function'
    ) {
      throw new TypeError(
        'promise must be promise-like.',
      );
    }

    if (
      abortController !== null
      && (
        typeof abortController !== 'object'
        || typeof abortController.abort
          !== 'function'
      )
    ) {
      throw new TypeError(
        'abortController must provide abort().',
      );
    }

    const token =
      Symbol(
        'in-flight-work',
      );

    const tracked =
      Promise.resolve(
        promise,
      );

    this.inFlight.set(
      token,
      {
        promise:
          tracked,

        abortController,
      },
    );

    tracked
      .finally(
        () => {
          this.inFlight.delete(
            token,
          );
        },
      )
      .catch(
        () => {
          /*
           * Prevent the bookkeeping branch from creating
           * an additional unhandled rejection.
           *
           * The original promise remains responsible for
           * normal caller-visible error handling.
           */
        },
      );

    return tracked;
  }

  abortInFlight(
    signal,
  ) {
    const reason =
      createShutdownError(
        signal,
      );

    for (
      const entry
      of this.inFlight.values()
    ) {
      if (
        !entry.abortController
      ) {
        continue;
      }

      try {
        entry.abortController.abort(
          reason,
        );
      } catch {
        /*
         * Shutdown cleanup is best-effort here.
         * The promise settlement phase below remains bounded.
         */
      }
    }
  }

  async waitForInFlight() {
    const promises =
      Array.from(
        this.inFlight.values(),
        (entry) =>
          Promise.resolve(
            entry.promise,
          ),
      );

    if (
      promises.length === 0
    ) {
      return {
        total:
          0,

        timedOut:
          false,
      };
    }

    const settlement =
      Promise.allSettled(
        promises,
      ).then(
        () => ({
          timedOut:
            false,
        }),
      );

    const result =
      await Promise.race([
        settlement,
        timeoutPromise(
          this.settleTimeoutMs,
        ),
      ]);

    return {
      total:
        promises.length,

      timedOut:
        result.timedOut,
    };
  }

  logInfo(
    data,
    message,
  ) {
    if (
      typeof this.logger?.info
        === 'function'
    ) {
      this.logger.info(
        data,
        message,
      );
    }
  }

  logWarn(
    data,
    message,
  ) {
    if (
      typeof this.logger?.warn
        === 'function'
    ) {
      this.logger.warn(
        data,
        message,
      );
    }
  }

  async performShutdown(
    signal,
  ) {
    /*
     * Ordering is deliberate:
     *
     * 1. stop new intake/admission
     * 2. abort and boundedly settle in-flight work
     * 3. destroy memory-only sessions/cookies
     * 4. close any remaining dispatchers
     * 5. stop dashboard listener
     * 6. close database
     *
     * There is intentionally no IpAllocator.releaseForJob()
     * call here. Process shutdown is not a terminal job event.
     */
    this.acceptingWork =
      false;

    this.logInfo(
      {
        signal,

        inFlight:
          this.inFlightCount,
      },
      'Graceful shutdown started.',
    );

    const cleanupErrors = [];

    if (
      this.stopIntake
    ) {
      try {
        await this.stopIntake();
      } catch (error) {
        cleanupErrors.push(
          {
            stage:
              'STOP_INTAKE',

            error,
          },
        );
      }
    }

    /*
     * Only after intake has stopped may existing work
     * be interrupted.
     */
    this.abortInFlight(
      signal,
    );

    const inFlightResult =
      await this.waitForInFlight();

    if (
      inFlightResult.timedOut
    ) {
      this.logWarn(
        {
          signal,

          inFlight:
            this.inFlightCount,

          settleTimeoutMs:
            this.settleTimeoutMs,
        },
        'In-flight work did not fully settle before the shutdown deadline.',
      );
    }

    if (
      this.sessionManager
    ) {
      try {
        await this.sessionManager
          .closeAll();
      } catch (error) {
        cleanupErrors.push(
          {
            stage:
              'CLOSE_SESSIONS',

            error,
          },
        );
      }
    }

    /*
     * SessionManager.closeAll() normally closes allocation
     * dispatchers already. closeAll() here is intentional
     * defense-in-depth for probe dispatchers or orphaned
     * in-memory transports.
     *
     * Closing dispatchers does not release durable IP
     * allocations.
     */
    if (
      this.dispatcherPool
    ) {
      try {
        await this.dispatcherPool
          .closeAll();
      } catch (error) {
        cleanupErrors.push(
          {
            stage:
              'CLOSE_DISPATCHERS',

            error,
          },
        );
      }
    }

    if (
      this.stopDashboard
    ) {
      try {
        await this.stopDashboard();
      } catch (error) {
        cleanupErrors.push(
          {
            stage:
              'STOP_DASHBOARD',

            error,
          },
        );
      }
    }

    if (
      this.closeDatabase
    ) {
      try {
        await this.closeDatabase();
      } catch (error) {
        cleanupErrors.push(
          {
            stage:
              'CLOSE_DATABASE',

            error,
          },
        );
      }
    }

    if (
      cleanupErrors.length > 0
    ) {
      this.logWarn(
        {
          signal,

          cleanupStages:
            cleanupErrors.map(
              (entry) =>
                entry.stage,
            ),
        },
        'Graceful shutdown completed with cleanup errors.',
      );
    } else {
      this.logInfo(
        {
          signal,

          inFlightTimedOut:
            inFlightResult
              .timedOut,
        },
        'Graceful shutdown completed.',
      );
    }

    return {
      signal,

      inFlight:
        inFlightResult,

      cleanupErrors:
        cleanupErrors.map(
          (entry) => ({
            stage:
              entry.stage,

            error:
              entry.error,
          }),
        ),
    };
  }

  shutdown({
    signal =
      'PROGRAMMATIC',
  } = {}) {
    if (
      this.shutdownPromise
    ) {
      return this.shutdownPromise;
    }

    this.shutdownPromise =
      this.performShutdown(
        signal,
      );

    return this.shutdownPromise;
  }

  installSignalHandlers({
    signals = [
      'SIGINT',
      'SIGTERM',
    ],
  } = {}) {
    if (
      !Array.isArray(
        signals,
      )
      || signals.length === 0
    ) {
      throw new TypeError(
        'signals must be a non-empty array.',
      );
    }

    for (
      const signal
      of signals
    ) {
      if (
        typeof signal !== 'string'
        || signal.trim() === ''
      ) {
        throw new TypeError(
          'Every signal must be a non-empty string.',
        );
      }

      const normalized =
        signal.trim();

      if (
        this.signalHandlers.has(
          normalized,
        )
      ) {
        continue;
      }

      const handler =
        () => {
          this.shutdown({
            signal:
              normalized,
          }).catch(
            (error) => {
              this.logWarn(
                {
                  signal:
                    normalized,

                  errorCode:
                    error?.code
                    ?? 'SHUTDOWN_ERROR',
                },
                'Graceful shutdown failed.',
              );

              process.exitCode =
                1;
            },
          );
        };

      this.signalHandlers.set(
        normalized,
        handler,
      );

      process.on(
        normalized,
        handler,
      );
    }
  }

  removeSignalHandlers() {
    for (
      const [
        signal,
        handler,
      ]
      of this.signalHandlers
    ) {
      process.off(
        signal,
        handler,
      );
    }

    this.signalHandlers.clear();
  }
}