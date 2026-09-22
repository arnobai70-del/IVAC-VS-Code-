import {
  JobNotFoundError,
} from '../core/errors.js';

import {
  isTerminalJobState,
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  RELEASE_REASONS,
} from '../network/proxy-state.js';

import {
  PORTAL_RESULT_DELIVERY_CERTAINTY,
} from '../portal/portal-result-client.js';

import {
  normalizeFinalResult,
} from './final-result.js';

import {
  FinalResultConflictError,
  PortalResultDeliveryUncertainError,
  PortalResultNotConfiguredError,
} from './final-result-errors.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
} from './final-result-store.js';

function releaseReasonFor(
  terminalState,
) {
  if (
    terminalState
    === JOB_STATES.COMPLETED
  ) {
    return RELEASE_REASONS
      .JOB_COMPLETED;
  }

  if (
    terminalState
    === JOB_STATES.FAILED_FINAL
  ) {
    return RELEASE_REASONS
      .FAILED_FINAL;
  }

  throw new FinalResultConflictError(
    `Unsupported final terminal state: ${terminalState}`,
  );
}

function deliveryCertainty(error) {
  const value =
    error?.details
      ?.deliveryCertainty;

  if (
    Object.values(
      PORTAL_RESULT_DELIVERY_CERTAINTY,
    ).includes(value)
  ) {
    return value;
  }

  return PORTAL_RESULT_DELIVERY_CERTAINTY
    .UNCERTAIN;
}

export class FinalResultService {
  constructor({
    jobStore,
    finalResultStore,
    portalResultClient,
    ipAllocator,
  }) {
    this.jobStore =
      jobStore;

    this.finalResultStore =
      finalResultStore;

    this.portalResultClient =
      portalResultClient;

    this.ipAllocator =
      ipAllocator;
  }

  getJob(jobId) {
    const job =
      this.jobStore
        .getJobById(
          jobId,
        );

    if (!job) {
      throw new JobNotFoundError(
        jobId,
      );
    }

    return job;
  }

  finalizeDeliveredRecord(
    record,
  ) {
    let job =
      this.getJob(
        record.jobId,
      );

    if (
      isTerminalJobState(
        job.state,
      )
    ) {
      if (
        job.state
        !== record.terminalState
      ) {
        throw new FinalResultConflictError(
          `Job ${job.id} is already terminal in ${job.state}, not ${record.terminalState}.`,
        );
      }
    } else {
      job =
        this.jobStore
          .transitionJob(
            job.id,
            record.terminalState,
            {
              expectedVersion:
                job.version,

              ...(
                record.terminalState
                === JOB_STATES.FAILED_FINAL
                  ? {
                      failureCode:
                        record.code
                        ?? 'FINAL_RESULT_FAILURE',

                      failureMessage:
                        record.message
                        ?? 'Job completed with a final failure result.',
                    }
                  : {}
              ),
            },
          );
    }

    const release =
      this.ipAllocator
        .releaseForJob(
          job.id,
          {
            reason:
              releaseReasonFor(
                record.terminalState,
              ),
          },
        );

    return {
      job,

      result:
        this.finalResultStore
          .getByJobId(
            record.jobId,
          ),

      ipRelease:
        release,
    };
  }

  async deliverRecord(
    record,
    {
      resultCreated,
    },
  ) {
    if (
      record.deliveryStatus
      === FINAL_RESULT_DELIVERY_STATUSES
        .DELIVERED
    ) {
      return {
        ...this.finalizeDeliveredRecord(
          record,
        ),

        resultCreated,

        deliveryReused:
          true,
      };
    }

    if (
      !this.portalResultClient
        .isConfigured()
    ) {
      throw new PortalResultNotConfiguredError(
        'Final result was captured durably, but the verified Portal result contract is not configured.',
        {
          details: {
            deliveryCertainty:
              PORTAL_RESULT_DELIVERY_CERTAINTY
                .NOT_SENT,
          },
        },
      );
    }

    let deliveryRecord =
      record;

    if (
      deliveryRecord.deliveryStatus
        === FINAL_RESULT_DELIVERY_STATUSES
          .PENDING
      && deliveryRecord
        .lastDeliveryCertainty
        === PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN
      && !this.portalResultClient
        .supportsIdempotentReplay()
    ) {
      throw new PortalResultDeliveryUncertainError(
        `Portal final-result delivery for job ${deliveryRecord.jobId} was previously uncertain; replay is blocked without verified remote idempotency.`,
      );
    }

    if (
      deliveryRecord.deliveryStatus
      === FINAL_RESULT_DELIVERY_STATUSES
        .UNCERTAIN
    ) {
      if (
        !this.portalResultClient
          .supportsIdempotentReplay()
      ) {
        throw new PortalResultDeliveryUncertainError(
          `Portal final-result delivery for job ${deliveryRecord.jobId} is uncertain; replay is blocked without verified remote idempotency.`,
        );
      }

      deliveryRecord =
        this.finalResultStore
          .requeueUncertain(
            deliveryRecord.jobId,
          );
    }

    const allocation =
      this.ipAllocator
        .getActiveForJob(
          deliveryRecord.jobId,
        );

    if (!allocation) {
      throw new FinalResultConflictError(
        `Job ${deliveryRecord.jobId} has no live IP allocation while final-result delivery is pending.`,
      );
    }

    const started =
      this.finalResultStore
        .beginDelivery(
          deliveryRecord.jobId,
        );

    if (
      !started.started
    ) {
      return {
        ...this.finalizeDeliveredRecord(
          started.record,
        ),

        resultCreated,

        deliveryReused:
          true,
      };
    }

    let deliveredRecord;

    try {
      const acknowledgement =
        await this.portalResultClient
          .sendResult({
            record:
              started.record,

            job:
              this.getJob(
                deliveryRecord.jobId,
              ),

            allocation,
          });

      deliveredRecord =
        this.finalResultStore
          .markDelivered(
            deliveryRecord.jobId,
            {
              httpStatus:
                acknowledgement
                  .statusCode,
            },
          );
    } catch (error) {
      const certainty =
        deliveryCertainty(
          error,
        );

      const replaySafe =
        this.portalResultClient
          .supportsIdempotentReplay();

      if (
        certainty
          === PORTAL_RESULT_DELIVERY_CERTAINTY
            .NOT_SENT
        || certainty
          === PORTAL_RESULT_DELIVERY_CERTAINTY
            .REJECTED
        || replaySafe
      ) {
        this.finalResultStore
          .markPendingAfterFailure(
            deliveryRecord.jobId,
            error,
            {
              deliveryCertainty:
                certainty,
            },
          );
      } else {
        this.finalResultStore
          .markUncertain(
            deliveryRecord.jobId,
            error,
          );
      }

      throw error;
    }

    return {
      ...this.finalizeDeliveredRecord(
        deliveredRecord,
      ),

      resultCreated,

      deliveryReused:
        false,
    };
  }

  async resumeDelivery(
    jobId,
  ) {
    this.getJob(
      jobId,
    );

    const record =
      this.finalResultStore
        .getByJobId(
          jobId,
        );

    if (!record) {
      throw new FinalResultConflictError(
        `Job ${jobId} has no durable final result to resume.`,
      );
    }

    return this.deliverRecord(
      record,
      {
        resultCreated:
          false,
      },
    );
  }

  async finalize({
    jobId,
    outcome,
    code = null,
    message = null,
    data = {},
  }) {
    const job =
      this.getJob(
        jobId,
      );

    const existing =
      this.finalResultStore
        .getByJobId(
          jobId,
        );

    if (
      isTerminalJobState(
        job.state,
      )
      && !existing
    ) {
      throw new FinalResultConflictError(
        `Cannot create a new final result after job ${job.id} became terminal.`,
      );
    }

    const normalized =
      normalizeFinalResult({
        jobId:
          job.id,

        applicationId:
          job.applicationId,

        outcome,
        code,
        message,
        data,
      });

    const resultState =
      this.finalResultStore
        .createOrGet(
          normalized,
        );

    return this.deliverRecord(
      resultState.record,
      {
        resultCreated:
          resultState.created,
      },
    );
  }
}