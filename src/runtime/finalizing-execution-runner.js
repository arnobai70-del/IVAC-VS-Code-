import {
  FINAL_RESULT_OUTCOMES,
} from '../results/final-result.js';

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

/*
 * Decorates ExecutionWorker with the verified Phase 9
 * final-result lifecycle.
 *
 * Only successful workflow execution is finalized here.
 *
 * Failure finalization is intentionally NOT guessed:
 * retryable vs final failure remains the bounded retry-policy
 * concern.
 *
 * Safety boundaries:
 *
 * - workflow execution must complete first;
 * - only a tiny whitelisted success summary reaches the durable
 *   final-result ledger;
 * - JobContext responses, input, password, phone, passport,
 *   cookies, OTP, document URLs, PDF buffers, and raw target
 *   payloads are never forwarded into final-result data;
 * - FinalResultService remains responsible for durable capture,
 *   Portal acknowledgement, terminal job transition, and
 *   terminal-only IP release;
 * - if Portal delivery is unavailable or uncertain, the error
 *   propagates and the job/IP are not falsely treated as
 *   completed here;
 * - no automatic replay is performed here.
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

    const executionResult =
      await this.executionWorker
        .run({
          jobId:
            normalizedJobId,

          input,

          signal,
        });

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

      jobId:
        normalizedJobId,

      workflow: {
        ...data,
      },

      finalization,
    });
  }
}