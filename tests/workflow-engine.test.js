import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
  ManualChallengeRequiredError,
} from '../src/core/errors.js';

import {
  WorkflowEngine,
} from '../src/workflow/engine.js';

function createJobContext({
  input = {},
  responses = {},
  currentStep = null,
} = {}) {
  return {
    input,

    job: {
      id:
        'job-1',

      applicationId:
        'app-1',

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
        '203.0.113.99',

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
        '203.0.113.99',

      port:
        8080,
    },

    responses: {
      ...responses,
    },

    otp: {},

    otpWatch:
      null,

    currentStep,

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
      ] = value;
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

    clearOtp() {
      this.otp = {};
    },

    setOtp(
      value,
    ) {
      this.otp = {
        ...value,
      };
    },
  };
}

function createUnusedOtpService() {
  return {
    async prepareForJobContext() {
      throw new Error(
        'unused',
      );
    },

    async waitForJobContext() {
      throw new Error(
        'unused',
      );
    },
  };
}

function createGetStep(
  id,
) {
  return {
    id,

    type:
      'http',

    method:
      'GET',

    route:
      id,

    headers: {},

    expect: {
      statuses: [
        200,
      ],

      response:
        'json',
    },
  };
}

test(
  'HTTP workflow responses can safely feed later step templates',
  async () => {
    const requests = [];

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep(
            request,
          ) {
            requests.push(
              request,
            );

            if (
              request.stepId
              === 'login'
            ) {
              return {
                statusCode:
                  200,

                data: {
                  token:
                    'server-token',
                },
              };
            }

            assert.equal(
              request.headers
                .Authorization,
              'Bearer server-token',
            );

            return {
              statusCode:
                200,

              data: {
                ok:
                  true,
              },
            };
          },
        },
      });

    const context =
      createJobContext({
        input: {
          phone:
            '01700000000',

          password:
            'secret-password',
        },
      });

    const result =
      await engine.execute({
        jobContext:
          context,

        workflow: {
          version:
            1,

          name:
            'template-chain',

          enabled:
            true,

          steps: [
            {
              id:
                'login',

              type:
                'http',

              method:
                'POST',

              route:
                'login',

              headers: {
                Accept:
                  'application/json',
              },

              body: {
                phone:
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
                'authenticated',

              type:
                'http',

              method:
                'GET',

              route:
                'authenticated',

              headers: {
                Authorization:
                  'Bearer {{responses.login.data.token}}',
              },

              expect: {
                statuses: [
                  200,
                ],

                response:
                  'json',
              },
            },
          ],
        },
      });

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      result.completedSteps,
      2,
    );

    assert.equal(
      requests.length,
      2,
    );

    assert.equal(
      context.currentStep,
      null,
    );
  },
);

test(
  'OTP prepare and wait hooks make OTP available only through otp context',
  async () => {
    const requests = [];

    const otpService = {
      async prepareForJobContext({
        jobContext,
        phone,
      }) {
        const watch = {
          watchId:
            'watch-1',

          phone,

          capturedAt:
            '2026-09-22T00:00:00.000Z',

          baselineFingerprints: [
            'old-row',
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
            '2026-09-22 00:01:00',

          matchedAt:
            '2026-09-22T00:01:01.000Z',

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

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService,

        targetHttpClient: {
          async requestStep(
            request,
          ) {
            requests.push(
              request,
            );

            return {
              statusCode:
                200,

              data: {
                ok:
                  true,
              },
            };
          },
        },
      });

    const context =
      createJobContext({
        input: {
          phone:
            '01700000000',
        },
      });

    await engine.execute({
      jobContext:
        context,

      workflow: {
        version:
          1,

        name:
          'otp-flow',

        enabled:
          true,

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
              'request_otp',

            type:
              'http',

            method:
              'POST',

            route:
              'request-otp',

            headers: {
              Accept:
                'application/json',
            },

            body: {
              phone:
                '{{input.phone}}',
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
              'submit_otp',

            type:
              'http',

            method:
              'POST',

            route:
              'submit-otp',

            headers: {
              Accept:
                'application/json',
            },

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
        ],
      },
    });

    assert.equal(
      requests.length,
      2,
    );

    assert.equal(
      requests[1]
        .body.otp,
      '654321',
    );

    assert.equal(
      context.responses
        .wait_otp.code,
      undefined,
    );

    assert.equal(
      context.otp.code,
      '654321',
    );
  },
);

test(
  'manual challenge stops workflow immediately and later steps never execute',
  async () => {
    let calls =
      0;

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep() {
            calls +=
              1;

            throw new ManualChallengeRequiredError(
              'challenge',
            );
          },
        },
      });

    const context =
      createJobContext();

    await assert.rejects(
      () =>
        engine.execute({
          jobContext:
            context,

          workflow: {
            version:
              1,

            name:
              'challenge-stop',

            enabled:
              true,

            steps: [
              createGetStep(
                'first',
              ),

              createGetStep(
                'must_not_run',
              ),
            ],
          },
        }),

      (error) =>
        error.code
        === ERROR_CODES
          .MANUAL_CHALLENGE_REQUIRED,
    );

    assert.equal(
      calls,
      1,
    );

    assert.equal(
      context.currentStep,
      'first',
    );

    assert.equal(
      context.hasResponse(
        'first',
      ),
      false,
    );
  },
);

test(
  'resume skips completed prefix and re-attempts only the first incomplete step onward',
  async () => {
    const requests = [];

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep(
            request,
          ) {
            requests.push(
              request,
            );

            return {
              statusCode:
                200,

              data: {
                step:
                  request.stepId,
              },
            };
          },
        },
      });

    const context =
      createJobContext({
        responses: {
          first: {
            statusCode:
              200,

            data: {
              already:
                'completed',
            },
          },
        },

        currentStep:
          'second',
      });

    const result =
      await engine.execute({
        jobContext:
          context,

        workflow: {
          version:
            1,

          name:
            'resume-prefix',

          enabled:
            true,

          steps: [
            createGetStep(
              'first',
            ),

            createGetStep(
              'second',
            ),

            createGetStep(
              'third',
            ),
          ],
        },
      });

    assert.deepEqual(
      requests.map(
        (request) =>
          request.stepId,
      ),
      [
        'second',
        'third',
      ],
    );

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      result.completedSteps,
      3,
    );

    assert.equal(
      context.currentStep,
      null,
    );

    assert.equal(
      context.responses
        .first
        .data
        .already,
      'completed',
    );
  },
);

test(
  'challenged current step is re-attempted while earlier completed step is not replayed',
  async () => {
    const requests = [];

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep(
            request,
          ) {
            requests.push(
              request.stepId,
            );

            return {
              statusCode:
                200,

              data: {
                ok:
                  true,
              },
            };
          },
        },
      });

    const context =
      createJobContext({
        responses: {
          login: {
            statusCode:
              200,

            data: {
              token:
                'existing-token',
            },
          },
        },

        currentStep:
          'challenge_step',
      });

    const result =
      await engine.execute({
        jobContext:
          context,

        workflow: {
          version:
            1,

          name:
            'challenge-resume',

          enabled:
            true,

          steps: [
            createGetStep(
              'login',
            ),

            createGetStep(
              'challenge_step',
            ),

            createGetStep(
              'after_challenge',
            ),
          ],
        },
      });

    assert.deepEqual(
      requests,
      [
        'challenge_step',
        'after_challenge',
      ],
    );

    assert.equal(
      result.completedSteps,
      3,
    );

    assert.equal(
      context.currentStep,
      null,
    );
  },
);

test(
  'fully completed workflow does not replay any step',
  async () => {
    let requestCalls =
      0;

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep() {
            requestCalls +=
              1;

            throw new Error(
              'completed step must not replay',
            );
          },
        },
      });

    const context =
      createJobContext({
        responses: {
          first: {
            statusCode:
              200,
          },

          second: {
            statusCode:
              200,
          },
        },

        currentStep:
          null,
      });

    const result =
      await engine.execute({
        jobContext:
          context,

        workflow: {
          version:
            1,

          name:
            'already-completed',

          enabled:
            true,

          steps: [
            createGetStep(
              'first',
            ),

            createGetStep(
              'second',
            ),
          ],
        },
      });

    assert.equal(
      requestCalls,
      0,
    );

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      result.completedSteps,
      2,
    );

    assert.equal(
      context.currentStep,
      null,
    );
  },
);

test(
  'non-contiguous completed response state fails closed before network execution',
  async () => {
    let requestCalls =
      0;

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep() {
            requestCalls +=
              1;

            return {
              statusCode:
                200,
            };
          },
        },
      });

    const context =
      createJobContext({
        responses: {
          first: {
            statusCode:
              200,
          },

          third: {
            statusCode:
              200,
          },
        },

        currentStep:
          'second',
      });

    await assert.rejects(
      () =>
        engine.execute({
          jobContext:
            context,

          workflow: {
            version:
              1,

            name:
              'invalid-resume-gap',

            enabled:
              true,

            steps: [
              createGetStep(
                'first',
              ),

              createGetStep(
                'second',
              ),

              createGetStep(
                'third',
              ),
            ],
          },
        }),

      /non-contiguous completed steps/,
    );

    assert.equal(
      requestCalls,
      0,
    );
  },
);

test(
  'resume state fails closed when current step does not match first incomplete step',
  async () => {
    let requestCalls =
      0;

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createUnusedOtpService(),

        targetHttpClient: {
          async requestStep() {
            requestCalls +=
              1;

            return {
              statusCode:
                200,
            };
          },
        },
      });

    const context =
      createJobContext({
        responses: {
          first: {
            statusCode:
              200,
          },
        },

        currentStep:
          'third',
      });

    await assert.rejects(
      () =>
        engine.execute({
          jobContext:
            context,

          workflow: {
            version:
              1,

            name:
              'mismatched-current-step',

            enabled:
              true,

            steps: [
              createGetStep(
                'first',
              ),

              createGetStep(
                'second',
              ),

              createGetStep(
                'third',
              ),
            ],
          },
        }),

      /resume state does not match the current step/,
    );

    assert.equal(
      requestCalls,
      0,
    );
  },
);

test(
  'disabled workflow cannot execute',
  async () => {
    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService: {
          async prepareForJobContext() {},

          async waitForJobContext() {},
        },

        targetHttpClient: {
          async requestStep() {
            throw new Error(
              'must not run',
            );
          },
        },
      });

    await assert.rejects(
      () =>
        engine.execute({
          jobContext:
            createJobContext(),

          workflow: {
            version:
              1,

            name:
              'disabled',

            enabled:
              false,

            steps: [],
          },
        }),

      (error) =>
        error.code
        === ERROR_CODES
          .WORKFLOW_CONFIG_ERROR,
    );
  },
);