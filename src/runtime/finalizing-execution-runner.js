import {
  FINAL_RESULT_OUTCOMES,
} from '../results/final-result.js';

import {
  ExecutionTerminalFailureError,
} from './retrying-execution-runner.js';

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

function requireNonNegativeInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative integer.`,
    );
  }

  return value;
}

function buildSafeSuccessData(
  executionResult,
) {
  requireObject(
    executionResult,
    'executionResult',
  );

  if (
    executionResult.status
    !== 'WORKFLOW_COMPLETED'
  ) {
    throw new Error(
      'Execution result is not ready for success finalization.',
    );
  }

  const workflowResult =
    requireObject(
      executionResult.workflowResult,
      'executionResult.workflowResult',
    );

  if (
    workflowResult.status
    !== 'COMPLETED'
  ) {
    throw new Error(
      'Workflow result is not completed.',
    );
  }

  return Object.freeze({
    workflowName:
      requireNonEmptyString(
        workflowResult.workflowName,
        'workflowResult.workflowName',
      ),

    completedSteps:
      requireNonNegativeInteger(
        workflowResult.completedSteps,
        'workflowResult.completedSteps',
      ),
  });
}

function buildSafeFailureData(
  error,
) {
  if (
    !(
      error
      instanceof
        ExecutionTerminalFailureError
    )
  ) {
    throw new TypeError(
      'A terminal execution failure is required.',
    );
  }

  return Object.freeze({
    retryDecision:
      requireNonEmptyString(
        error.retryDecision,
        'error.retryDecision',
      ),

    retryCount:
      requireNonNegativeInteger(
        error.retryCount,
        'error.retryCount',
      ),
  });
}

/*
 * Final-result boundary around the retrying execution runtime.
 *
 * Expected composition:
 *
 *     ExecutionWorker
 *         -> RetryingExecutionRunner
 *         -> FinalizingExecutionRunner
 *
 * Both normal execution and explicit manual-challenge resume
 * terminate through this same final-result lifecycle.
 *
 * FinalResultService remains OUTSIDE workflow retry. Therefore
 * Portal result-delivery failures never replay target workflow
 * steps.
 */
export class FinalizingExecutionRunner {
  constructor({
    executionWorker,
    finalResultService,
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

    requireObject(
      finalResultService,
      'finalResultService',
    );

    requireFunction(
      finalResultService.finalize,
      'finalResultService.finalize',
    );

    this.executionWorker =
      executionWorker;

    this.finalResultService =
      finalResultService;
  }

  async finalizeExecution({
    jobId,
    execute,
  }) {
    let executionResult;

    try {
      executionResult =
        await execute();
    } catch (error) {
      if (
        !(
          error
          instanceof
            ExecutionTerminalFailureError
        )
      ) {
        /*
         * Includes:
         *
         * - MANUAL_CHALLENGE_REQUIRED
         * - shutdown / AbortError
         * - missing memory-only manual-resume context
         * - integration/programming failures outside bounded
         *   terminal execution classification
         *
         * None are guessed into FAILED_FINAL.
         */
        throw error;
      }

      const data =
        buildSafeFailureData(
          error,
        );

      const finalization =
        await this.finalResultService
          .finalize({
            jobId,

            outcome:
              FINAL_RESULT_OUTCOMES
                .FAILURE,

            code:
              error.failureCode,

            message:
              error.retryDecision
              === 'EXHAUSTED'
                ? 'Workflow execution retry limit was exhausted.'
                : 'Workflow execution failed with a non-retryable error.',

            data,
          });

      return Object.freeze({
        status:
          'FINALIZED',

        outcome:
          FINAL_RESULT_OUTCOMES
            .FAILURE,

        jobId,

        failure: {
          code:
            error.failureCode,

          retryDecision:
            data.retryDecision,

          retryCount:
            data.retryCount,
        },

        finalization,
      });
    }

    const data =
      buildSafeSuccessData(
        executionResult,
      );

    const finalization =
      await this.finalResultService
        .finalize({
          jobId,

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data,
        });

    return Object.freeze({
      status:
        'FINALIZED',

      outcome:
        FINAL_RESULT_OUTCOMES
          .SUCCESS,

      jobId,

      workflow: {
        ...data,
      },

      finalization,
    });
  }

  async run({
    jobId,
    input = {},
    signal = null,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    requireObject(
      input,
      'input',
    );

    return this.finalizeExecution({
      jobId:
        normalizedJobId,

      execute:
        () =>
          this.executionWorker
            .run({
              jobId:
                normalizedJobId,

              input,

              signal,
            }),
    });
  }

  /*
   * Explicit manual-challenge continuation.
   *
   * No new input is accepted here. The underlying retry runner
   * requires the original memory-only JobContext/session.
   *
   * A successful resumed workflow goes through the exact same
   * SUCCESS finalization as normal execution.
   *
   * A bounded terminal execution failure goes through the exact
   * same FAILURE finalization.
   *
   * A repeated manual challenge or shutdown remains non-terminal
   * and propagates without finalization.
   */
  async resumeManualChallenge({
    jobId,
    signal = null,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    return this.finalizeExecution({
      jobId:
        normalizedJobId,

      execute:
        () =>
          this.executionWorker
            .resumeManualChallenge({
              jobId:
                normalizedJobId,

              signal,
            }),
    });
  }
}