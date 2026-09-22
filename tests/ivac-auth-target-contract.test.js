import assert from 'node:assert/strict';

import test from 'node:test';

import {
  createVerifiedIvacAuthTargetContract,
  getVerifiedIvacAuthEndpoints,
} from '../src/contracts/ivac-auth-target-contract.js';

import {
  getIvacTargetContractSummary,
  validateIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';

import {
  createIvacAuthWorkflow,
} from '../src/workflow/ivac-auth-workflow.js';

import {
  assertIvacWorkflowContractReady,
} from '../src/workflow/ivac-workflow-contract.js';


test(
  'verified IVAC auth contract contains only the two evidenced auth routes',
  () => {
    const contract =
      createVerifiedIvacAuthTargetContract();

    assert.equal(
      contract.version,
      1,
    );

    assert.equal(
      contract.status,
      'VERIFIED',
    );

    assert.equal(
      contract.verified,
      true,
    );

    assert.deepEqual(
      contract.endpoints,
      [
        {
          name:
            'sign-in',

          method:
            'POST',

          path:
            '/auth/sign-in-v2',

          verified:
            true,
        },

        {
          name:
            'verify-signin-otp',

          method:
            'POST',

          path:
            '/otp/verifySigninOtp',

          verified:
            true,
        },
      ],
    );

    assert.equal(
      validateIvacTargetContract(
        contract,
      ),
      true,
    );
  },
);


test(
  'auth target contract summary remains bounded and contains no unrelated routes',
  () => {
    const contract =
      createVerifiedIvacAuthTargetContract();

    const summary =
      getIvacTargetContractSummary(
        contract,
      );

    assert.deepEqual(
      summary,
      {
        version:
          1,

        status:
          'VERIFIED',

        verified:
          true,

        endpointCount:
          2,

        endpoints: [
          {
            name:
              'sign-in',

            method:
              'POST',

            path:
              '/auth/sign-in-v2',

            verified:
              true,
          },

          {
            name:
              'verify-signin-otp',

            method:
              'POST',

            path:
              '/otp/verifySigninOtp',

            verified:
              true,
          },
        ],
      },
    );

    const paths =
      summary.endpoints.map(
        (endpoint) =>
          endpoint.path,
      );

    assert.equal(
      paths.includes(
        '/appointment',
      ),
      false,
    );

    assert.equal(
      paths.includes(
        '/slots/reserveSlot',
      ),
      false,
    );

    assert.equal(
      paths.includes(
        '/file/upload-file',
      ),
      false,
    );

    assert.equal(
      paths.includes(
        '/payment/dg-epay/initiate',
      ),
      false,
    );
  },
);


test(
  'returned auth endpoint metadata is a clone and cannot mutate contract source definitions',
  () => {
    const first =
      getVerifiedIvacAuthEndpoints();

    assert.equal(
      first.length,
      2,
    );

    first[0].method =
      'GET';

    first[0].path =
      '/changed';

    first.push({
      name:
        'invented',

      method:
        'DELETE',

      path:
        '/invented',

      verified:
        true,
    });

    const second =
      getVerifiedIvacAuthEndpoints();

    assert.deepEqual(
      second,
      [
        {
          name:
            'sign-in',

          method:
            'POST',

          path:
            '/auth/sign-in-v2',

          verified:
            true,
        },

        {
          name:
            'verify-signin-otp',

          method:
            'POST',

          path:
            '/otp/verifySigninOtp',

          verified:
            true,
        },
      ],
    );

    const contract =
      createVerifiedIvacAuthTargetContract();

    assert.equal(
      contract.endpoints.length,
      2,
    );

    assert.equal(
      contract.endpoints[0]
        .method,
      'POST',
    );

    assert.equal(
      contract.endpoints[0]
        .path,
      '/auth/sign-in-v2',
    );
  },
);


test(
  'verified auth target contract exactly satisfies IVAC auth workflow preflight',
  () => {
    const workflow =
      createIvacAuthWorkflow();

    const contract =
      createVerifiedIvacAuthTargetContract();

    const result =
      assertIvacWorkflowContractReady({
        workflow,
        contract,
      });

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.requiredEndpointCount,
      2,
    );

    assert.deepEqual(
      result.requiredEndpoints,
      [
        {
          stepId:
            'sign_in',

          method:
            'POST',

          path:
            '/auth/sign-in-v2',
        },

        {
          stepId:
            'verify_signin_otp',

          method:
            'POST',

          path:
            '/otp/verifySigninOtp',
        },
      ],
    );
  },
);