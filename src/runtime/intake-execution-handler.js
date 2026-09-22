const MANUAL_CHALLENGE_CODE =
  'MANUAL_CHALLENGE_REQUIRED';

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

  /*
   * executionInput is deliberately non-enumerable in
   * PortalIntakeService, but normal property access must still
   * expose it to this in-memory runtime handoff.
   */
  requireObject(
    job.executionInput,
    'intake job executionInput',
  );

  return job;
}

/*
 * Bridges one completed Portal intake cycle to ExecutionWorker.
 *
 * Safety boundaries:
 *
 * - consumes only freshly created in-memory handoffs;
 * - never reacquires or replaces an IP;
 * - never persists executionInput;
 * - never serializes/logs executionInput;
 * - never logs password/phone/passport/document data;
 * - never retries a failed workflow automatically;
 * - one failed job does not cancel sibling jobs from the same
 *   already-consumed intake cycle;
 * - MANUAL_CHALLENGE_REQUIRED remains manual;
 * - stop() aborts workflow execution but never releases IPs;
 * - workflow success is not treated as terminal here;
 * - final-result capture/acknowledgement remains a separate
 *   lifecycle concern.
 *
 * The IntakeLoop already guarantees that onCycleResult callbacks
 * do not overlap. This class also rejects direct overlapping use
 * so that invariant remains explicit outside IntakeLoop.
 */
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

    if (
      logger !== null
      && (
        typeof logger !== 'object'
        || Array.isArray(logger)
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

    this.lastSummary =
      null;
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

    /*
     * Shutdown may arrive after destructive intake has completed
     * but before its callback begins.
     *
     * Do not start new workflow execution after stop. The newly
     * created WAITING_FOR_IP jobs and their same-IP allocations
     * remain durable for recovery; sensitive executionInput is
     * intentionally not restart-recoverable.
     */
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

        skippedAfterStop:
          jobs.length,
      };

      this.lastSummary =
        summary;

      return {
        ...summary,
      };
    }

    /*
     * Validate the complete batch before admitting any workflow.
     * A malformed internal handoff is a programming/integration
     * error and should fail closed rather than partially execute
     * the cycle.
     */
    for (
      const job
      of jobs
    ) {
      requireExecutionHandoff(
        job,
      );
    }

    this.handling =
      true;

    const runOne =
      async (
        job,
      ) => {
        const controller =
          new AbortController();

        this.activeControllers.add(
          controller,
        );

        try {
          const executionResult =
            await this.executionWorker
              .run({
                jobId:
                  job.jobId,

                input:
                  job.executionInput,

                signal:
                  controller.signal,
              });

          return {
            status:
              'WORKFLOW_COMPLETED',

            executionResult,
          };
        } catch (error) {
          return {
            status:
              getErrorCode(
                error,
              )
                === MANUAL_CHALLENGE_CODE
                ? 'MANUAL_CHALLENGE'
                : (
                    controller
                      .signal
                      .aborted
                      ? 'ABORTED'
                      : 'FAILED'
                  ),

            errorName:
              getErrorName(
                error,
              ),

            errorCode:
              getErrorCode(
                error,
              ),
          };
        } finally {
          this.activeControllers
            .delete(
              controller,
            );
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

            automaticRetry:
              false,

            terminalization:
              false,
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

  async stop() {
    this.stopped =
      true;

    /*
     * Abort only workflow execution.
     *
     * ExecutionWorker deliberately keeps interrupted jobs
     * non-terminal and does not release their IP allocation.
     */
    for (
      const controller
      of this.activeControllers
    ) {
      controller.abort();
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