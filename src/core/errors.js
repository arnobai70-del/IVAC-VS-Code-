export const ERROR_CODES =
  Object.freeze({
    CONFIG_ERROR:
      'CONFIG_ERROR',

    DATABASE_ERROR:
      'DATABASE_ERROR',

    JOB_NOT_FOUND:
      'JOB_NOT_FOUND',

    JOB_CONFLICT:
      'JOB_CONFLICT',

    INVALID_JOB_TRANSITION:
      'INVALID_JOB_TRANSITION',

    PROXY_CONFIG_ERROR:
      'PROXY_CONFIG_ERROR',

    PROXY_NOT_FOUND:
      'PROXY_NOT_FOUND',

    PROXY_UNAVAILABLE:
      'PROXY_UNAVAILABLE',

    PORTAL_AUTH_ERROR:
      'PORTAL_AUTH_ERROR',

    PORTAL_NETWORK_ERROR:
      'PORTAL_NETWORK_ERROR',

    PORTAL_RESPONSE_ERROR:
      'PORTAL_RESPONSE_ERROR',

    NETWORK_TIMEOUT:
      'NETWORK_TIMEOUT',

    HTTP_429:
      'HTTP_429',

    REMOTE_5XX:
      'REMOTE_5XX',

    SESSION_ERROR:
      'SESSION_ERROR',

    SESSION_CLOSED:
      'SESSION_CLOSED',

    SESSION_ALLOCATION_MISMATCH:
      'SESSION_ALLOCATION_MISMATCH',

    OTP_TIMEOUT:
      'OTP_TIMEOUT',

    OTP_RESPONSE_ERROR:
      'OTP_RESPONSE_ERROR',

    WORKFLOW_CONFIG_ERROR:
      'WORKFLOW_CONFIG_ERROR',

    WORKFLOW_TEMPLATE_ERROR:
      'WORKFLOW_TEMPLATE_ERROR',

    WORKFLOW_STEP_ERROR:
      'WORKFLOW_STEP_ERROR',

    UPLOAD_ERROR:
      'UPLOAD_ERROR',

    INVALID_RESPONSE:
      'INVALID_RESPONSE',

    REMOTE_REJECTION:
      'REMOTE_REJECTION',

    MANUAL_CHALLENGE_REQUIRED:
      'MANUAL_CHALLENGE_REQUIRED',

    JOB_CANCELLED:
      'JOB_CANCELLED',

    UNKNOWN_ERROR:
      'UNKNOWN_ERROR',
  });

export class AppError
  extends Error {
  constructor(
    message,
    {
      code =
        ERROR_CODES.UNKNOWN_ERROR,

      retryable =
        false,

      cause,
      details,
    } = {},
  ) {
    super(
      message,
      {
        cause,
      },
    );

    this.name =
      this.constructor.name;

    this.code =
      code;

    this.retryable =
      retryable;

    this.details =
      details;

    Error.captureStackTrace?.(
      this,
      this.constructor,
    );
  }
}

export class ConfigError
  extends AppError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.CONFIG_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class DatabaseError
  extends AppError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.DATABASE_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class JobNotFoundError
  extends AppError {
  constructor(
    jobId,
    options = {},
  ) {
    super(
      `Job not found: ${jobId}`,
      {
        ...options,

        code:
          ERROR_CODES.JOB_NOT_FOUND,

        retryable:
          false,
      },
    );
  }
}

export class JobConflictError
  extends AppError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.JOB_CONFLICT,

        retryable:
          options.retryable
          ?? true,
      },
    );
  }
}

export class InvalidJobTransitionError
  extends AppError {
  constructor(
    fromState,
    toState,
    options = {},
  ) {
    super(
      `Invalid job state transition: ${fromState} -> ${toState}`,
      {
        ...options,

        code:
          ERROR_CODES
            .INVALID_JOB_TRANSITION,

        retryable:
          false,
      },
    );

    this.fromState =
      fromState;

    this.toState =
      toState;
  }
}

export class ProxyConfigurationError
  extends AppError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .PROXY_CONFIG_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class ProxyNotFoundError
  extends AppError {
  constructor(
    proxyId,
    options = {},
  ) {
    super(
      `Proxy not found: ${proxyId}`,
      {
        ...options,

        code:
          ERROR_CODES
            .PROXY_NOT_FOUND,

        retryable:
          false,
      },
    );
  }
}

export class ProxyUnavailableError
  extends AppError {
  constructor(
    message =
      'No healthy execution proxy is available.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .PROXY_UNAVAILABLE,

        retryable:
          options.retryable
          ?? true,
      },
    );
  }
}

export class PortalAuthError
  extends AppError {
  constructor(
    message =
      'Portal authentication failed.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .PORTAL_AUTH_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class PortalNetworkError
  extends AppError {
  constructor(
    message =
      'Portal network request failed.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .PORTAL_NETWORK_ERROR,

        retryable:
          true,
      },
    );
  }
}

export class PortalResponseError
  extends AppError {
  constructor(
    message =
      'Portal returned an invalid response.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .PORTAL_RESPONSE_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class NetworkTimeoutError
  extends AppError {
  constructor(
    message =
      'Network operation timed out.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .NETWORK_TIMEOUT,

        retryable:
          true,
      },
    );
  }
}

export class RateLimitError
  extends AppError {
  constructor(
    message =
      'Remote service rate limited the request.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.HTTP_429,

        retryable:
          true,
      },
    );
  }
}

export class Remote5xxError
  extends AppError {
  constructor(
    message =
      'Remote service returned a server error.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.REMOTE_5XX,

        retryable:
          true,
      },
    );
  }
}

export class SessionError
  extends AppError {
  constructor(
    message =
      'Session operation failed.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.SESSION_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class SessionClosedError
  extends AppError {
  constructor(
    message =
      'Session is already closed.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .SESSION_CLOSED,

        retryable:
          false,
      },
    );
  }
}

export class SessionAllocationMismatchError
  extends AppError {
  constructor(
    message =
      'Session allocation does not match the job allocation.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .SESSION_ALLOCATION_MISMATCH,

        retryable:
          false,
      },
    );
  }
}

export class OtpTimeoutError
  extends AppError {
  constructor(
    message =
      'OTP polling reached the configured timeout.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.OTP_TIMEOUT,

        retryable:
          true,
      },
    );
  }
}

export class OtpResponseError
  extends AppError {
  constructor(
    message =
      'OTP service returned an invalid response.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .OTP_RESPONSE_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class WorkflowConfigError
  extends AppError {
  constructor(
    message =
      'Workflow configuration is invalid.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .WORKFLOW_CONFIG_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class WorkflowTemplateError
  extends AppError {
  constructor(
    message =
      'Workflow template could not be resolved.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .WORKFLOW_TEMPLATE_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class WorkflowStepError
  extends AppError {
  constructor(
    message =
      'Workflow step failed.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .WORKFLOW_STEP_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class ManualChallengeRequiredError
  extends AppError {
  constructor(
    message =
      'Manual challenge handling is required.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES
            .MANUAL_CHALLENGE_REQUIRED,

        retryable:
          false,
      },
    );
  }
}

export class JobCancelledError
  extends AppError {
  constructor(
    message =
      'Job was cancelled.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          ERROR_CODES.JOB_CANCELLED,

        retryable:
          false,
      },
    );
  }
}

export function isAppError(
  error,
) {
  return error
    instanceof AppError;
}

export function serializeError(
  error,
) {
  if (!(error instanceof Error)) {
    return {
      name:
        'UnknownError',

      code:
        ERROR_CODES.UNKNOWN_ERROR,

      message:
        String(error),

      retryable:
        false,
    };
  }

  return {
    name:
      error.name,

    code:
      error.code
      ?? ERROR_CODES.UNKNOWN_ERROR,

    message:
      error.message,

    retryable:
      error.retryable
      ?? false,
  };
}