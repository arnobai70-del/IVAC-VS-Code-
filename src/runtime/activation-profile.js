export const ACTIVATION_PROFILES =
  Object.freeze({
    SAFE:
      'safe',

    CONTROLLED:
      'controlled',
  });


const READY_REASON =
  'READY';


const INVALID_READINESS_MESSAGE =
  'readiness must be a valid activation profile readiness result.';


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


function requireActivationProfile(
  value,
) {
  if (
    value
    !== ACTIVATION_PROFILES.SAFE
    && value
    !== ACTIVATION_PROFILES.CONTROLLED
  ) {
    throw new TypeError(
      'profile must be "safe" or "controlled".',
    );
  }

  return value;
}


function invalidReadiness() {
  throw new TypeError(
    INVALID_READINESS_MESSAGE,
  );
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


function createBlockers({
  profile,
  intakeEnabled,
  workflowRuntimeEnabled,
  portalResultEnabled,
}) {
  const blockers = [];

  if (
    intakeEnabled
    && profile
      !== ACTIVATION_PROFILES
        .CONTROLLED
  ) {
    blockers.push(
      'CONTROLLED_ACTIVATION_PROFILE_REQUIRED',
    );
  }

  if (
    intakeEnabled
    && !workflowRuntimeEnabled
  ) {
    blockers.push(
      'WORKFLOW_RUNTIME_DISABLED',
    );
  }

  if (
    intakeEnabled
    && !portalResultEnabled
  ) {
    blockers.push(
      'PORTAL_RESULT_DISABLED',
    );
  }

  return Object.freeze(
    blockers,
  );
}


function getState({
  profile,
  intakeEnabled,
  ready,
}) {
  if (
    intakeEnabled
    && ready
  ) {
    return 'ACTIVE';
  }

  if (
    profile
    === ACTIVATION_PROFILES
      .CONTROLLED
  ) {
    return 'ARMED';
  }

  return 'SAFE';
}


export function inspectActivationProfile({
  profile,
  intakeEnabled,
  workflowRuntimeEnabled,
  portalResultEnabled,
}) {
  requireActivationProfile(
    profile,
  );

  requireBoolean(
    intakeEnabled,
    'intakeEnabled',
  );

  requireBoolean(
    workflowRuntimeEnabled,
    'workflowRuntimeEnabled',
  );

  requireBoolean(
    portalResultEnabled,
    'portalResultEnabled',
  );

  const blockers =
    createBlockers({
      profile,
      intakeEnabled,
      workflowRuntimeEnabled,
      portalResultEnabled,
    });

  const ready =
    blockers.length
    === 0;

  const controlledProfile =
    profile
    === ACTIVATION_PROFILES
      .CONTROLLED;

  return Object.freeze({
    ready,

    reason:
      ready
        ? READY_REASON
        : blockers[0],

    state:
      getState({
        profile,
        intakeEnabled,
        ready,
      }),

    profile,

    blockers,

    gates:
      Object.freeze({
        controlledProfile,

        intakeEnabled,

        workflowRuntimeEnabled,

        portalResultEnabled,
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
    || typeof readiness.ready
      !== 'boolean'
    || typeof readiness.reason
      !== 'string'
    || typeof readiness.state
      !== 'string'
    || (
      readiness.profile
      !== ACTIVATION_PROFILES.SAFE
      && readiness.profile
      !== ACTIVATION_PROFILES.CONTROLLED
    )
    || !Array.isArray(
      readiness.blockers,
    )
    || !isObject(
      readiness.gates,
    )
  ) {
    invalidReadiness();
  }

  const gates =
    readiness.gates;

  if (
    typeof gates.controlledProfile
      !== 'boolean'
    || typeof gates.intakeEnabled
      !== 'boolean'
    || typeof gates.workflowRuntimeEnabled
      !== 'boolean'
    || typeof gates.portalResultEnabled
      !== 'boolean'
  ) {
    invalidReadiness();
  }

  /*
   * The assertion boundary must not trust a caller-supplied
   * ready/state/profile combination.
   *
   * Recompute the canonical readiness result from the bounded
   * gate values and require an exact semantic match.
   */
  const expected =
    inspectActivationProfile({
      profile:
        readiness.profile,

      intakeEnabled:
        gates.intakeEnabled,

      workflowRuntimeEnabled:
        gates.workflowRuntimeEnabled,

      portalResultEnabled:
        gates.portalResultEnabled,
    });

  if (
    gates.intakeEnabled
      !== intakeEnabled
    || readiness.ready
      !== expected.ready
    || readiness.reason
      !== expected.reason
    || readiness.state
      !== expected.state
    || gates.controlledProfile
      !== expected.gates
        .controlledProfile
    || !sameStringArray(
      readiness.blockers,
      expected.blockers,
    )
  ) {
    invalidReadiness();
  }

  return readiness;
}


export function assertActivationProfileForIntake({
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
   * Safe/default startup remains usable while destructive intake
   * is disabled, regardless of whether the operator has selected
   * the controlled profile in preparation for activation.
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
      `Activation profile blocked: ${validatedReadiness.reason}.`,
    );
  }

  return validatedReadiness;
}
