import {
  readFileSync,
} from 'node:fs';

import {
  WorkflowConfigError,
} from '../core/errors.js';

import {
  formatWorkflowIssues,
  validateWorkflowDefinition,
} from './schema.js';

function deepFreeze(
  value,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

export function loadWorkflowDefinition({
  filePath,
  maxSteps,
}) {
  let raw;

  try {
    raw =
      readFileSync(
        filePath,
        'utf8',
      );
  } catch (error) {
    throw new WorkflowConfigError(
      `Unable to read workflow file: ${filePath}`,
      {
        cause: error,
      },
    );
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new WorkflowConfigError(
      `Workflow file contains invalid JSON: ${filePath}`,
      {
        cause: error,
      },
    );
  }

  let workflow;

  try {
    workflow =
      validateWorkflowDefinition(
        parsed,
      );
  } catch (error) {
    throw new WorkflowConfigError(
      'Workflow definition failed validation.',
      {
        cause: error,

        details:
          formatWorkflowIssues(
            error,
          ),
      },
    );
  }

  if (
    workflow.steps.length
    > maxSteps
  ) {
    throw new WorkflowConfigError(
      `Workflow contains ${workflow.steps.length} steps but the configured maximum is ${maxSteps}.`,
    );
  }

  return deepFreeze(
    workflow,
  );
}