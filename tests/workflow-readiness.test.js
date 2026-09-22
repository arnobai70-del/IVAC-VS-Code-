import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectWorkflowReadiness,
} from '../src/workflow/workflow-readiness.js';

test('workflow readiness reports validated enabled workflow capabilities', () => {
  const result =
    inspectWorkflowReadiness({
      version:
        1,

      name:
        'ivac-target-workflow',

      enabled:
        true,

      steps: [
        {
          id:
            'prepare',

          type:
            'otp.prepare',
        },

        {
          id:
            'upload',

          type:
            'documents.upload',
        },
      ],
    });

  assert.equal(
    result.enabled,
    true,
  );

  assert.equal(
    result.stepCount,
    2,
  );

  assert.deepEqual(
    result.stepTypes,
    [
      'otp.prepare',
      'documents.upload',
    ],
  );

  assert.equal(
    result.executionReady,
    true,
  );

  assert.equal(
    result.boundaries.targetContractRequired,
    true,
  );
});


test('workflow readiness reports disabled workflow as not executable', () => {
  const result =
    inspectWorkflowReadiness({
      version:
        1,

      name:
        'ivac-target-workflow',

      enabled:
        false,

      steps: [],
    });

  assert.equal(
    result.enabled,
    false,
  );

  assert.equal(
    result.stepCount,
    0,
  );

  assert.equal(
    result.executionReady,
    false,
  );
});


test('workflow readiness rejects invalid workflow input', () => {
  assert.throws(
    () => {
      inspectWorkflowReadiness(
        null,
      );
    },

    {
      name:
        'TypeError',
    },
  );
});