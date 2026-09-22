const MANUAL_CHALLENGE_CODE =
  'MANUAL_CHALLENGE_REQUIRED';

const SHUTDOWN_CODES =
  new Set([
    'PROCESS_SHUTDOWN',
    'GRACEFUL_SHUTDOWN',
    'SHUTDOWN_ABORT',
  ]);

function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
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

function requireNonEmptyString(
  value,
  name,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function getErrorName(
  error,
) {
  if (
    error
    && typeof error.name
      === 'string'
    && error.name.trim() !== ''
  ) {
    return error.name.trim();
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
    && error.code.trim() !== ''
  ) {
    return error.code.trim();
  }

  return null;
}

function isShutdownError(
  error,
) {
  const name =
    getErrorName(
      error,
    );

  const code =
    getErrorCode(
      error,
    );

  return (
    name === 'AbortError'
    || (
      code !== null
      && SHUTDOWN_CODES.has(
        code,
      )
    )
  );
}

function requireExecutionHandoff(
  job,
) {
  requireObject(
    job,
    'intake job descriptor',
  );

  if (
    typeof job.jobId !== 'string'
    || job.jobId.trim() === ''
  ) {
    throw new TypeError(
      'Intake job descriptor must contain jobId.',
    );
  }

  requireObject(
    job.executionInput,
    'intake job executionInput',
  );

  return job;
}

function classifyExecutionError({
  error,
  signal,
}) {
  if (
    getErrorCode(
      error,
    )
    === MANUAL_CHALLENGE_CODE
  ) {
    return {
      status:
        'MANUAL_CHALLENGE',

      errorName:
        getErrorName(
          error,
        ),

      errorCode:
        getErrorCode(
          error,
        ),
    };
  }

  if (
    signal?.aborted === true
    || isShutdownError(
      error,
    )
  ) {
    return {
      status:
        'ABORTED',

      errorName:
        getErrorName(
          error,
        ),

      errorCode:
        getErrorCode(
          error,
        ),
    };
  }

  return {
    status:
      'FAILED',

    errorName:
      getErrorName(
        error,
      ),

    errorCode:
      getErrorCode(
        error,
      ),
  };
}

export class IntakeExecutionHandler {
  constructor({
    executionWorker,
    logger = null,
  }) {
    requireObject(
      executionWorker,
      'executionWorker',
    );

    requireFunction(
      executionWorker.run,
      'executionWorker.run',
    );

    requireFunction(
      executionWorker.resumeManualChallenge,
      'executionWorker.resumeManualChallenge',
    );

    if (
      logger !== null
      && (
        typeof logger !== 'object'
        || Array.isArray(
          logger,
        )
      )
    ) {
      throw new TypeError(
        'logger must be an object or null.',
      );
    }

    this.executionWorker =
      executionWorker;

    this.logger =
      logger;

    this.stopped =
      false;

    this.handling =
      false;

    this.activeControllers =
      new Set();

    this.activeJobs =
      new Map();

    this.activeTasks =
      new Set();

    this.activePromise =
      null;

    this.completedCycles =
      0;

    this.totalAdmitted =
      0;

    this.totalWorkflowCompleted =
      0;

    this.totalFailed =
      0;

    this.totalManualChallenges =
      0;

    this.totalManualResumes =
      0;

    this.totalManualResumeCompleted =
      0;

    this.totalManualResumeFailed =
      0;

    this.totalManualResumeChallenges =
      0;

    this.totalManualResumeAborted =
      0;

    this.lastSummary =
      null;

    this.lastManualResume =
      null;
  }

  assertJobAvailable(
    jobId,
  ) {
    if (
      this.activeJobs.has(
        jobId,
      )
    ) {
      throw new Error(
        `Job ${jobId} already has an active execution.`,
      );
    }
  }

  runManaged({
    jobId,
    execute,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    requireFunction(
      execute,
      'execute',
    );

    if (
      this.stopped
    ) {
      throw new Error(
        'Execution runtime is stopped and cannot admit new work.',
      );
    }

    this.assertJobAvailable(
      normalizedJobId,
    );

    const controller =
      new AbortController();

    this.activeControllers.add(
      controller,
    );

    this.activeJobs.set(
      normalizedJobId,
      controller,
    );

    const task =
      Promise.resolve()
        .then(
          () =>
            execute(
              controller.signal,
            ),
        )
        .finally(
          () => {
            this.activeControllers
              .delete(
                controller,
              );

            if (
              this.activeJobs.get(
                normalizedJobId,
              )
              === controller
            ) {
              this.activeJobs
                .delete(
                  normalizedJobId,
                );
            }

            this.activeTasks
              .delete(
                task,
              );
          },
        );

    this.activeTasks.add(
      task,
    );

    return task;
  }

  async handleCycleResult(
    result,
  ) {
    requireObject(
      result,
      'cycle result',
    );

    if (
      this.handling
    ) {
      throw new Error(
        'IntakeExecutionHandler cannot handle overlapping cycle results.',
      );
    }

    const jobs =
      Array.isArray(
        result.jobs,
      )
        ? result.jobs
        : [];

    if (
      this.stopped
    ) {
      const summary = {
        admitted:
          0,

        workflowCompleted:
          0,

        failed:
          0,

        manualChallenges:
          0,

        aborted:
          0,

        skippedAfterStop:
          jobs.length,
      };

      this.lastSummary =
        summary;

      return {
        ...summary,
      };
    }

    const batchJobIds =
      new Set();

    for (
      const job
      of jobs
    ) {
      requireExecutionHandoff(
        job,
      );

      const jobId =
        job.jobId.trim();

      if (
        batchJobIds.has(
          jobId,
        )
      ) {
        throw new Error(
          `Intake cycle contains duplicate job ${jobId}.`,
        );
      }

      this.assertJobAvailable(
        jobId,
      );

      batchJobIds.add(
        jobId,
      );
    }

    this.handling =
      true;

    const runOne =
      async (
        job,
      ) => {
        const jobId =
          job.jobId.trim();

        try {
          const executionResult =
            await this.runManaged({
              jobId,

              execute:
                (signal) =>
                  this.executionWorker
                    .run({
                      jobId,

                      input:
                        job.executionInput,

                      signal,
                    }),
            });

          return {
            status:
              'WORKFLOW_COMPLETED',

            executionResult,
          };
        } catch (error) {
          return classifyExecutionError({
            error,

            signal:
              this.stopped
                ? {
                    aborted:
                      true,
                  }
                : null,
          });
        }
      };

    try {
      this.activePromise =
        Promise.all(
          jobs.map(
            runOne,
          ),
        );

      const outcomes =
        await this.activePromise;

      let workflowCompleted =
        0;

      let failed =
        0;

      let manualChallenges =
        0;

      let aborted =
        0;

      for (
        const outcome
        of outcomes
      ) {
        if (
          outcome.status
          === 'WORKFLOW_COMPLETED'
        ) {
          workflowCompleted +=
            1;

          continue;
        }

        if (
          outcome.status
          === 'MANUAL_CHALLENGE'
        ) {
          manualChallenges +=
            1;

          continue;
        }

        if (
          outcome.status
          === 'ABORTED'
        ) {
          aborted +=
            1;

          continue;
        }

        failed +=
          1;
      }

      const summary = {
        admitted:
          jobs.length,

        workflowCompleted,

        failed,

        manualChallenges,

        aborted,

        skippedAfterStop:
          0,
      };

      this.completedCycles +=
        1;

      this.totalAdmitted +=
        jobs.length;

      this.totalWorkflowCompleted +=
        workflowCompleted;

      this.totalFailed +=
        failed;

      this.totalManualChallenges +=
        manualChallenges;

      this.lastSummary =
        summary;

      this.logInfo(
        {
          executionCycle: {
            ...summary,

            boundedRetry:
              true,

            manualAutoResume:
              false,

            finalizationBoundary:
              true,
          },
        },
        'Fresh intake execution cycle completed.',
      );

      return {
        ...summary,
      };
    } finally {
      this.activePromise =
        null;

      this.handling =
        false;
    }
  }

  async resumeManualChallenge({
    jobId,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    if (
      this.stopped
    ) {
      throw new Error(
        'Execution runtime is stopped and cannot resume a manual challenge.',
      );
    }

    this.assertJobAvailable(
      normalizedJobId,
    );

    this.totalManualResumes +=
      1;

    let outcome;

    try {
      const executionResult =
        await this.runManaged({
          jobId:
            normalizedJobId,

          execute:
            (signal) =>
              this.executionWorker
                .resumeManualChallenge({
                  jobId:
                    normalizedJobId,

                  signal,
                }),
        });

      outcome = {
        status:
          'WORKFLOW_COMPLETED',

        executionResult,
      };

      this.totalManualResumeCompleted +=
        1;
    } catch (error) {
      outcome =
        classifyExecutionError({
          error,

          signal:
            this.stopped
              ? {
                  aborted:
                    true,
                }
              : null,
        });

      if (
        outcome.status
        === 'MANUAL_CHALLENGE'
      ) {
        this.totalManualResumeChallenges +=
          1;
      } else if (
        outcome.status
        === 'ABORTED'
      ) {
        this.totalManualResumeAborted +=
          1;
      } else {
        this.totalManualResumeFailed +=
          1;
      }
    }

    this.lastManualResume = {
      status:
        outcome.status,

      errorName:
        outcome.errorName
        ?? null,

      errorCode:
        outcome.errorCode
        ?? null,
    };

    this.logInfo(
      {
        manualChallengeResume: {
          status:
            outcome.status,

          errorCode:
            outcome.errorCode
            ?? null,

          automatic:
            false,

          sameProcessContextRequired:
            true,

          replacementIp:
            false,
        },
      },
      'Manual challenge resume attempt completed.',
    );

    return outcome;
  }

  async stop() {
    this.stopped =
      true;

    for (
      const controller
      of this.activeControllers
    ) {
      controller.abort();
    }

    const activeTasks = [
      ...this.activeTasks,
    ];

    if (
      activeTasks.length > 0
    ) {
      await Promise.allSettled(
        activeTasks,
      );
    }

    if (
      this.activePromise
    ) {
      await this.activePromise;
    }

    return this.getStatus();
  }

  getStatus() {
    return {
      stopped:
        this.stopped,

      handling:
        this.handling,

      activeExecutions:
        this.activeControllers
          .size,

      activeJobs:
        this.activeJobs
          .size,

      completedCycles:
        this.completedCycles,

      totalAdmitted:
        this.totalAdmitted,

      totalWorkflowCompleted:
        this.totalWorkflowCompleted,

      totalFailed:
        this.totalFailed,

      totalManualChallenges:
        this.totalManualChallenges,

      manualResume: {
        total:
          this.totalManualResumes,

        completed:
          this.totalManualResumeCompleted,

        failed:
          this.totalManualResumeFailed,

        manualChallenges:
          this.totalManualResumeChallenges,

        aborted:
          this.totalManualResumeAborted,

        last:
          this.lastManualResume
            ? {
                ...this.lastManualResume,
              }
            : null,
      },

      lastCycle:
        this.lastSummary
          ? {
              ...this.lastSummary,
            }
          : null,
    };
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
}