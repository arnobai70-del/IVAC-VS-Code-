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
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  ALLOCATION_STATES,
  isValidReleaseReason,
  PROXY_STATES,
  RELEASE_REASONS,
} from './proxy-state.js';

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

export class IpAllocator {
  constructor(database) {
    this.database = database;

    this.statements = {
      getJob: database.prepare(`
        SELECT
          id,
          user_id,
          state
        FROM jobs
        WHERE id = ?
      `),

      getLiveForJob: database.prepare(`
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

      getLatestReleasedForJob:
        database.prepare(`
          SELECT *
          FROM ip_allocations
          WHERE
            job_id = ?
            AND status = 'RELEASED'
          ORDER BY released_at DESC
          LIMIT 1
        `),

      getById: database.prepare(`
        SELECT *
        FROM ip_allocations
        WHERE id = ?
      `),

      selectAvailableProxy:
        database.prepare(`
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

      activateAllocation:
        database.prepare(`
          UPDATE ip_allocations
          SET
            status = 'ACTIVE',
            activated_at = COALESCE(
              activated_at,
              @now
            ),
            last_heartbeat = @now,
            updated_at = @now
          WHERE
            id = @allocationId
            AND status IN (
              'RESERVED',
              'RETRY_RESERVED'
            )
        `),

      activateProxy: database.prepare(`
        UPDATE proxies
        SET
          status = 'ACTIVE',
          updated_at = @now
        WHERE
          id = @proxyId
          AND status IN (
            'RESERVED',
            'RETRY_RESERVED'
          )
      `),

      retryAllocation:
        database.prepare(`
          UPDATE ip_allocations
          SET
            status = 'RETRY_RESERVED',
            failure_count = failure_count + 1,
            last_heartbeat = @now,
            updated_at = @now
          WHERE
            id = @allocationId
            AND status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED'
            )
        `),

      retryProxy: database.prepare(`
        UPDATE proxies
        SET
          status = 'RETRY_RESERVED',
          updated_at = @now
        WHERE
          id = @proxyId
          AND status IN (
            'RESERVED',
            'ACTIVE',
            'RETRY_RESERVED'
          )
      `),

      heartbeat: database.prepare(`
        UPDATE ip_allocations
        SET
          last_heartbeat = @now,
          updated_at = @now
        WHERE
          id = @allocationId
          AND status IN (
            'RESERVED',
            'ACTIVE',
            'RETRY_RESERVED'
          )
      `),

      beginReleaseAllocation:
        database.prepare(`
          UPDATE ip_allocations
          SET
            status = 'RELEASING',
            updated_at = @now
          WHERE
            id = @allocationId
            AND status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED'
            )
        `),

      beginReleaseProxy:
        database.prepare(`
          UPDATE proxies
          SET
            status = 'RELEASING',
            updated_at = @now
          WHERE
            id = @proxyId
            AND status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED'
            )
        `),

      finishReleaseAllocation:
        database.prepare(`
          UPDATE ip_allocations
          SET
            status = 'RELEASED',
            released_at = COALESCE(
              released_at,
              @now
            ),
            release_reason = COALESCE(
              release_reason,
              @releaseReason
            ),
            updated_at = @now
          WHERE
            id = @allocationId
            AND status = 'RELEASING'
        `),

      getProxy: database.prepare(`
        SELECT *
        FROM proxies
        WHERE id = ?
      `),

      finishReleaseProxy:
        database.prepare(`
          UPDATE proxies
          SET
            status = @status,
            updated_at = @now
          WHERE
            id = @proxyId
            AND status = 'RELEASING'
        `),

      listLive: database.prepare(`
        SELECT *
        FROM ip_allocations
        WHERE status IN (
          'RESERVED',
          'ACTIVE',
          'RETRY_RESERVED',
          'RELEASING'
        )
        ORDER BY allocated_at, id
      `),
    };

    this.acquireTransaction =
      database.transaction(
        ({
          jobId,
          userId,
          now,
        }) => {
          const job =
            this.statements.getJob.get(jobId);

          if (!job) {
            throw new JobNotFoundError(jobId);
          }

          if (isTerminalJobState(job.state)) {
            throw new JobConflictError(
              `Terminal job ${jobId} cannot acquire an IP.`,
              {
                retryable: false,
              },
            );
          }

          const existing =
            this.statements
              .getLiveForJob
              .get(jobId);

          if (existing) {
            return {
              reused: true,
              allocation:
                mapAllocation(existing),
            };
          }

          const proxy =
            this.statements
              .selectAvailableProxy
              .get();

          if (!proxy) {
            throw new ProxyUnavailableError();
          }

          const reservation =
            this.statements
              .reserveProxy
              .run({
                proxyId: proxy.id,
                now,
              });

          if (reservation.changes !== 1) {
            throw new ProxyUnavailableError(
              'Proxy reservation lost to another allocator.',
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

              proxyId: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              now,
            });

          return {
            reused: false,
            allocation:
              mapAllocation(
                this.statements
                  .getById
                  .get(allocationId),
              ),
          };
        },
      );

    this.activateTransaction =
      database.transaction(
        ({
          jobId,
          now,
        }) => {
          const allocation =
            this.statements
              .getLiveForJob
              .get(jobId);

          if (!allocation) {
            throw new ProxyUnavailableError(
              `Job ${jobId} has no live IP allocation.`,
            );
          }

          if (
            allocation.status
            === ALLOCATION_STATES.ACTIVE
          ) {
            return mapAllocation(allocation);
          }

          this.statements
            .activateAllocation
            .run({
              allocationId:
                allocation.id,
              now,
            });

          this.statements
            .activateProxy
            .run({
              proxyId:
                allocation.proxy_id,
              now,
            });

          return mapAllocation(
            this.statements
              .getById
              .get(allocation.id),
          );
        },
      );

    this.retryTransaction =
      database.transaction(
        ({
          jobId,
          now,
        }) => {
          const allocation =
            this.statements
              .getLiveForJob
              .get(jobId);

          if (!allocation) {
            throw new ProxyUnavailableError(
              `Job ${jobId} has no live IP allocation.`,
            );
          }

          this.statements.retryAllocation.run({
            allocationId: allocation.id,
            now,
          });

          this.statements.retryProxy.run({
            proxyId: allocation.proxy_id,
            now,
          });

          return mapAllocation(
            this.statements
              .getById
              .get(allocation.id),
          );
        },
      );

    this.releaseTransaction =
      database.transaction(
        ({
          jobId,
          releaseReason,
          now,
        }) => {
          const job =
            this.statements.getJob.get(jobId);

          if (!job) {
            throw new JobNotFoundError(jobId);
          }

          this.assertReleaseAllowed(
            job,
            releaseReason,
          );

          const allocation =
            this.statements
              .getLiveForJob
              .get(jobId);

          if (!allocation) {
            return {
              released: false,

              allocation:
                mapAllocation(
                  this.statements
                    .getLatestReleasedForJob
                    .get(jobId),
                ),
            };
          }

          this.statements
            .beginReleaseAllocation
            .run({
              allocationId:
                allocation.id,
              now,
            });

          this.statements
            .beginReleaseProxy
            .run({
              proxyId:
                allocation.proxy_id,
              now,
            });

          const proxy =
            this.statements
              .getProxy
              .get(allocation.proxy_id);

          if (!proxy) {
            throw new ProxyUnavailableError(
              `Allocated proxy ${allocation.proxy_id} no longer exists.`,
            );
          }

          let nextProxyState;

          if (!proxy.enabled) {
            nextProxyState =
              PROXY_STATES.DISABLED;
          } else if (proxy.last_health_ok) {
            nextProxyState =
              PROXY_STATES.AVAILABLE;
          } else {
            nextProxyState =
              PROXY_STATES.COOLDOWN;
          }

          this.statements
            .finishReleaseAllocation
            .run({
              allocationId:
                allocation.id,
              releaseReason,
              now,
            });

          this.statements
            .finishReleaseProxy
            .run({
              proxyId:
                allocation.proxy_id,
              status:
                nextProxyState,
              now,
            });

          return {
            released: true,

            allocation:
              mapAllocation(
                this.statements
                  .getById
                  .get(allocation.id),
              ),
          };
        },
      );
  }

  assertReleaseAllowed(job, reason) {
    if (!isValidReleaseReason(reason)) {
      throw new JobConflictError(
        `Unsupported IP release reason: ${reason}`,
        {
          retryable: false,
        },
      );
    }

    if (
      reason
      === RELEASE_REASONS.ADMIN_RELEASE
    ) {
      return;
    }

    if (
      reason
      === RELEASE_REASONS.JOB_EXPIRED
    ) {
      return;
    }

    const expectedState = {
      [RELEASE_REASONS.JOB_COMPLETED]:
        JOB_STATES.COMPLETED,

      [RELEASE_REASONS.JOB_CANCELLED]:
        JOB_STATES.CANCELLED,

      [RELEASE_REASONS.FAILED_FINAL]:
        JOB_STATES.FAILED_FINAL,
    }[reason];

    if (
      expectedState
      && job.state !== expectedState
    ) {
      throw new JobConflictError(
        `Cannot release IP using ${reason} while job state is ${job.state}.`,
        {
          retryable: false,
        },
      );
    }
  }

  acquireForJob({
    jobId,
    userId = null,
  }) {
    return this.acquireTransaction.immediate({
      jobId,
      userId,
      now: new Date().toISOString(),
    });
  }

  activateForJob(jobId) {
    return this.activateTransaction.immediate({
      jobId,
      now: new Date().toISOString(),
    });
  }

  markRetryReserved(jobId) {
    return this.retryTransaction.immediate({
      jobId,
      now: new Date().toISOString(),
    });
  }

  heartbeat(jobId) {
    const allocation =
      this.statements
        .getLiveForJob
        .get(jobId);

    if (!allocation) {
      throw new ProxyUnavailableError(
        `Job ${jobId} has no live IP allocation.`,
      );
    }

    this.statements.heartbeat.run({
      allocationId: allocation.id,
      now: new Date().toISOString(),
    });

    return mapAllocation(
      this.statements
        .getById
        .get(allocation.id),
    );
  }

  releaseForJob(
    jobId,
    {
      reason,
    },
  ) {
    return this.releaseTransaction.immediate({
      jobId,
      releaseReason: reason,
      now: new Date().toISOString(),
    });
  }

  getActiveForJob(jobId) {
    return mapAllocation(
      this.statements
        .getLiveForJob
        .get(jobId),
    );
  }

  getAllocationById(allocationId) {
    return mapAllocation(
      this.statements
        .getById
        .get(allocationId),
    );
  }

  listLiveAllocations() {
    return this.statements
      .listLive
      .all()
      .map(mapAllocation);
  }
}