import {
  PortalResultNotConfiguredError,
  PortalResultResponseError,
} from '../results/final-result-errors.js';

export const PORTAL_RESULT_DELIVERY_CERTAINTY =
  Object.freeze({
    NOT_SENT:
      'NOT_SENT',

    REJECTED:
      'REJECTED',

    UNCERTAIN:
      'UNCERTAIN',
  });

function validateContract(contract) {
  if (
    contract === null
  ) {
    return null;
  }

  if (
    !contract
    || typeof contract
      !== 'object'
    || typeof contract.send
      !== 'function'
  ) {
    throw new TypeError(
      'Portal result contract must provide a send function.',
    );
  }

  if (
    contract
      .supportsIdempotentReplay
      !== undefined
    && typeof contract
      .supportsIdempotentReplay
      !== 'boolean'
  ) {
    throw new TypeError(
      'supportsIdempotentReplay must be a boolean when provided.',
    );
  }

  return contract;
}

function safeJob(job) {
  return Object.freeze({
    id:
      job.id,

    applicationId:
      job.applicationId,

    userId:
      job.userId
      ?? null,

    state:
      job.state,
  });
}

function safeAllocation(
  allocation,
) {
  return Object.freeze({
    allocationId:
      allocation.allocationId,

    jobId:
      allocation.jobId,

    proxyId:
      allocation.proxyId,

    assignedIp:
      allocation.ip,

    port:
      allocation.port,
  });
}

function safeRecord(record) {
  return Object.freeze({
    id:
      record.id,

    jobId:
      record.jobId,

    applicationId:
      record.applicationId,

    outcome:
      record.outcome,

    terminalState:
      record.terminalState,

    code:
      record.code,

    message:
      record.message,

    data:
      structuredClone(
        record.data,
      ),

    payloadHash:
      record.payloadHash,

    idempotencyKey:
      record.idempotencyKey,

    deliveryAttempts:
      record.deliveryAttempts,
  });
}

export class PortalResultClient {
  constructor({
    contract = null,
  } = {}) {
    this.contract =
      validateContract(
        contract,
      );
  }

  isConfigured() {
    return (
      this.contract
      !== null
    );
  }

  supportsIdempotentReplay() {
    return Boolean(
      this.contract
        ?.supportsIdempotentReplay,
    );
  }

  getSafeCapabilities() {
    return {
      configured:
        this.isConfigured(),

      supportsIdempotentReplay:
        this.supportsIdempotentReplay(),
    };
  }

  async sendResult({
    record,
    job,
    allocation,
  }) {
    if (
      !this.contract
    ) {
      throw new PortalResultNotConfiguredError(
        'Portal result endpoint/payload contract is not verified or configured.',
        {
          details: {
            deliveryCertainty:
              PORTAL_RESULT_DELIVERY_CERTAINTY
                .NOT_SENT,
          },
        },
      );
    }

    const response =
      await this.contract
        .send({
          result:
            safeRecord(
              record,
            ),

          job:
            safeJob(
              job,
            ),

          allocation:
            safeAllocation(
              allocation,
            ),
        });

    if (
      !response
      || typeof response
        !== 'object'
      || response.accepted
        !== true
    ) {
      throw new PortalResultResponseError(
        'Portal result contract did not return an explicit accepted acknowledgement.',
        {
          details: {
            deliveryCertainty:
              PORTAL_RESULT_DELIVERY_CERTAINTY
                .UNCERTAIN,
          },
        },
      );
    }

    const statusCode =
      response.statusCode
      ?? null;

    if (
      statusCode
      !== null
      && (
        !Number.isInteger(
          statusCode,
        )
        || statusCode < 100
        || statusCode > 599
      )
    ) {
      throw new PortalResultResponseError(
        'Portal result contract returned an invalid HTTP status code.',
        {
          details: {
            deliveryCertainty:
              PORTAL_RESULT_DELIVERY_CERTAINTY
                .UNCERTAIN,
          },
        },
      );
    }

    return Object.freeze({
      accepted:
        true,

      statusCode,
    });
  }
}