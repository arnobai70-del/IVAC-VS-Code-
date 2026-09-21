import {
  JobNotFoundError,
} from '../core/errors.js';

export const RECOVERY_STATUSES =
  Object.freeze({
    NONE:
      'NONE',

    RETRY_SCHEDULED:
      'RETRY_SCHEDULED',

    BLOCKED_SESSION_LOSS:
      'BLOCKED_SESSION_LOSS',

    BLOCKED_UNSAFE_REPLAY:
      'BLOCKED_UNSAFE_REPLAY',

    RETRY_EXHAUSTED:
      'RETRY_EXHAUSTED',

    WAITING_MANUAL:
      'WAITING_MANUAL',

    FINAL_RESULT_PENDING:
      'FINAL_RESULT_PENDING',

    FINAL_RESULT_UNCERTAIN:
      'FINAL_RESULT_UNCERTAIN',

    FINAL_RESULT_DELIVERED:
      'FINAL_RESULT_DELIVERED',
  });

const VALID_STATUSES =
  new Set(
    Object.values(
      RECOVERY_STATUSES,
    ),
  );

function mapRecovery(
  row,
) {
  if (!row) {
    return null;
  }

  return {
    jobId:
      row.job_id,

    restartCount:
      row.restart_count,

    recoveryStatus:
      row.recovery_status,

    sessionLost:
      Boolean(
        row.session_lost,
      ),

    lastObservedState:
      row.last_observed_state,

    lastObservedStep:
      row.last_observed_step,

    lastReasonCode:
      row.last_reason_code,

    nextRetryAt:
      row.next_retry_at,

    lastRecoveryBootId:
      row.last_recovery_boot_id,

    lastRecoveredAt:
      row.last_recovered_at,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

function normalizeNullableString(
  value,
  name,
) {
  if (
    value === undefined
    || value === null
  ) {
    return null;
  }

  if (
    typeof value !== 'string'
  ) {
    throw new TypeError(
      `${name} must be a string or null.`,
    );
  }

  const normalized =
    value.trim();

  return normalized || null;
}

function normalizeReasonCode(
  value,
) {
  const normalized =
    normalizeNullableString(
      value,
      'reasonCode',
    );

  if (!normalized) {
    return null;
  }

  return normalized
    .toUpperCase()
    .replace(
      /[^A-Z0-9_-]/g,
      '_',
    )
    .slice(
      0,
      100,
    );
}

function assertStatus(
  status,
) {
  if (
    !VALID_STATUSES.has(
      status,
    )
  ) {
    throw new TypeError(
      `Unsupported recovery status: ${status}`,
    );
  }
}

function assertIsoDateOrNull(
  value,
  name,
) {
  if (
    value === undefined
    || value === null
  ) {
    return null;
  }

  if (
    typeof value !== 'string'
    || Number.isNaN(
      Date.parse(
        value,
      ),
    )
  ) {
    throw new TypeError(
      `${name} must be a valid ISO date string or null.`,
    );
  }

  return value;
}

export class RecoveryStore {
  constructor(
    database,
  ) {
    this.database =
      database;

    this.statements = {
      getJob:
        database.prepare(`
          SELECT
            id
          FROM jobs
          WHERE id = ?
        `),

      getByJobId:
        database.prepare(`
          SELECT *
          FROM job_recovery
          WHERE job_id = ?
        `),

      insert:
        database.prepare(`
          INSERT INTO job_recovery (
            job_id,
            restart_count,
            recovery_status,
            session_lost,
            last_observed_state,
            last_observed_step,
            last_reason_code,
            next_retry_at,
            last_recovery_boot_id,
            last_recovered_at,
            created_at,
            updated_at
          )
          VALUES (
            @jobId,
            @restartCount,
            @recoveryStatus,
            @sessionLost,
            @lastObservedState,
            @lastObservedStep,
            @lastReasonCode,
            @nextRetryAt,
            @lastRecoveryBootId,
            @lastRecoveredAt,
            @now,
            @now
          )
        `),

      update:
        database.prepare(`
          UPDATE job_recovery
          SET
            restart_count =
              @restartCount,

            recovery_status =
              @recoveryStatus,

            session_lost =
              @sessionLost,

            last_observed_state =
              @lastObservedState,

            last_observed_step =
              @lastObservedStep,

            last_reason_code =
              @lastReasonCode,

            next_retry_at =
              @nextRetryAt,

            last_recovery_boot_id =
              @lastRecoveryBootId,

            last_recovered_at =
              @lastRecoveredAt,

            updated_at =
              @now
          WHERE
            job_id = @jobId
        `),

      listByStatus:
        database.prepare(`
          SELECT *
          FROM job_recovery
          WHERE recovery_status = ?
          ORDER BY updated_at, job_id
        `),
    };

    this.recordTransaction =
      database.transaction(
        ({
          jobId,
          bootId,
          recoveryStatus,
          sessionLost,
          lastObservedState,
          lastObservedStep,
          lastReasonCode,
          nextRetryAt,
          markRecovered,
          now,
        }) => {
          const job =
            this.statements
              .getJob
              .get(
                jobId,
              );

          if (!job) {
            throw new JobNotFoundError(
              jobId,
            );
          }

          const existing =
            this.statements
              .getByJobId
              .get(
                jobId,
              );

          const isNewBoot =
            !existing
            || existing
              .last_recovery_boot_id
              !== bootId;

          const restartCount =
            existing
              ? (
                  existing
                    .restart_count
                  + (
                    isNewBoot
                      ? 1
                      : 0
                  )
                )
              : 1;

          const payload = {
            jobId,

            restartCount,

            recoveryStatus,

            sessionLost:
              sessionLost
                ? 1
                : 0,

            lastObservedState,

            lastObservedStep,

            lastReasonCode,

            nextRetryAt,

            lastRecoveryBootId:
              bootId,

            lastRecoveredAt:
              markRecovered
                ? now
                : (
                    existing
                      ?.last_recovered_at
                    ?? null
                  ),

            now,
          };

          if (existing) {
            this.statements
              .update
              .run(
                payload,
              );
          } else {
            this.statements
              .insert
              .run(
                payload,
              );
          }

          return mapRecovery(
            this.statements
              .getByJobId
              .get(
                jobId,
              ),
          );
        },
      );
  }

  getByJobId(
    jobId,
  ) {
    return mapRecovery(
      this.statements
        .getByJobId
        .get(
          jobId,
        ),
    );
  }

  recordRestart({
    jobId,
    bootId,
    recoveryStatus =
      RECOVERY_STATUSES.NONE,
    sessionLost = true,
    lastObservedState = null,
    lastObservedStep = null,
    reasonCode = null,
    nextRetryAt = null,
    markRecovered = false,
  }) {
    const normalizedJobId =
      normalizeNullableString(
        jobId,
        'jobId',
      );

    if (!normalizedJobId) {
      throw new TypeError(
        'jobId must be a non-empty string.',
      );
    }

    const normalizedBootId =
      normalizeNullableString(
        bootId,
        'bootId',
      );

    if (!normalizedBootId) {
      throw new TypeError(
        'bootId must be a non-empty string.',
      );
    }

    assertStatus(
      recoveryStatus,
    );

    if (
      typeof sessionLost
        !== 'boolean'
    ) {
      throw new TypeError(
        'sessionLost must be a boolean.',
      );
    }

    if (
      typeof markRecovered
        !== 'boolean'
    ) {
      throw new TypeError(
        'markRecovered must be a boolean.',
      );
    }

    return this
      .recordTransaction
      .immediate({
        jobId:
          normalizedJobId,

        bootId:
          normalizedBootId,

        recoveryStatus,

        sessionLost,

        lastObservedState:
          normalizeNullableString(
            lastObservedState,
            'lastObservedState',
          ),

        lastObservedStep:
          normalizeNullableString(
            lastObservedStep,
            'lastObservedStep',
          ),

        lastReasonCode:
          normalizeReasonCode(
            reasonCode,
          ),

        nextRetryAt:
          assertIsoDateOrNull(
            nextRetryAt,
            'nextRetryAt',
          ),

        markRecovered,

        now:
          new Date()
            .toISOString(),
      });
  }

  updateStatus(
    jobId,
    {
      bootId,
      recoveryStatus,
      sessionLost = false,
      lastObservedState = null,
      lastObservedStep = null,
      reasonCode = null,
      nextRetryAt = null,
      markRecovered = true,
    },
  ) {
    return this.recordRestart({
      jobId,
      bootId,
      recoveryStatus,
      sessionLost,
      lastObservedState,
      lastObservedStep,
      reasonCode,
      nextRetryAt,
      markRecovered,
    });
  }

  listByStatus(
    recoveryStatus,
  ) {
    assertStatus(
      recoveryStatus,
    );

    return this.statements
      .listByStatus
      .all(
        recoveryStatus,
      )
      .map(
        mapRecovery,
      );
  }
}