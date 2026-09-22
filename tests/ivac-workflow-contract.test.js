import assert from 'node:assert/strict';

import test from 'node:test';

import {
  createIvacTargetContract,
  createUnverifiedIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';

import {
  assertIvacWorkflowContractReady,
  getIvacWorkflowTargetRequirements,
  inspectIvacWorkflowContract,
} from '../src/workflow/ivac-workflow-contract.js';


function createWorkflow({
  enabled = true,
  steps = [],
} = {}) {
  return {
    version:
      1,

    name:
      'ivac-target-workflow',

    enabled,

    steps,
  };
}


function createVerifiedContract(
  endpoints,
) {
  return createIvacTargetContract({
    verified:
      true,

    endpoints,
  });
}


test(
  'disabled workflow remains fail-closed without requiring production target routes',
  () => {
    const result =
      inspectIvacWorkflowContract({
        workflow:
          createWorkflow({
            enabled:
              false,

            steps:
              [],
          }),

        contract:
          createUnverifiedIvacTargetContract(),
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'WORKFLOW_DISABLED',
    );

    assert.equal(
      result.requiredEndpointCount,
      0,
    );

    assert.deepEqual(
      result.requiredEndpoints,
      [],
    );
  },
);


test(
  'enabled workflow rejects an unverified IVAC target contract',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'sign_in',

            type:
              'http',

            method:
              'POST',

            route:
              '/auth/sign-in-v2',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    assert.throws(
      () =>
        inspectIvacWorkflowContract({
          workflow,

          contract:
            createUnverifiedIvacTargetContract(),
        }),

      /requires a verified IVAC target contract/,
    );
  },
);


test(
  'workflow route must match exact verified HTTP method',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'sign_in',

            type:
              'http',

            method:
              'POST',

            route:
              '/auth/sign-in-v2',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    const contract =
      createVerifiedContract([
        {
          name:
            'sign-in-read-only',

          method:
            'GET',

          path:
            '/auth/sign-in-v2',

          verified:
            true,
        },
      ]);

    assert.throws(
      () =>
        inspectIvacWorkflowContract({
          workflow,
          contract,
        }),

      /requires unverified target route POST \/auth\/sign-in-v2/,
    );
  },
);


test(
  'workflow rejects a target path absent from verified contract',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'verify_otp',

            type:
              'http',

            method:
              'POST',

            route:
              '/otp/verifySigninOtp',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    const contract =
      createVerifiedContract([
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
      ]);

    assert.throws(
      () =>
        inspectIvacWorkflowContract({
          workflow,
          contract,
        }),

      /requires unverified target route POST \/otp\/verifySigninOtp/,
    );
  },
);


test(
  'documents.upload is preflight-verified as POST',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'upload_documents',

            type:
              'documents.upload',

            route:
              '/file/upload-file',

            fieldName:
              'file',

            headers: {},

            fields: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    const wrongMethodContract =
      createVerifiedContract([
        {
          name:
            'file-upload-wrong-method',

          method:
            'GET',

          path:
            '/file/upload-file',

          verified:
            true,
        },
      ]);

    assert.throws(
      () =>
        inspectIvacWorkflowContract({
          workflow,

          contract:
            wrongMethodContract,
        }),

      /requires unverified target route POST \/file\/upload-file/,
    );

    const validContract =
      createVerifiedContract([
        {
          name:
            'file-upload',

          method:
            'POST',

          path:
            '/file/upload-file',

          verified:
            true,
        },
      ]);

    const result =
      inspectIvacWorkflowContract({
        workflow,

        contract:
          validContract,
      });

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.requiredEndpointCount,
      1,
    );

    assert.deepEqual(
      result.requiredEndpoints,
      [
        {
          stepId:
            'upload_documents',

          method:
            'POST',

          path:
            '/file/upload-file',
        },
      ],
    );
  },
);


test(
  'dynamic target routes are rejected by startup preflight',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'dynamic_route',

            type:
              'http',

            method:
              'GET',

            route:
              '/ivac-centers/{{input.missionId}}',

            headers: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    const contract =
      createVerifiedContract([
        {
          name:
            'placeholder-route',

          method:
            'GET',

          path:
            '/ivac-centers/example',

          verified:
            true,
        },
      ]);

    assert.throws(
      () =>
        inspectIvacWorkflowContract({
          workflow,
          contract,
        }),

      /uses a dynamic target route that cannot be preflight-verified/,
    );
  },
);


test(
  'OTP and document preparation steps do not consume IVAC target routes',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'prepare_otp',

            type:
              'otp.prepare',

            phone:
              '{{input.phone}}',
          },

          {
            id:
              'wait_otp',

            type:
              'otp.wait',
          },

          {
            id:
              'prepare_documents',

            type:
              'documents.prepare',

            sources:
              '{{input.documents}}',
          },

          {
            id:
              'sign_in',

            type:
              'http',

            method:
              'POST',

            route:
              '/auth/sign-in-v2',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    const requirements =
      getIvacWorkflowTargetRequirements(
        workflow,
      );

    assert.deepEqual(
      requirements,
      [
        {
          stepId:
            'sign_in',

          method:
            'POST',

          path:
            '/auth/sign-in-v2',
        },
      ],
    );
  },
);


test(
  'fully verified static workflow passes target-contract preflight',
  () => {
    const workflow =
      createWorkflow({
        steps: [
          {
            id:
              'prepare_otp',

            type:
              'otp.prepare',

            phone:
              '{{input.phone}}',
          },

          {
            id:
              'sign_in',

            type:
              'http',

            method:
              'POST',

            route:
              '/auth/sign-in-v2',

            headers: {},

            body: {
              mobile:
                '{{input.phone}}',

              password:
                '{{input.password}}',
            },

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },

          {
            id:
              'wait_otp',

            type:
              'otp.wait',
          },

          {
            id:
              'verify_otp',

            type:
              'http',

            method:
              'POST',

            route:
              '/otp/verifySigninOtp',

            headers: {},

            body: {
              otp:
                '{{otp.code}}',
            },

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },

          {
            id:
              'appointment',

            type:
              'http',

            method:
              'POST',

            route:
              '/appointment',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },

          {
            id:
              'booking_config',

            type:
              'http',

            method:
              'POST',

            route:
              '/appointment/get-booking-config',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },

          {
            id:
              'reserve_slot',

            type:
              'http',

            method:
              'POST',

            route:
              '/slots/reserveSlot',

            headers: {},

            body: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          },
        ],
      });

    const contract =
      createVerifiedContract([
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

        {
          name:
            'appointment',

          method:
            'POST',

          path:
            '/appointment',

          verified:
            true,
        },

        {
          name:
            'booking-config',

          method:
            'POST',

          path:
            '/appointment/get-booking-config',

          verified:
            true,
        },

        {
          name:
            'reserve-slot',

          method:
            'POST',

          path:
            '/slots/reserveSlot',

          verified:
            true,
        },
      ]);

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
      5,
    );

    assert.deepEqual(
      result.requiredEndpoints.map(
        (endpoint) =>
          `${endpoint.method} ${endpoint.path}`,
      ),
      [
        'POST /auth/sign-in-v2',
        'POST /otp/verifySigninOtp',
        'POST /appointment',
        'POST /appointment/get-booking-config',
        'POST /slots/reserveSlot',
      ],
    );
  },
);