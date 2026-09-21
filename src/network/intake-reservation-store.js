import {
  randomUUID,
} from 'node:crypto';

import {
  JobConflictError,
  JobNotFoundError,
  ProxyUnavailableError,
} from '../core/errors.js';

import {
  isTerminalJobState,
} from '../jobs/job-state.js';

function mapReservation(row) {
  if (!row) {
    return null;
  }

  return {
    reservationId: row.id,
    proxyId: row.proxy_id,
    ip: row.ip,
    port: row.port,
    status: row.status,
    jobId: row.job_id,
    reservedAt: row.reserved_at,
    consumedAt: row.consumed_at,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAllocation(row) {
  if (!row) {
    return null;
  }

  return {
    allocationId: row.id,
    jobId: row.job_id,
    userId: row.user_id,
    proxyId: row.proxy_id,
    ip: row.ip,
    port: row.port,
    status: row.status,
    allocatedAt: row.allocated_at,
    activatedAt: row.activated_at,
    lastHeartbeat: row.last_heartbeat,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
    failureCount: row.failure_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class IntakeReservationStore {
  constructor(database) {
    this.database = database;

    this.statements = {
      countExecutionSlots: database.prepare(`
        SELECT
          (
            SELECT COUNT(*)
            FROM ip_allocations
            WHERE status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
          )
          +
          (
            SELECT COUNT(*)
            FROM portal_intake_reservations
            WHERE status = 'RESERVED'
          )
          AS count
      `),

      selectAvailableProxy: database.prepare(`
        SELECT *
        FROM proxies
        WHERE
          enabled = 1
          AND status = 'AVAILABLE'
          AND last_health_ok = 1
        ORDER BY
          failure_count ASC,
          success_count DESC,
          id ASC
        LIMIT 1
      `),

      reserveProxy: database.prepare(`
        UPDATE proxies
        SET
          status = 'RESERVED',
          updated_at = @now
        WHERE
          id = @proxyId
          AND enabled = 1
          AND status = 'AVAILABLE'
          AND last_health_ok = 1
      `),

      insertReservation: database.prepare(`
        INSERT INTO portal_intake_reservations (
          id,
          proxy_id,
          ip,
          port,
          status,
          job_id,
          reserved_at,
          consumed_at,
          released_at,
          release_reason,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @proxyId,
          @ip,
          @port,
          'RESERVED',
          NULL,
          @now,
          NULL,
          NULL,
          NULL,
          @now,
          @now
        )
      `),

      getReservation: database.prepare(`
        SELECT *
        FROM portal_intake_reservations
        WHERE id = ?
      `),

      getJob: database.prepare(`
        SELECT
          id,
          user_id,
          state
        FROM jobs
        WHERE id = ?
      `),

      getLiveAllocationForJob: database.prepare(`
        SELECT *
        FROM ip_allocations
        WHERE
          job_id = ?
          AND status IN (
            'RESERVED',
            'ACTIVE',
            'RETRY_RESERVED',
            'RELEASING'
          )
        LIMIT 1
      `),

      insertAllocation: database.prepare(`
        INSERT INTO ip_allocations (
          id,
          job_id,
          user_id,
          proxy_id,
          ip,
          port,
          status,
          allocated_at,
          activated_at,
          last_heartbeat,
          released_at,
          release_reason,
          failure_count,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @jobId,
          @userId,
          @proxyId,
          @ip,
          @port,
          'RESERVED',
          @now,
          NULL,
          @now,
          NULL,
          NULL,
          0,
          @now,
          @now
        )
      `),

      consumeReservation: database.prepare(`
        UPDATE portal_intake_reservations
        SET
          status = 'CONSUMED',
          job_id = @jobId,
          consumed_at = @now,
          updated_at = @now
        WHERE
          id = @reservationId
          AND status = 'RESERVED'
      `),

      getAllocation: database.prepare(`
        SELECT *
        FROM ip_allocations
        WHERE id = ?
      `),

      getProxy: database.prepare(`
        SELECT *
        FROM proxies
        WHERE id = ?
      `),

      releaseReservation: database.prepare(`
        UPDATE portal_intake_reservations
        SET
          status = 'RELEASED',
          released_at = @now,
          release_reason = @releaseReason,
          updated_at = @now
        WHERE
          id = @reservationId
          AND status = 'RESERVED'
      `),

      releaseProxy: database.prepare(`
        UPDATE proxies
        SET
          status = @status,
          updated_at = @now
        WHERE
          id = @proxyId
          AND status = 'RESERVED'
      `),

      countReserved: database.prepare(`
        SELECT COUNT(*) AS count
        FROM portal_intake_reservations
        WHERE status = 'RESERVED'
      `),
    };

    this.reserveTransaction =
      database.transaction(
        ({
          maxConcurrent,
          now,
        }) => {
          const occupied =
            this.statements
              .countExecutionSlots
              .get()
              .count;

          if (occupied >= maxConcurrent) {
            return null;
          }

          const proxy =
            this.statements
              .selectAvailableProxy
              .get();

          if (!proxy) {
            return null;
          }

          const reserved =
            this.statements
              .reserveProxy
              .run({
                proxyId: proxy.id,
                now,
              });

          if (reserved.changes !== 1) {
            return null;
          }

          const reservationId =
            randomUUID();

          this.statements
            .insertReservation
            .run({
              id: reservationId,
              proxyId: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              now,
            });

          return mapReservation(
            this.statements
              .getReservation
              .get(reservationId),
          );
        },
      );

    this.bindTransaction =
      database.transaction(
        ({
          reservationId,
          jobId,
          userId,
          now,
        }) => {
          const reservation =
            this.statements
              .getReservation
              .get(reservationId);

          if (
            !reservation
            || reservation.status !== 'RESERVED'
          ) {
            throw new ProxyUnavailableError(
              'Portal intake reservation is not available.',
              {
                retryable: false,
              },
            );
          }

          const job =
            this.statements
              .getJob
              .get(jobId);

          if (!job) {
            throw new JobNotFoundError(jobId);
          }

          if (isTerminalJobState(job.state)) {
            throw new JobConflictError(
              `Terminal job ${jobId} cannot consume an intake reservation.`,
              {
                retryable: false,
              },
            );
          }

          const existingAllocation =
            this.statements
              .getLiveAllocationForJob
              .get(jobId);

          if (existingAllocation) {
            throw new JobConflictError(
              `Job ${jobId} already owns a live IP allocation.`,
              {
                retryable: false,
              },
            );
          }

          const allocationId =
            randomUUID();

          this.statements
            .insertAllocation
            .run({
              id: allocationId,
              jobId,

              userId:
                userId
                ?? job.user_id
                ?? null,

              proxyId:
                reservation.proxy_id,

              ip:
                reservation.ip,

              port:
                reservation.port,

              now,
            });

          const consumed =
            this.statements
              .consumeReservation
              .run({
                reservationId,
                jobId,
                now,
              });

          if (consumed.changes !== 1) {
            throw new JobConflictError(
              'Portal intake reservation changed before it could be consumed.',
            );
          }

          return mapAllocation(
            this.statements
              .getAllocation
              .get(allocationId),
          );
        },
      );

    this.releaseTransaction =
      database.transaction(
        ({
          reservationId,
          releaseReason,
          now,
        }) => {
          const reservation =
            this.statements
              .getReservation
              .get(reservationId);

          if (!reservation) {
            throw new ProxyUnavailableError(
              'Portal intake reservation does not exist.',
              {
                retryable: false,
              },
            );
          }

          if (reservation.status === 'RELEASED') {
            return {
              released: false,
              reservation:
                mapReservation(reservation),
            };
          }

          if (reservation.status === 'CONSUMED') {
            throw new JobConflictError(
              'Consumed intake reservation cannot be released directly.',
              {
                retryable: false,
              },
            );
          }

          const proxy =
            this.statements
              .getProxy
              .get(reservation.proxy_id);

          if (!proxy) {
            throw new ProxyUnavailableError(
              `Reserved proxy ${reservation.proxy_id} no longer exists.`,
              {
                retryable: false,
              },
            );
          }

          let nextStatus;

          if (!proxy.enabled) {
            nextStatus = 'DISABLED';
          } else if (proxy.last_health_ok) {
            nextStatus = 'AVAILABLE';
          } else {
            nextStatus = 'COOLDOWN';
          }

          this.statements
            .releaseReservation
            .run({
              reservationId,
              releaseReason,
              now,
            });

          this.statements
            .releaseProxy
            .run({
              proxyId:
                reservation.proxy_id,
              status:
                nextStatus,
              now,
            });

          return {
            released: true,

            reservation:
              mapReservation(
                this.statements
                  .getReservation
                  .get(reservationId),
              ),
          };
        },
      );
  }

  reserveOne({
    maxConcurrent,
  }) {
    if (
      !Number.isInteger(maxConcurrent)
      || maxConcurrent < 1
    ) {
      throw new TypeError(
        'maxConcurrent must be a positive integer.',
      );
    }

    return this.reserveTransaction.immediate({
      maxConcurrent,
      now: new Date().toISOString(),
    });
  }

  bindToJob(
    reservationId,
    {
      jobId,
      userId = null,
    },
  ) {
    return this.bindTransaction.immediate({
      reservationId,
      jobId,
      userId,
      now: new Date().toISOString(),
    });
  }

  release(
    reservationId,
    {
      reason,
    },
  ) {
    if (
      typeof reason !== 'string'
      || reason.trim() === ''
    ) {
      throw new TypeError(
        'Reservation release reason is required.',
      );
    }

    return this.releaseTransaction.immediate({
      reservationId,
      releaseReason: reason.trim(),
      now: new Date().toISOString(),
    });
  }

  getReservation(reservationId) {
    return mapReservation(
      this.statements
        .getReservation
        .get(reservationId),
    );
  }

  countReserved() {
    return this.statements
      .countReserved
      .get()
      .count;
  }
}