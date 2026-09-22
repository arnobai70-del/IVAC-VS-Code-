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

function requireArray(
  value,
  name,
) {
  if (
    !Array.isArray(
      value,
    )
  ) {
    throw new TypeError(
      `${name} must be an array.`,
    );
  }

  return value;
}

function safeErrorCode(
  error,
) {
  const raw =
    String(
      error?.code
      ?? 'UNKNOWN_ERROR',
    );

  return raw
    .replace(
      /[^A-Z0-9_-]/gi,
      '_',
    )
    .slice(
      0,
      100,
    );
}

/*
 * Restart-time final-result recovery orchestration.
 *
 * RecoveryService classifies and repairs durable restart state.
 * This runner is deliberately separate from workflow execution
 * and workflow retry.
 *
 * It only re-enters FinalResultService.resumeDelivery() for an
 * already-durable final result.
 *
 * Safety boundaries:
 *
 * - no workflow step is replayed;
 * - no execution retry budget is consumed;
 * - no result payload is reconstructed;
 * - no Portal contract is invented;
 * - unconfigured Portal result delivery stays blocked;
 * - UNCERTAIN delivery is never replayed unless verified remote
 *   idempotency is explicitly declared;
 * - per-job delivery failure does not cause another job's durable
 *   recovery classification to be lost.
 */
export class FinalResultRecoveryRunner {
  constructor({
    finalResultService,
    portalResultClient,
  }) {
    requireObject(
      finalResultService,
      'finalResultService',
    );

    requireFunction(
      finalResultService.resumeDelivery,
      'finalResultService.resumeDelivery',
    );

    requireObject(
      portalResultClient,
      'portalResultClient',
    );

    requireFunction(
      portalResultClient.isConfigured,
      'portalResultClient.isConfigured',
    );

    requireFunction(
      portalResultClient.supportsIdempotentReplay,
      'portalResultClient.supportsIdempotentReplay',
    );

    this.finalResultService =
      finalResultService;

    this.portalResultClient =
      portalResultClient;
  }

  canAttempt(
    recoveryResult,
  ) {
    requireObject(
      recoveryResult,
      'recoveryResult',
    );

    if (
      !this.portalResultClient
        .isConfigured()
    ) {
      return {
        allowed:
          false,

        reason:
          'PORTAL_RESULT_CONTRACT_NOT_CONFIGURED',
      };
    }

    if (
      recoveryResult.action
      === 'FINAL_RESULT_PENDING'
    ) {
      return {
        allowed:
          true,

        reason:
          null,
      };
    }

    if (
      recoveryResult.action
      === 'FINAL_RESULT_UNCERTAIN'
    ) {
      if (
        !this.portalResultClient
          .supportsIdempotentReplay()
      ) {
        return {
          allowed:
            false,

          reason:
            'REMOTE_IDEMPOTENT_REPLAY_UNVERIFIED',
        };
      }

      return {
        allowed:
          true,

        reason:
          null,
      };
    }

    return {
      allowed:
        false,

      reason:
        'RECOVERY_ACTION_NOT_DELIVERABLE',
    };
  }

  async runOne(
    recoveryResult,
  ) {
    requireObject(
      recoveryResult,
      'recoveryResult',
    );

    const jobId =
      recoveryResult.jobId;

    if (
      typeof jobId !== 'string'
      || jobId.trim() === ''
    ) {
      throw new TypeError(
        'recoveryResult.jobId must be a non-empty string.',
      );
    }

    const decision =
      this.canAttempt(
        recoveryResult,
      );

    if (
      !decision.allowed
    ) {
      return Object.freeze({
        jobId:
          jobId.trim(),

        recoveryAction:
          recoveryResult.action
          ?? null,

        status:
          'SKIPPED',

        reason:
          decision.reason,
      });
    }

    try {
      const finalization =
        await this.finalResultService
          .resumeDelivery(
            jobId.trim(),
          );

      return Object.freeze({
        jobId:
          jobId.trim(),

        recoveryAction:
          recoveryResult.action,

        status:
          'DELIVERED',

        reason:
          null,

        terminalState:
          finalization
            ?.job
            ?.state
          ?? null,

        deliveryStatus:
          finalization
            ?.result
            ?.deliveryStatus
          ?? null,
      });
    } catch (error) {
      return Object.freeze({
        jobId:
          jobId.trim(),

        recoveryAction:
          recoveryResult.action,

        status:
          'FAILED',

        reason:
          safeErrorCode(
            error,
          ),
      });
    }
  }

  async run(
    recoveryResults,
  ) {
    requireArray(
      recoveryResults,
      'recoveryResults',
    );

    const results = [];

    for (
      const recoveryResult
      of recoveryResults
    ) {
      results.push(
        await this.runOne(
          recoveryResult,
        ),
      );
    }

    return results;
  }
}