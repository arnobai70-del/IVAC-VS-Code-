import {
  OtpClient,
} from '../otp/otp-client.js';

import {
  OtpTableParser,
} from '../otp/otp-table-parser.js';

import {
  JobHttpClient,
} from '../session/job-http-client.js';

import {
  TargetHttpClient,
} from '../workflow/target-http-client.js';

function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}

function requireString(
  value,
  name,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function requirePositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}

/*
 * Creates the verified per-job network-facing workflow clients.
 *
 * Safety boundaries:
 *
 * - every client shares exactly one JobHttpClient;
 * - that JobHttpClient is bound to one in-memory job session;
 * - the session already owns the allocation-specific dispatcher;
 * - cookies therefore remain isolated to this one job;
 * - no direct-network fallback is created here;
 * - target routes remain constrained by TargetHttpClient;
 * - OTP redirects/challenges remain fail-closed in OtpClient;
 * - no OTP value, cookie, password, PDF, or Portal payload is
 *   persisted by this factory.
 *
 * OtpMatcher/OtpService/WorkflowEngine/document integration are
 * intentionally not constructed here until their existing
 * contracts are separately verified.
 */
export function createJobWorkflowClients({
  session,
  target,
  otp,
}) {
  requireObject(
    session,
    'session',
  );

  requireObject(
    target,
    'target',
  );

  requireObject(
    otp,
    'otp',
  );

  const targetBaseUrl =
    requireString(
      target.baseUrl,
      'target.baseUrl',
    );

  const targetTimeoutMs =
    requirePositiveInteger(
      target.timeoutMs,
      'target.timeoutMs',
    );

  const otpBaseUrl =
    requireString(
      otp.baseUrl,
      'otp.baseUrl',
    );

  const otpTablePath =
    requireString(
      otp.tablePath,
      'otp.tablePath',
    );

  const otpMaxResponseBytes =
    requirePositiveInteger(
      otp.maxResponseBytes,
      'otp.maxResponseBytes',
    );

  const otpTableSelector =
    requireString(
      otp.tableSelector,
      'otp.tableSelector',
    );

  const otpMaxRows =
    requirePositiveInteger(
      otp.maxRows,
      'otp.maxRows',
    );

  requireObject(
    otp.columns,
    'otp.columns',
  );

  const otpColumns = {
    phone:
      requireString(
        otp.columns.phone,
        'otp.columns.phone',
      ),

    code:
      requireString(
        otp.columns.code,
        'otp.columns.code',
      ),

    createdAt:
      requireString(
        otp.columns.createdAt,
        'otp.columns.createdAt',
      ),
  };

  /*
   * One JobHttpClient is shared by every downstream integration
   * for this job. The session carries the dispatcher and cookie
   * jar, so Target and OTP traffic cannot accidentally use a
   * different IP/session through this factory.
   */
  const jobHttpClient =
    new JobHttpClient({
      session,
    });

  const targetHttpClient =
    new TargetHttpClient({
      baseUrl:
        targetBaseUrl,

      jobHttpClient,

      timeoutMs:
        targetTimeoutMs,
    });

  const otpClient =
    new OtpClient({
      baseUrl:
        otpBaseUrl,

      tablePath:
        otpTablePath,

      maxResponseBytes:
        otpMaxResponseBytes,

      jobHttpClient,
    });

  const otpTableParser =
    new OtpTableParser({
      tableSelector:
        otpTableSelector,

      columns:
        otpColumns,

      maxRows:
        otpMaxRows,
    });

  return Object.freeze({
    jobHttpClient,
    targetHttpClient,
    otpClient,
    otpTableParser,
  });
}