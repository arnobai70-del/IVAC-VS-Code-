function requireWorkflowObject(
  workflow,
) {
  if (
    workflow === null
    || typeof workflow !== 'object'
    || Array.isArray(workflow)
  ) {
    throw new TypeError(
      'workflow must be an object.',
    );
  }

  return workflow;
}

function normalizeStepTypes(
  steps,
) {
  return [
    ...new Set(
      steps.map(
        (step) => step.type,
      ),
    ),
  ];
}

function hasRequiredExecutionBoundary(
  workflow,
) {
  return (
    workflow.version === 1
    && Array.isArray(
      workflow.steps,
    )
  );
}

export function inspectWorkflowReadiness(
  workflow,
) {
  requireWorkflowObject(
    workflow,
  );

  const stepTypes =
    normalizeStepTypes(
      workflow.steps ?? [],
    );

  const enabled =
    workflow.enabled === true;

  const hasSteps =
    workflow.steps.length > 0;

  const executionReady =
    enabled
    && hasSteps
    && hasRequiredExecutionBoundary(
      workflow,
    );

  return Object.freeze({
    name:
      workflow.name,

    version:
      workflow.version,

    enabled,

    stepCount:
      workflow.steps.length,

    stepTypes,

    executionReady,

    boundaries: {
      schemaValidated:
        true,

      policyValidated:
        true,

      targetContractRequired:
        true,

      automaticChallengeBypass:
        false,

      credentialPersistence:
        false,

      otpPersistence:
        false,

      cookiePersistence:
        false,
    },
  });
}