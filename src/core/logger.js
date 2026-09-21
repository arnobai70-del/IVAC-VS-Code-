import pino from 'pino';

const sensitiveFields = [
  'password',
  'Password',

  'token',
  'Token',

  'accessToken',
  'portalApiAccessToken',

  'authorization',
  'Authorization',

  'cookie',
  'Cookie',

  'setCookie',
  'setCookies',

  'otp',
  'OTP',

  'otpCode',
  'OTPCode',
];

function createRedactionPaths() {
  const paths =
    new Set();

  for (
    const field
    of sensitiveFields
  ) {
    paths.add(field);

    paths.add(
      `*.${field}`,
    );

    paths.add(
      `*.*.${field}`,
    );

    paths.add(
      `*.*.*.${field}`,
    );

    paths.add(
      `*.*.*.*.${field}`,
    );
  }

  return Array.from(paths);
}

const REDACTION_PATHS =
  createRedactionPaths();

export function createLogger({
  level = 'info',
  service = 'ivac-automation',
  destination,
} = {}) {
  const options = {
    level,

    base: {
      service,
    },

    timestamp:
      pino.stdTimeFunctions
        .isoTime,

    redact: {
      paths:
        REDACTION_PATHS,

      censor:
        '[REDACTED]',
    },
  };

  if (destination) {
    return pino(
      options,
      destination,
    );
  }

  return pino(options);
}