import {
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  calculateEffectiveCapacity,
} from './capacity.js';

export class PortalIntakeService {
  constructor({
    portalClient,
    portalMapper,
    jobStore,
    proxyPool,
    ipAllocator,
    intakeReservationStore,
    configuredConcurrency,
    jobsPerCycle,
  }) {
    this.portalClient =
      portalClient;

    this.portalMapper =
      portalMapper;

    this.jobStore =
      jobStore;

    this.proxyPool =
      proxyPool;

    this.ipAllocator =
      ipAllocator;

    this.intakeReservationStore =
      intakeReservationStore;

    this.configuredConcurrency =
      configuredConcurrency;

    this.jobsPerCycle =
      jobsPerCycle;
  }

  async runCycle() {
    const health =
      await this.portalClient
        .healthCheck();

    if (!health.safeToConsume) {
      return {
        consumed: 0,
        created: 0,
        duplicates: 0,
        effectiveCapacity: 0,
        blocker:
          health.status,
        health,
        jobs: [],
      };
    }

    const liveAllocationCount =
      this.ipAllocator
        .listLiveAllocations()
        .length;

    const healthyAvailableIpCount =
      this.proxyPool
        .countHealthyAvailable();

    const effectiveCapacity =
      calculateEffectiveCapacity({
        configuredConcurrency:
          this.configuredConcurrency,

        jobsPerCycle:
          this.jobsPerCycle,

        healthyAvailableIpCount,
        liveAllocationCount,
      });

    if (effectiveCapacity === 0) {
      return {
        consumed: 0,
        created: 0,
        duplicates: 0,
        effectiveCapacity: 0,
        blocker:
          'NO_EXECUTION_IP',
        health,
        jobs: [],
      };
    }

    const jobs = [];
    let consumed = 0;
    let created = 0;
    let duplicates = 0;

    for (
      let index = 0;
      index < effectiveCapacity;
      index += 1
    ) {
      const reservation =
        this.intakeReservationStore
          .reserveOne({
            maxConcurrent:
              this.configuredConcurrency,
          });

      if (!reservation) {
        break;
      }

      let reservationConsumed =
        false;

      try {
        const rawApplication =
          await this.portalClient
            .fetchPendingOne({
              serverName:
                reservation.ip,
            });

        if (
          rawApplication === null
          || rawApplication === undefined
        ) {
          this.intakeReservationStore
            .release(
              reservation.reservationId,
              {
                reason:
                  'NO_PENDING_APPLICATION',
              },
            );

          break;
        }

        consumed += 1;

        const normalized =
          this.portalMapper
            .normalizeApplication(
              rawApplication,
            );

        if (!normalized) {
          this.intakeReservationStore
            .release(
              reservation.reservationId,
              {
                reason:
                  'EMPTY_PENDING_RESPONSE',
              },
            );

          break;
        }

        const jobResult =
          this.jobStore
            .createOrGetJob({
              applicationId:
                normalized.applicationId,

              userId:
                normalized.userId,
            });

        if (!jobResult.created) {
          duplicates += 1;

          this.intakeReservationStore
            .release(
              reservation.reservationId,
              {
                reason:
                  'DUPLICATE_APPLICATION',
              },
            );

          continue;
        }

        const allocation =
          this.intakeReservationStore
            .bindToJob(
              reservation.reservationId,
              {
                jobId:
                  jobResult.job.id,

                userId:
                  normalized.userId,
              },
            );

        reservationConsumed = true;

        const claimed =
          this.jobStore
            .transitionJob(
              jobResult.job.id,
              JOB_STATES.CLAIMED,
            );

        const waitingForIp =
          this.jobStore
            .transitionJob(
              claimed.id,
              JOB_STATES.WAITING_FOR_IP,
            );

        created += 1;

        jobs.push({
          jobId:
            waitingForIp.id,

          applicationId:
            waitingForIp.applicationId,

          state:
            waitingForIp.state,

          allocationId:
            allocation.allocationId,

          assignedIp:
            allocation.ip,

          port:
            allocation.port,
        });
      } catch (error) {
        if (!reservationConsumed) {
          try {
            this.intakeReservationStore
              .release(
                reservation.reservationId,
                {
                  reason:
                    'PORTAL_INTAKE_FAILED',
                },
              );
          } catch {
            // Preserve the original intake error.
            // Durable recovery will handle any orphaned reservation.
          }
        }

        throw error;
      }
    }

    return {
      consumed,
      created,
      duplicates,
      effectiveCapacity,
      blocker: null,
      health,
      jobs,
    };
  }
}