import pino from 'pino';

export const DEFAULT_REDACT_PATHS = Object.freeze([
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization',

  'password',
  'job.password',

  'otp.code',

  'portalApiAccessToken',
  'secrets.portalApiAccessToken',

  'proxy.password',

  'session.token',

  'cookie',
  'cookies',
  'cookieJar',
]);

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

    timestamp: pino.stdTimeFunctions.isoTime,

    redact: {
      paths: [...DEFAULT_REDACT_PATHS],
      censor: '[REDACTED]',
    },
  };

  if (destination) {
    return pino(options, destination);
  }

  return pino(options);
}