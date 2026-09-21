import {
  AppError,
} from '../core/errors.js';

export const FINAL_RESULT_ERROR_CODES =
  Object.freeze({
    VALIDATION_ERROR:
      'FINAL_RESULT_VALIDATION_ERROR',

    CONFLICT:
      'FINAL_RESULT_CONFLICT',

    PORTAL_RESULT_NOT_CONFIGURED:
      'PORTAL_RESULT_NOT_CONFIGURED',

    PORTAL_RESULT_RESPONSE_ERROR:
      'PORTAL_RESULT_RESPONSE_ERROR',

    PORTAL_RESULT_DELIVERY_UNCERTAIN:
      'PORTAL_RESULT_DELIVERY_UNCERTAIN',
  });

export class FinalResultValidationError
  extends AppError {
  constructor(
    message =
      'Final result is invalid.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          FINAL_RESULT_ERROR_CODES
            .VALIDATION_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class FinalResultConflictError
  extends AppError {
  constructor(
    message =
      'Final result conflicts with existing durable state.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          FINAL_RESULT_ERROR_CODES
            .CONFLICT,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class PortalResultNotConfiguredError
  extends AppError {
  constructor(
    message =
      'Portal final-result contract is not configured.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_NOT_CONFIGURED,

        retryable:
          false,
      },
    );
  }
}

export class PortalResultResponseError
  extends AppError {
  constructor(
    message =
      'Portal final-result client returned an invalid acknowledgement.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_RESPONSE_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class PortalResultDeliveryUncertainError
  extends AppError {
  constructor(
    message =
      'Portal final-result delivery is uncertain and cannot be replayed safely.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_DELIVERY_UNCERTAIN,

        retryable:
          false,
      },
    );
  }
}