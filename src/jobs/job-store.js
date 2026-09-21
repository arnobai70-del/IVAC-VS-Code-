import {
  randomUUID,
} from 'node:crypto';

import {
  JobConflictError,
  JobNotFoundError,
} from '../core/errors.js';

import {
  assertJobTransition,
  isTerminalJobState,
  JOB_STATES,
} from './job-state.js';

function mapJob(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    applicationId: row.application_id,
    userId: row.user_id,
    state: row.state,
    currentStep: row.current_step,
    retryCount: row.retry_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastActivityAt: row.last_activity_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClaim(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    applicationId: row.application_id,
    jobId: row.job_id,
    status: row.status,
    claimedAt: row.claimed_at,
    releasedAt: row.released_at,
  };
}

export class JobStore {
  constructor(database) {
    this.database = database;

    this.statements = {
      getById: database.prepare(`
        SELECT *
        FROM jobs
        WHERE id = ?
      `),

      getByApplicationId: database.prepare(`
        SELECT *
        FROM jobs
        WHERE application_id = ?
      `),

      insertJob: database.prepare(`
        INSERT INTO jobs (
          id,
          application_id,
          user_id,
          state,
          current_step,
          retry_count,
          started_at,
          completed_at,
          last_activity_at,
          failure_code,
          failure_message,
          version,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @applicationId,
          @userId,
          @state,
          NULL,
          0,
          NULL,
          NULL,
          @now,
          NULL,
          NULL,
          1,
          @now,
          @now
        )
      `),

      insertClaim: database.prepare(`
        INSERT INTO claims (
          id,
          application_id,
          job_id,
          status,
          claimed_at,
          released_at
        )
        VALUES (
          @id,
          @applicationId,
          @jobId,
          'ACTIVE',
          @now,
          NULL
        )
      `),

      getClaimByJobId: database.prepare(`
        SELECT *
        FROM claims
        WHERE job_id = ?
      `),

      updateJobState: database.prepare(`
        UPDATE jobs
        SET
          state = @state,
          current_step = @currentStep,
          started_at = @startedAt,
          completed_at = @completedAt,
          last_activity_at = @now,
          failure_code = @failureCode,
          failure_message = @failureMessage,
          version = version + 1,
          updated_at = @now
        WHERE
          id = @id
          AND version = @expectedVersion
      `),

      releaseClaim: database.prepare(`
        UPDATE claims
        SET
          status = 'RELEASED',
          released_at = COALESCE(
            released_at,
            @releasedAt
          )
        WHERE
          job_id = @jobId
          AND status = 'ACTIVE'
      `),

      incrementRetry: database.prepare(`
        UPDATE jobs
        SET
          retry_count = retry_count + 1,
          last_activity_at = @now,
          version = version + 1,
          updated_at = @now
        WHERE
          id = @id
          AND version = @expectedVersion
      `),

      listIncomplete: database.prepare(`
        SELECT *
        FROM jobs
        WHERE state NOT IN (
          'COMPLETED',
          'FAILED_FINAL',
          'CANCELLED'
        )
        ORDER BY created_at, id
      `),
    };

    this.createTransaction = database.transaction(
      ({
        applicationId,
        userId,
        jobId,
        claimId,
        now,
      }) => {
        const existing =
          this.statements
            .getByApplicationId
            .get(applicationId);

        if (existing) {
          return {
            created: false,
            job: mapJob(existing),
          };
        }

        this.statements.insertJob.run({
          id: jobId,
          applicationId,
          userId,
          state: JOB_STATES.PENDING,
          now,
        });

        this.statements.insertClaim.run({
          id: claimId,
          applicationId,
          jobId,
          now,
        });

        return {
          created: true,
          job: mapJob(
            this.statements.getById.get(jobId),
          ),
        };
      },
    );

    this.transitionTransaction =
      database.transaction(
        ({
          jobId,
          toState,
          currentStep,
          failureCode,
          failureMessage,
          expectedVersion,
          now,
        }) => {
          const currentRow =
            this.statements.getById.get(jobId);

          if (!currentRow) {
            throw new JobNotFoundError(jobId);
          }

          const current = mapJob(currentRow);

          if (
            expectedVersion !== undefined
            && current.version !== expectedVersion
          ) {
            throw new JobConflictError(
              `Job version conflict for ${jobId}.`,
            );
          }

          assertJobTransition(
            current.state,
            toState,
          );

          const startedAt =
            current.startedAt
            ?? (
              toState === JOB_STATES.RUNNING
                ? now
                : null
            );

          const completedAt =
            isTerminalJobState(toState)
              ? now
              : current.completedAt;

          const result =
            this.statements.updateJobState.run({
              id: jobId,
              state: toState,

              currentStep:
                currentStep
                ?? current.currentStep,

              startedAt,
              completedAt,

              failureCode:
                failureCode
                ?? current.failureCode,

              failureMessage:
                failureMessage
                ?? current.failureMessage,

              expectedVersion: current.version,
              now,
            });

          if (result.changes !== 1) {
            throw new JobConflictError(
              `Concurrent job update detected for ${jobId}.`,
            );
          }

          if (isTerminalJobState(toState)) {
            this.statements.releaseClaim.run({
              jobId,
              releasedAt: now,
            });
          }

          return mapJob(
            this.statements.getById.get(jobId),
          );
        },
      );

    this.incrementRetryTransaction =
      database.transaction(
        ({
          jobId,
          expectedVersion,
          now,
        }) => {
          const currentRow =
            this.statements.getById.get(jobId);

          if (!currentRow) {
            throw new JobNotFoundError(jobId);
          }

          const current = mapJob(currentRow);

          if (
            expectedVersion !== undefined
            && current.version !== expectedVersion
          ) {
            throw new JobConflictError(
              `Job version conflict for ${jobId}.`,
            );
          }

          if (isTerminalJobState(current.state)) {
            throw new JobConflictError(
              `Cannot increment retry count for terminal job ${jobId}.`,
              {
                retryable: false,
              },
            );
          }

          const result =
            this.statements.incrementRetry.run({
              id: jobId,
              expectedVersion: current.version,
              now,
            });

          if (result.changes !== 1) {
            throw new JobConflictError(
              `Concurrent job update detected for ${jobId}.`,
            );
          }

          return mapJob(
            this.statements.getById.get(jobId),
          );
        },
      );
  }

  createOrGetJob({
    applicationId,
    userId = null,
  }) {
    if (
      typeof applicationId !== 'string'
      || applicationId.trim() === ''
    ) {
      throw new TypeError(
        'applicationId must be a non-empty string.',
      );
    }

    const normalizedApplicationId =
      applicationId.trim();

    return this.createTransaction({
      applicationId: normalizedApplicationId,

      userId:
        typeof userId === 'string'
          ? userId.trim() || null
          : null,

      jobId: randomUUID(),
      claimId: randomUUID(),
      now: new Date().toISOString(),
    });
  }

  getJobById(jobId) {
    return mapJob(
      this.statements.getById.get(jobId),
    );
  }

  getJobByApplicationId(applicationId) {
    return mapJob(
      this.statements
        .getByApplicationId
        .get(applicationId),
    );
  }

  getClaimByJobId(jobId) {
    return mapClaim(
      this.statements
        .getClaimByJobId
        .get(jobId),
    );
  }

  transitionJob(
    jobId,
    toState,
    {
      currentStep,
      failureCode,
      failureMessage,
      expectedVersion,
    } = {},
  ) {
    return this.transitionTransaction({
      jobId,
      toState,
      currentStep,
      failureCode,
      failureMessage,
      expectedVersion,
      now: new Date().toISOString(),
    });
  }

  incrementRetry(
    jobId,
    {
      expectedVersion,
    } = {},
  ) {
    return this.incrementRetryTransaction({
      jobId,
      expectedVersion,
      now: new Date().toISOString(),
    });
  }

  listIncompleteJobs() {
    return this.statements
      .listIncomplete
      .all()
      .map(mapJob);
  }
}