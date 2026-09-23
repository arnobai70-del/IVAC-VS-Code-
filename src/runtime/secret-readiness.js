const READY_REASON =
  'READY';


const INVALID_READINESS_MESSAGE =
  'readiness must be a valid secret readiness result.';


/*
 * Module-private provenance registry.
 *
 * WeakSet membership cannot be copied by spreading, serialization,
 * property-descriptor cloning, or symbol reflection.
 *
 * Only readiness objects created by this module are admitted to the
 * assertion boundary.
 */
const SECRET_READINESS_PROVENANCE =
  new WeakSet();


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


function isObject(
  value,
) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(
      value,
    )
  );
}


function invalidReadiness() {
  throw new TypeError(
    INVALID_READINESS_MESSAGE,
  );
}


function sameStringArray(
  actual,
  expected,
) {
  if (
    !Array.isArray(
      actual,
    )
    || actual.length
      !== expected.length
  ) {
    return false;
  }

  for (
    let index = 0;
    index < expected.length;
    index += 1
  ) {
    if (
      typeof actual[index]
        !== 'string'
      || actual[index]
        !== expected[index]
    ) {
      return false;
    }
  }

  return true;
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


function createProvenancedReadiness(
  value,
) {
  const frozen =
    Object.freeze(
      value,
    );

  SECRET_READINESS_PROVENANCE
    .add(
      frozen,
    );

  return frozen;
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

  return createProvenancedReadiness({
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


function validateReadinessForAssertion({
  intakeEnabled,
  readiness,
}) {
  if (
    !isObject(
      readiness,
    )
    || !SECRET_READINESS_PROVENANCE
      .has(
        readiness,
      )
    || typeof readiness.ready
      !== 'boolean'
    || typeof readiness.reason
      !== 'string'
    || !Array.isArray(
      readiness.blockers,
    )
    || !isObject(
      readiness.gates,
    )
    || !isObject(
      readiness.secrets,
    )
  ) {
    invalidReadiness();
  }

  const gates =
    readiness.gates;

  const secrets =
    readiness.secrets;

  if (
    typeof gates.intakeEnabled
      !== 'boolean'
    || typeof gates.portalResultEnabled
      !== 'boolean'
    || typeof gates.portalApiAccessTokenConfigured
      !== 'boolean'
    || typeof secrets.portalApiAccessTokenConfigured
      !== 'boolean'
  ) {
    invalidReadiness();
  }

  if (
    gates.intakeEnabled
      !== intakeEnabled
    || gates.portalApiAccessTokenConfigured
      !== secrets
        .portalApiAccessTokenConfigured
  ) {
    invalidReadiness();
  }

  /*
   * Recompute all derivable readiness semantics from the immutable
   * bounded gate values rather than trusting ready/reason/blockers.
   *
   * The actual secret is intentionally never copied into this
   * assertion boundary.
   */
  const expectedBlockers =
    createBlockers({
      intakeEnabled:
        gates.intakeEnabled,

      portalResultEnabled:
        gates.portalResultEnabled,

      portalApiAccessTokenConfigured:
        gates
          .portalApiAccessTokenConfigured,
    });

  const expectedReady =
    expectedBlockers.length
    === 0;

  const expectedReason =
    expectedReady
      ? READY_REASON
      : expectedBlockers[0];

  if (
    readiness.ready
      !== expectedReady
    || readiness.reason
      !== expectedReason
    || !sameStringArray(
      readiness.blockers,
      expectedBlockers,
    )
  ) {
    invalidReadiness();
  }

  return readiness;
}


export function assertSecretReadinessForIntake({
  intakeEnabled,
  readiness,
}) {
  requireBoolean(
    intakeEnabled,
    'intakeEnabled',
  );

  const validatedReadiness =
    validateReadinessForAssertion({
      intakeEnabled,
      readiness,
    });

  /*
   * Normal disabled startup must remain safe and usable without
   * production credentials.
   */
  if (
    intakeEnabled
    !== true
  ) {
    return validatedReadiness;
  }

  if (
    validatedReadiness.ready
    !== true
  ) {
    throw new Error(
      `Secret readiness blocked: ${validatedReadiness.reason}.`,
    );
  }

  return validatedReadiness;
}
