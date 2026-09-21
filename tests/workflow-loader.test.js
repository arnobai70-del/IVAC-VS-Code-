import assert from 'node:assert/strict';

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  loadWorkflowDefinition,
} from '../src/workflow/loader.js';

function writeWorkflow(
  directory,
  value,
) {
  const filePath =
    join(
      directory,
      'workflow.json',
    );

  writeFileSync(
    filePath,
    JSON.stringify(
      value,
      null,
      2,
    ),
    'utf8',
  );

  return filePath;
}

test('disabled empty workflow is valid before verified target routes are configured', () => {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-workflow-',
      ),
    );

  try {
    const filePath =
      writeWorkflow(
        directory,
        {
          version: 1,
          name:
            'safe-disabled',
          enabled: false,
          steps: [],
        },
      );

    const workflow =
      loadWorkflowDefinition({
        filePath,
        maxSteps: 10,
      });

    assert.equal(
      workflow.enabled,
      false,
    );

    assert.equal(
      workflow.steps.length,
      0,
    );
  } finally {
    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

test('enabled workflow cannot be empty', () => {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-workflow-',
      ),
    );

  try {
    const filePath =
      writeWorkflow(
        directory,
        {
          version: 1,
          name:
            'invalid-empty',
          enabled: true,
          steps: [],
        },
      );

    assert.throws(
      () => {
        loadWorkflowDefinition({
          filePath,
          maxSteps: 10,
        });
      },

      (error) =>
        error.code
        === ERROR_CODES
          .WORKFLOW_CONFIG_ERROR,
    );
  } finally {
    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

test('duplicate workflow step ids are rejected', () => {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-workflow-',
      ),
    );

  try {
    const filePath =
      writeWorkflow(
        directory,
        {
          version: 1,
          name:
            'duplicates',
          enabled: true,

          steps: [
            {
              id: 'same',
              type: 'otp.wait',
            },
            {
              id: 'same',
              type: 'otp.wait',
            },
          ],
        },
      );

    assert.throws(
      () => {
        loadWorkflowDefinition({
          filePath,
          maxSteps: 10,
        });
      },

      (error) =>
        error.code
        === ERROR_CODES
          .WORKFLOW_CONFIG_ERROR,
    );
  } finally {
    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

test('workflow max-step limit is enforced before execution', () => {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        'ivac-workflow-',
      ),
    );

  try {
    const filePath =
      writeWorkflow(
        directory,
        {
          version: 1,
          name:
            'too-many',
          enabled: true,

          steps: [
            {
              id: 'one',
              type: 'otp.wait',
            },
            {
              id: 'two',
              type: 'otp.wait',
            },
          ],
        },
      );

    assert.throws(
      () => {
        loadWorkflowDefinition({
          filePath,
          maxSteps: 1,
        });
      },

      (error) =>
        error.code
        === ERROR_CODES
          .WORKFLOW_CONFIG_ERROR,
    );
  } finally {
    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});