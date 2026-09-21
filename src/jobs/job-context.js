import {
  SessionAllocationMismatchError,
  SessionError,
} from '../core/errors.js';

function requireObject(
  value,
  name,
) {
  if (
    !value
    || typeof value !== 'object'
  ) {
    throw new TypeError(
      `${name} is required.`,
    );
  }

  return value;
}

function deepFreeze(
  value,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function cloneInput(
  input,
) {
  if (
    input === null
    || input === undefined
  ) {
    return {};
  }

  if (
    typeof input !== 'object'
    || Array.isArray(input)
  ) {
    throw new TypeError(
      'job input must be an object.',
    );
  }

  return structuredClone(
    input,
  );
}

export class JobContext {
  constructor({
    job,
    allocation,
    dispatcher,
    cookieJar,
    session,
    input = {},
  }) {
    this.job =
      requireObject(
        job,
        'job',
      );

    this.allocation =
      requireObject(
        allocation,
        'allocation',
      );

    this.dispatcher =
      requireObject(
        dispatcher,
        'dispatcher',
      );

    this.cookieJar =
      requireObject(
        cookieJar,
        'cookieJar',
      );

    this.session =
      requireObject(
        session,
        'session',
      );

    if (
      this.allocation.jobId
      !== this.job.id
    ) {
      throw new SessionAllocationMismatchError(
        'Job context allocation belongs to another job.',
      );
    }

    if (
      this.session.jobId
      !== this.job.id
    ) {
      throw new SessionError(
        'Session belongs to another job.',
      );
    }

    if (
      this.session.allocationId
      !== this.allocation
        .allocationId
    ) {
      throw new SessionAllocationMismatchError(
        'Session allocation does not match job context allocation.',
      );
    }

    this.input =
      deepFreeze(
        cloneInput(
          input,
        ),
      );

    this.responses = {};

    this.otp = {};

    this.otpWatch =
      null;

    this.documents = [];

    this.currentStep =
      null;

    this.retryState = {
      attempt: 0,
      lastErrorCode: null,
    };

    this.result =
      null;
  }

  setCurrentStep(
    stepId,
  ) {
    this.currentStep =
      stepId ?? null;
  }

  setResponse(
    stepId,
    value,
  ) {
    if (
      typeof stepId !== 'string'
      || stepId.trim() === ''
    ) {
      throw new TypeError(
        'stepId must be a non-empty string.',
      );
    }

    this.responses[
      stepId.trim()
    ] = value;
  }

  getResponse(
    stepId,
  ) {
    return this.responses[
      stepId
    ];
  }

  setOtpWatch(
    watch,
  ) {
    if (
      !watch
      || typeof watch !== 'object'
      || typeof watch.phone
        !== 'string'
      || !Array.isArray(
        watch.baselineFingerprints,
      )
    ) {
      throw new TypeError(
        'A valid OTP watch is required.',
      );
    }

    this.otpWatch = {
      ...watch,

      baselineFingerprints: [
        ...watch
          .baselineFingerprints,
      ],
    };
  }

  clearOtpWatch() {
    this.otpWatch =
      null;
  }

  setOtp(
    value,
  ) {
    this.otp =
      value
      && typeof value === 'object'
        ? {
            ...value,
          }
        : {};
  }

  clearOtp() {
    this.otp = {};
  }

  setDocuments(
    documents,
  ) {
    if (
      !Array.isArray(
        documents,
      )
    ) {
      throw new TypeError(
        'documents must be an array.',
      );
    }

    this.documents = [
      ...documents,
    ];
  }

  setRetryState({
    attempt,
    lastErrorCode = null,
  }) {
    if (
      !Number.isInteger(
        attempt,
      )
      || attempt < 0
    ) {
      throw new TypeError(
        'retry attempt must be a non-negative integer.',
      );
    }

    this.retryState = {
      attempt,
      lastErrorCode,
    };
  }

  setResult(
    result,
  ) {
    this.result =
      result ?? null;
  }
}