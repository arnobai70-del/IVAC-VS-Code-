import {
  randomUUID,
} from 'node:crypto';

import {
  JobNotFoundError,
} from '../core/errors.js';

import {
  FinalResultConflictError,
  PortalResultDeliveryUncertainError,
} from './final-result-errors.js';

export const FINAL_RESULT_DELIVERY_STATUSES =
  Object.freeze({
    PENDING:
      'PENDING',

    IN_FLIGHT:
      'IN_FLIGHT',

    DELIVERED:
      'DELIVERED',

    UNCERTAIN:
      'UNCERTAIN',
  });

const DELIVERY_CERTAINTIES =
  new Set([
    'NOT_SENT',
    'REJECTED',
    'UNCERTAIN',
  ]);

function mapFinalResult(row) {
  if (!row) {
    return null;
  }

  return {
    id:
      row.id,

    jobId:
      row.job_id,

    applicationId:
      row.application_id,

    outcome:
      row.outcome,

    terminalState:
      row.terminal_state,

    code:
      row.result_code,

    message:
      row.result_message,

    data:
      JSON.parse(
        row.result_data_json,
      ),

    canonicalPayload:
      row.canonical_payload,

    payloadHash:
      row.payload_hash,

    idempotencyKey:
      row.idempotency_key,

    deliveryStatus:
      row.delivery_status,

    deliveryAttempts:
      row.delivery_attempts,

    lastAttemptAt:
      row.last_attempt_at,

    deliveredAt:
      row.delivered_at,

    lastErrorCode:
      row.last_error_code,

    lastErrorMessage:
      row.last_error_message,

    lastErrorRetryable:
      row.last_error_retryable
      === null
        ? null
        : Boolean(
            row.last_error_retryable,
          ),

    lastDeliveryCertainty:
      row.last_delivery_certainty,

    lastHttpStatus:
      row.last_http_status,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

function safeErrorText(error) {
  const rawCode =
    String(
      error?.code
      ?? 'UNKNOWN_ERROR',
    );

  const safeCode =
    rawCode
      .replace(
        /[^A-Z0-9_-]/gi,
        '_',
      )
      .slice(
        0,
        100,
      );

  return (
    `Portal final-result delivery failed (${safeCode}).`
  );
}

export class FinalResultStore {
  constructor(database) {
    this.database =
      database;

    this.statements = {
      getJob:
        database.prepare(`
          SELECT
            id,
            application_id
          FROM jobs
          WHERE id = ?
        `),

      getByJobId:
        database.prepare(`
          SELECT *
          FROM final_results
          WHERE job_id = ?
        `),

      insert:
        database.prepare(`
          INSERT INTO final_results (
            id,
            job_id,
            application_id,
            outcome,
            terminal_state,
            result_code,
            result_message,
            result_data_json,
            canonical_payload,
            payload_hash,
            idempotency_key,
            delivery_status,
            delivery_attempts,
            last_attempt_at,
            delivered_at,
            last_error_code,
            last_error_message,
            last_error_retryable,
            last_delivery_certainty,
            last_http_status,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @jobId,
            @applicationId,
            @outcome,
            @terminalState,
            @code,
            @message,
            @dataJson,
            @canonicalPayload,
            @payloadHash,
            @idempotencyKey,
            'PENDING',
            0,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            @now,
            @now
          )
        `),

      beginDelivery:
        database.prepare(`
          UPDATE final_results
          SET
            delivery_status = 'IN_FLIGHT',
            delivery_attempts =
              delivery_attempts + 1,
            last_attempt_at = @now,
            last_error_code = NULL,
            last_error_message = NULL,
            last_error_retryable = NULL,
            last_delivery_certainty = NULL,
            updated_at = @now
          WHERE
            job_id = @jobId
            AND delivery_status = 'PENDING'
        `),

      markPending:
        database.prepare(`
          UPDATE final_results
          SET
            delivery_status = 'PENDING',
            last_error_code = @errorCode,
            last_error_message = @errorMessage,
            last_error_retryable = @errorRetryable,
            last_delivery_certainty = @deliveryCertainty,
            updated_at = @now
          WHERE
            job_id = @jobId
            AND delivery_status = 'IN_FLIGHT'
        `),

      markUncertain:
        database.prepare(`
          UPDATE final_results
          SET
            delivery_status = 'UNCERTAIN',
            last_error_code = @errorCode,
            last_error_message = @errorMessage,
            last_error_retryable = @errorRetryable,
            last_delivery_certainty = 'UNCERTAIN',
            updated_at = @now
          WHERE
            job_id = @jobId
            AND delivery_status = 'IN_FLIGHT'
        `),

      requeueUncertain:
        database.prepare(`
          UPDATE final_results
          SET
            delivery_status = 'PENDING',
            updated_at = @now
          WHERE
            job_id = @jobId
            AND delivery_status = 'UNCERTAIN'
        `),

      markDelivered:
        database.prepare(`
          UPDATE final_results
          SET
            delivery_status = 'DELIVERED',
            delivered_at = COALESCE(
              delivered_at,
              @now
            ),
            last_error_code = NULL,
            last_error_message = NULL,
            last_error_retryable = NULL,
            last_delivery_certainty = NULL,
            last_http_status = @httpStatus,
            updated_at = @now
          WHERE
            job_id = @jobId
            AND delivery_status = 'IN_FLIGHT'
        `),
    };

    this.createOrGetTransaction =
      database.transaction(
        ({
          result,
          resultId,
          now,
        }) => {
          const job =
            this.statements
              .getJob
              .get(
                result.jobId,
              );

          if (!job) {
            throw new JobNotFoundError(
              result.jobId,
            );
          }

          if (
            job.application_id
            !== result.applicationId
          ) {
            throw new FinalResultConflictError(
              'Final result applicationId does not match the durable job.',
            );
          }

          const existing =
            this.statements
              .getByJobId
              .get(
                result.jobId,
              );

          if (existing) {
            if (
              existing.payload_hash
                !== result.payloadHash
              || existing.terminal_state
                !== result.terminalState
            ) {
              throw new FinalResultConflictError(
                `Job ${result.jobId} already has a different final result.`,
              );
            }

            return {
              created:
                false,

              record:
                mapFinalResult(
                  existing,
                ),
            };
          }

          this.statements
            .insert
            .run({
              id:
                resultId,

              jobId:
                result.jobId,

              applicationId:
                result.applicationId,

              outcome:
                result.outcome,

              terminalState:
                result.terminalState,

              code:
                result.code,

              message:
                result.message,

              dataJson:
                JSON.stringify(
                  result.data,
                ),

              canonicalPayload:
                result.canonicalPayload,

              payloadHash:
                result.payloadHash,

              idempotencyKey:
                result.idempotencyKey,

              now,
            });

          return {
            created:
              true,

            record:
              mapFinalResult(
                this.statements
                  .getByJobId
                  .get(
                    result.jobId,
                  ),
              ),
          };
        },
      );

    this.beginDeliveryTransaction =
      database.transaction(
        ({
          jobId,
          now,
        }) => {
          const current =
            this.statements
              .getByJobId
              .get(
                jobId,
              );

          if (!current) {
            throw new FinalResultConflictError(
              `Job ${jobId} has no durable final result.`,
            );
          }

          if (
            current.delivery_status
            === FINAL_RESULT_DELIVERY_STATUSES
              .DELIVERED
          ) {
            return {
              started:
                false,

              record:
                mapFinalResult(
                  current,
                ),
            };
          }

          if (
            current.delivery_status
            === FINAL_RESULT_DELIVERY_STATUSES
              .UNCERTAIN
          ) {
            throw new PortalResultDeliveryUncertainError(
              `Portal delivery for job ${jobId} is uncertain.`,
            );
          }

          if (
            current.delivery_status
            === FINAL_RESULT_DELIVERY_STATUSES
              .IN_FLIGHT
          ) {
            throw new FinalResultConflictError(
              `Portal delivery for job ${jobId} is already in flight.`,
              {
                retryable:
                  true,
              },
            );
          }

          const updated =
            this.statements
              .beginDelivery
              .run({
                jobId,
                now,
              });

          if (
            updated.changes
            !== 1
          ) {
            throw new FinalResultConflictError(
              `Concurrent final-result delivery detected for job ${jobId}.`,
              {
                retryable:
                  true,
              },
            );
          }

          return {
            started:
              true,

            record:
              mapFinalResult(
                this.statements
                  .getByJobId
                  .get(
                    jobId,
                  ),
              ),
          };
        },
      );
  }

  createOrGet(result) {
    return this
      .createOrGetTransaction
      .immediate({
        result,

        resultId:
          randomUUID(),

        now:
          new Date()
            .toISOString(),
      });
  }

  getByJobId(jobId) {
    return mapFinalResult(
      this.statements
        .getByJobId
        .get(
          jobId,
        ),
    );
  }

  beginDelivery(jobId) {
    return this
      .beginDeliveryTransaction
      .immediate({
        jobId,

        now:
          new Date()
            .toISOString(),
      });
  }

  markPendingAfterFailure(
    jobId,
    error,
    {
      deliveryCertainty,
    },
  ) {
    if (
      !DELIVERY_CERTAINTIES
        .has(
          deliveryCertainty,
        )
    ) {
      throw new TypeError(
        'deliveryCertainty is invalid.',
      );
    }

    const result =
      this.statements
        .markPending
        .run({
          jobId,

          errorCode:
            error?.code
            ?? 'UNKNOWN_ERROR',

          errorMessage:
            safeErrorText(
              error,
            ),

          errorRetryable:
            error?.retryable
              ? 1
              : 0,

          deliveryCertainty,

          now:
            new Date()
              .toISOString(),
        });

    if (
      result.changes
      !== 1
    ) {
      throw new FinalResultConflictError(
        `Cannot return final-result delivery to pending for job ${jobId}.`,
      );
    }

    return this.getByJobId(
      jobId,
    );
  }

  markUncertain(
    jobId,
    error,
  ) {
    const result =
      this.statements
        .markUncertain
        .run({
          jobId,

          errorCode:
            error?.code
            ?? 'UNKNOWN_ERROR',

          errorMessage:
            safeErrorText(
              error,
            ),

          errorRetryable:
            error?.retryable
              ? 1
              : 0,

          now:
            new Date()
              .toISOString(),
        });

    if (
      result.changes
      !== 1
    ) {
      throw new FinalResultConflictError(
        `Cannot mark final-result delivery uncertain for job ${jobId}.`,
      );
    }

    return this.getByJobId(
      jobId,
    );
  }

  requeueUncertain(jobId) {
    const result =
      this.statements
        .requeueUncertain
        .run({
          jobId,

          now:
            new Date()
              .toISOString(),
        });

    if (
      result.changes
      !== 1
    ) {
      throw new FinalResultConflictError(
        `Cannot requeue uncertain final-result delivery for job ${jobId}.`,
      );
    }

    return this.getByJobId(
      jobId,
    );
  }

  markDelivered(
    jobId,
    {
      httpStatus = null,
    } = {},
  ) {
    if (
      httpStatus !== null
      && (
        !Number.isInteger(
          httpStatus,
        )
        || httpStatus < 100
        || httpStatus > 599
      )
    ) {
      throw new TypeError(
        'httpStatus must be null or a valid HTTP status code.',
      );
    }

    const result =
      this.statements
        .markDelivered
        .run({
          jobId,

          httpStatus,

          now:
            new Date()
              .toISOString(),
        });

    if (
      result.changes
      !== 1
    ) {
      throw new FinalResultConflictError(
        `Cannot mark final-result delivery complete for job ${jobId}.`,
      );
    }

    return this.getByJobId(
      jobId,
    );
  }
}