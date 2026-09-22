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
 * Decorates the execution runtime with the verified Phase 9
 * final-result lifecycle.
 *
 * Expected composition:
 *
 *     ExecutionWorker
 *         -> RetryingExecutionRunner
 *         -> FinalizingExecutionRunner
 *
 * Success:
 *
 * - workflow completes;
 * - only whitelisted workflow summary is finalized;
 * - Portal acknowledgement occurs;
 * - job becomes COMPLETED;
 * - terminal IP release occurs.
 *
 * Terminal execution failure:
 *
 * - RetryingExecutionRunner has already classified the error as
 *   NON_RETRYABLE or EXHAUSTED;
 * - no further workflow retry is allowed;
 * - only bounded safe failure metadata is finalized;
 * - Portal acknowledgement occurs;
 * - job becomes FAILED_FINAL;
 * - terminal IP release occurs.
 *
 * Manual challenge and shutdown interruption are NOT terminalized
 * here because RetryingExecutionRunner propagates those original
 * errors rather than wrapping them as ExecutionTerminalFailureError.
 *
 * Safety boundaries:
 *
 * - raw upstream error messages are never copied into final-result
 *   payloads;
 * - JobContext responses, input, password, phone, passport,
 *   cookies, OTP, document URLs, PDF buffers, and target response
 *   payloads are never forwarded into final-result data;
 * - FinalResultService remains responsible for durable capture,
 *   Portal acknowledgement, terminal transition, and terminal-only
 *   IP release;
 * - Portal final-result delivery failures propagate;
 * - final-result delivery is never wrapped in workflow retry.
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

    let executionResult;

    try {
      executionResult =
        await this.executionWorker
          .run({
            jobId:
              normalizedJobId,

            input,

            signal,
          });
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
         * - integration/programming failures outside the bounded
         *   terminal execution classification
         *
         * None are guessed into FAILED_FINAL here.
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
            jobId:
              normalizedJobId,

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

        jobId:
          normalizedJobId,

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
          jobId:
            normalizedJobId,

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

      jobId:
        normalizedJobId,

      workflow: {
        ...data,
      },

      finalization,
    });
  }
}