const READY_REASON =
  'READY';


function requireBoolean(
  value,
  name,
) {
  if (
    typeof value
    !== 'boolean'
  ) {
    throw new TypeError(
      `${name} must be a boolean.`,
    );
  }

  return value;
}


function isConfiguredSecret(
  value,
) {
  return (
    typeof value
      === 'string'
    && value.trim()
      .length > 0
  );
}


function createBlockers({
  intakeEnabled,
  portalResultEnabled,
  portalApiAccessTokenConfigured,
}) {
  const blockers = [];

  /*
   * Secret readiness is activation-aware.
   *
   * Safe development startup is allowed without production
   * credentials while destructive intake remains disabled.
   */
  if (
    intakeEnabled
    && !portalResultEnabled
  ) {
    blockers.push(
      'PORTAL_RESULT_DISABLED',
    );
  }

  if (
    intakeEnabled
    && !portalApiAccessTokenConfigured
  ) {
    blockers.push(
      'PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED',
    );
  }

  return Object.freeze(
    blockers,
  );
}


export function inspectSecretReadiness({
  intakeEnabled,
  portalResultEnabled,
  portalApiAccessToken,
}) {
  requireBoolean(
    intakeEnabled,
    'intakeEnabled',
  );

  requireBoolean(
    portalResultEnabled,
    'portalResultEnabled',
  );

  const portalApiAccessTokenConfigured =
    isConfiguredSecret(
      portalApiAccessToken,
    );

  const blockers =
    createBlockers({
      intakeEnabled,
      portalResultEnabled,
      portalApiAccessTokenConfigured,
    });

  const ready =
    blockers.length
    === 0;

  return Object.freeze({
    ready,

    reason:
      ready
        ? READY_REASON
        : blockers[0],

    blockers,

    gates:
      Object.freeze({
        intakeEnabled,

        portalResultEnabled,

        portalApiAccessTokenConfigured,
      }),

    /*
     * Never return the credential itself.
     *
     * Readiness output is safe for operational logs and bootstrap
     * summaries because it exposes only configuration state.
     */
    secrets:
      Object.freeze({
        portalApiAccessTokenConfigured,
      }),
  });
}


export function assertSecretReadinessForIntake({
  intakeEnabled,
  readiness,
}) {
  requireBoolean(
    intakeEnabled,
    'intakeEnabled',
  );

  if (
    readiness === null
    || typeof readiness
      !== 'object'
    || Array.isArray(
      readiness,
    )
    || typeof readiness.ready
      !== 'boolean'
    || typeof readiness.reason
      !== 'string'
  ) {
    throw new TypeError(
      'readiness must be a valid secret readiness result.',
    );
  }

  /*
   * Normal disabled startup must remain safe and usable without
   * production credentials.
   */
  if (
    intakeEnabled
    !== true
  ) {
    return readiness;
  }

  if (
    readiness.ready
    !== true
  ) {
    throw new Error(
      `Secret readiness blocked: ${readiness.reason}.`,
    );
  }

  return readiness;
}