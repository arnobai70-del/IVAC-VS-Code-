export const ACTIVATION_PROFILES =
  Object.freeze({
    SAFE:
      'safe',

    CONTROLLED:
      'controlled',
  });


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


export function assertActivationProfileForIntake({
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
    || typeof readiness.state
      !== 'string'
    || typeof readiness.profile
      !== 'string'
  ) {
    throw new TypeError(
      'readiness must be a valid activation profile readiness result.',
    );
  }

  /*
   * Safe/default startup remains usable while destructive intake
   * is disabled, regardless of whether the operator has selected
   * the controlled profile in preparation for activation.
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
      `Activation profile blocked: ${readiness.reason}.`,
    );
  }

  return readiness;
}