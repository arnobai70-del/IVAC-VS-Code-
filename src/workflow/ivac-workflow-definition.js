import {
  validateIvacWorkflowPolicy,
} from './ivac-workflow-policy.js';

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

function createDefinition({
  name,
  steps,
  enabled = false,
}) {
  const workflow = {
    version:
      1,

    name:
      requireString(
        name,
        'workflow name',
      ),

    enabled:
      Boolean(
        enabled,
      ),

    steps:
      Array.isArray(
        steps,
      )
        ? steps
        : [],
  };

  validateIvacWorkflowPolicy(
    workflow,
  );

  return workflow;
}

export function createDisabledIvacWorkflowDefinition() {
  return createDefinition({
    name:
      'ivac-target-workflow',

    enabled:
      false,

    steps:
      [],
  });
}

export function createIvacWorkflowDefinition({
  steps,
}) {
  return createDefinition({
    name:
      'ivac-target-workflow',

    enabled:
      true,

    steps,
  });
}

export function validateIvacWorkflowDefinition(
  workflow,
) {
  validateIvacWorkflowPolicy(
    workflow,
  );

  return workflow;
}