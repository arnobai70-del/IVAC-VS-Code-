import assert from 'node:assert/strict';

import test from 'node:test';

import {
  createIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';

import {
  createIvacAuthWorkflow,
} from '../src/workflow/ivac-auth-workflow.js';

import {
  assertIvacWorkflowContractReady,
} from '../src/workflow/ivac-workflow-contract.js';

import {
  WorkflowEngine,
} from '../src/workflow/engine.js';


function createAuthContract() {
  return createIvacTargetContract({
    verified:
      true,

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
  });
}


function createJobContext() {
  return {
    input: {
      phone:
        '01700000000',

      password:
        'test-password',
    },

    job: {
      id:
        'job-1',

      applicationId:
        'application-1',

      userId:
        'user-1',
    },

    allocation: {
      allocationId:
        'allocation-1',

      jobId:
        'job-1',

      proxyId:
        'proxy-1',

      ip:
        '192.0.2.10',

      port:
        8080,
    },

    session: {
      sessionId:
        'session-1',

      jobId:
        'job-1',

      allocationId:
        'allocation-1',

      proxyId:
        'proxy-1',

      assignedIp:
        '192.0.2.10',

      port:
        8080,
    },

    runtime: {
      deviceId:
        'AbCdEfGhIjKlMnOpQr12',
    },

    responses: {},

    otp: {},

    otpWatch:
      null,

    currentStep:
      null,

    setCurrentStep(
      value,
    ) {
      this.currentStep =
        value;
    },

    setResponse(
      stepId,
      value,
    ) {
      this.responses[
        stepId
      ] =
        value;
    },

    hasResponse(
      stepId,
    ) {
      return Object.prototype
        .hasOwnProperty
        .call(
          this.responses,
          stepId,
        );
    },

    getResponse(
      stepId,
    ) {
      return this.responses[
        stepId
      ];
    },

    setOtpWatch(
      value,
    ) {
      this.otpWatch =
        value;
    },

    clearOtpWatch() {
      this.otpWatch =
        null;
    },

    setOtp(
      value,
    ) {
      this.otp = {
        ...value,
      };
    },

    clearOtp() {
      this.otp = {};
    },
  };
}


test(
  'IVAC auth workflow preserves evidenced step order and exact request definitions',
  () => {
    const workflow =
      createIvacAuthWorkflow();

    assert.equal(
      workflow.version,
      1,
    );

    assert.equal(
      workflow.name,
      'ivac-target-workflow',
    );

    assert.equal(
      workflow.enabled,
      true,
    );

    assert.deepEqual(
      workflow.steps.map(
        (step) =>
          step.id,
      ),
      [
        'prepare_signin_otp',
        'sign_in',
        'wait_signin_otp',
        'verify_signin_otp',
      ],
    );

    const prepare =
      workflow.steps[0];

    assert.equal(
      prepare.type,
      'otp.prepare',
    );

    assert.equal(
      prepare.phone,
      '{{input.phone}}',
    );


    const signIn =
      workflow.steps[1];

    assert.equal(
      signIn.type,
      'http',
    );

    assert.equal(
      signIn.method,
      'POST',
    );

    assert.equal(
      signIn.route,
      '/auth/sign-in-v2',
    );

    assert.deepEqual(
      signIn.body,
      {
        phone:
          '{{input.phone}}',

        password:
          '{{input.password}}',
      },
    );

    assert.equal(
      signIn.headers[
        'x-device-id'
      ],
      '{{runtime.deviceId}}',
    );

    assert.equal(
      signIn.headers[
        'Content-Type'
      ],
      'application/json',
    );


    const wait =
      workflow.steps[2];

    assert.equal(
      wait.type,
      'otp.wait',
    );


    const verify =
      workflow.steps[3];

    assert.equal(
      verify.type,
      'http',
    );

    assert.equal(
      verify.method,
      'POST',
    );

    assert.equal(
      verify.route,
      '/otp/verifySigninOtp',
    );

    assert.equal(
      verify.headers.Authorization,
      'Bearer {{responses.sign_in.data.data.accessToken}}',
    );

    assert.deepEqual(
      verify.body,
      {
        requestId:
          '{{responses.sign_in.data.data.requestId}}',

        phone:
          '{{input.phone}}',

        code:
          '{{otp.code}}',

        otpChannel:
          'PHONE',
      },
    );
  },
);


test(
  'IVAC auth workflow requires only the exact evidenced target contract routes',
  () => {
    const workflow =
      createIvacAuthWorkflow();

    const result =
      assertIvacWorkflowContractReady({
        workflow,

        contract:
          createAuthContract(),
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


test(
  'IVAC auth workflow renders device ID, access token, request ID, and fresh OTP correctly',
  async () => {
    const requests =
      [];

    const otpService = {
      async prepareForJobContext({
        jobContext,
        phone,
      }) {
        assert.equal(
          phone,
          '01700000000',
        );

        const watch = {
          watchId:
            'watch-1',

          phone,

          capturedAt:
            '2026-09-23T00:00:00.000Z',

          baselineFingerprints: [
            'existing-otp-row',
          ],
        };

        jobContext.setOtpWatch(
          watch,
        );

        jobContext.clearOtp();

        return watch;
      },

      async waitForJobContext({
        jobContext,
      }) {
        const result = {
          code:
            '654321',

          createdAt:
            '2026-09-23 00:00:10',

          matchedAt:
            '2026-09-23T00:00:11.000Z',

          polls:
            2,
        };

        jobContext.setOtp({
          code:
            result.code,

          createdAt:
            result.createdAt,

          matchedAt:
            result.matchedAt,

          watchId:
            'watch-1',
        });

        jobContext.clearOtpWatch();

        return result;
      },
    };

    const targetHttpClient = {
      async requestStep(
        request,
      ) {
        requests.push(
          request,
        );

        if (
          request.stepId
          === 'sign_in'
        ) {
          assert.equal(
            request.method,
            'POST',
          );

          assert.equal(
            request.route,
            '/auth/sign-in-v2',
          );

          assert.equal(
            request.headers[
              'x-device-id'
            ],
            'AbCdEfGhIjKlMnOpQr12',
          );

          assert.deepEqual(
            request.body,
            {
              phone:
                '01700000000',

              password:
                'test-password',
            },
          );

          return {
            statusCode:
              200,

            data: {
              data: {
                accessToken:
                  'access-token-1',

                requestId:
                  'request-id-1',
              },
            },
          };
        }

        if (
          request.stepId
          === 'verify_signin_otp'
        ) {
          assert.equal(
            request.method,
            'POST',
          );

          assert.equal(
            request.route,
            '/otp/verifySigninOtp',
          );

          assert.equal(
            request.headers.Authorization,
            'Bearer access-token-1',
          );

          assert.deepEqual(
            request.body,
            {
              requestId:
                'request-id-1',

              phone:
                '01700000000',

              code:
                '654321',

              otpChannel:
                'PHONE',
            },
          );

          return {
            statusCode:
              200,

            data: {
              success:
                true,
            },
          };
        }

        throw new Error(
          `Unexpected target request: ${request.stepId}`,
        );
      },
    };

    const engine =
      new WorkflowEngine({
        targetHttpClient,

        otpService,

        maxSteps:
          10,
      });

    const jobContext =
      createJobContext();

    const result =
      await engine.execute({
        workflow:
          createIvacAuthWorkflow(),

        jobContext,
      });

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      result.completedSteps,
      4,
    );

    assert.deepEqual(
      requests.map(
        (request) =>
          request.stepId,
      ),
      [
        'sign_in',
        'verify_signin_otp',
      ],
    );

    /*
     * OTP step result deliberately excludes the OTP value.
     * The code remains only inside memory-only otp context.
     */
    assert.equal(
      jobContext.responses
        .wait_signin_otp
        .code,
      undefined,
    );

    assert.equal(
      jobContext.otp.code,
      '654321',
    );

    assert.equal(
      jobContext.currentStep,
      null,
    );
  },
);


test(
  'IVAC auth workflow contains no automatic human-verification bypass step',
  () => {
    const workflow =
      createIvacAuthWorkflow();

    const serialized =
      JSON.stringify(
        workflow,
      )
        .toLowerCase();

    for (
      const forbidden
      of [
        'captcha',
        'recaptcha',
        'hcaptcha',
        'turnstile',
        'cloudflare',
        'bypass',
      ]
    ) {
      assert.equal(
        serialized.includes(
          forbidden,
        ),
        false,
      );
    }
  },
);