export const ERROR_CODES = Object.freeze({
  CONFIG_ERROR: 'CONFIG_ERROR',
  PORTAL_AUTH_ERROR: 'PORTAL_AUTH_ERROR',
  PORTAL_NETWORK_ERROR: 'PORTAL_NETWORK_ERROR',
  PROXY_UNAVAILABLE: 'PROXY_UNAVAILABLE',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  HTTP_429: 'HTTP_429',
  REMOTE_5XX: 'REMOTE_5XX',
  SESSION_ERROR: 'SESSION_ERROR',
  OTP_TIMEOUT: 'OTP_TIMEOUT',
  UPLOAD_ERROR: 'UPLOAD_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  REMOTE_REJECTION: 'REMOTE_REJECTION',
  MANUAL_CHALLENGE_REQUIRED: 'MANUAL_CHALLENGE_REQUIRED',
  JOB_CANCELLED: 'JOB_CANCELLED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

export class AppError extends Error {
  constructor(
    message,
    {
      code = ERROR_CODES.UNKNOWN_ERROR,
      retryable = false,
      cause,
      details,
    } = {},
  ) {
    super(message, {
      cause,
    });

    this.name = this.constructor.name;
    this.code = code;
    this.retryable = retryable;
    this.details = details;

    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ConfigError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: ERROR_CODES.CONFIG_ERROR,
      retryable: false,
    });
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      code: ERROR_CODES.UNKNOWN_ERROR,
      message: String(error),
      retryable: false,
    };
  }

  return {
    name: error.name,
    code: error.code ?? ERROR_CODES.UNKNOWN_ERROR,
    message: error.message,
    retryable: error.retryable ?? false,
  };
}