import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getIvacWorkflowCapabilities,
  validateIvacWorkflowPolicy,
} from '../src/workflow/ivac-workflow-policy.js';

test(
  'IVAC workflow policy accepts supported step types',
  () => {
    const workflow = {
      version:
        1,

      name:
        'ivac-test',

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
            'wait',

          type:
            'otp.wait',
        },
      ],
    };

    assert.equal(
      validateIvacWorkflowPolicy(
        workflow,
      ),
      true,
    );
  },
);

test(
  'IVAC workflow policy blocks unsupported step types',
  () => {
    assert.throws(
      () => {
        validateIvacWorkflowPolicy({
          version:
            1,

          name:
            'invalid',

          enabled:
            true,

          steps: [
            {
              id:
                'captcha',

              type:
                'captcha.solve',
            },
          ],
        });
      },
      /Unsupported IVAC workflow step type/,
    );
  },
);

test(
  'IVAC workflow policy blocks forbidden automation patterns',
  () => {
    assert.throws(
      () => {
        validateIvacWorkflowPolicy({
          version:
            1,

          name:
            'invalid',

          enabled:
            true,

          steps: [
            {
              id:
                'challenge-bypass',

              type:
                'http',

              route:
                'safe-route',
            },
          ],
        });
      },
      /Forbidden workflow pattern/,
    );
  },
);

test(
  'IVAC workflow capabilities remain fail-closed',
  () => {
    const capabilities =
      getIvacWorkflowCapabilities();

    assert.equal(
      capabilities.manualChallenge,
      'required',
    );

    assert.equal(
      capabilities.automaticChallengeBypass,
      false,
    );

    assert.equal(
      capabilities.credentialPersistence,
      false,
    );

    assert.equal(
      capabilities.otpPersistence,
      false,
    );
  },
);