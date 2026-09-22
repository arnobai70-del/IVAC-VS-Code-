import assert from 'node:assert/strict';

import test from 'node:test';

import {
  JobContext,
} from '../src/jobs/job-context.js';

import {
  WorkflowEngine,
} from '../src/workflow/engine.js';


function createJobContext() {
  const job = {
    id:
      'job-1',

    applicationId:
      'application-1',

    userId:
      'user-1',
  };

  const allocation = {
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
  };

  const dispatcher = {};

  const cookieJar = {};

  const session = {
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

    dispatcher,

    cookieJar,

    closed:
      false,
  };

  return new JobContext({
    job,
    allocation,
    dispatcher,
    cookieJar,
    session,

    input: {
      phone:
        '01700000000',

      password:
        'safe-test-password',
    },
  });
}


function createOtpService() {
  return {
    async prepareForJobContext() {
      throw new Error(
        'OTP service must not be used by this test.',
      );
    },

    async waitForJobContext() {
      throw new Error(
        'OTP service must not be used by this test.',
      );
    },
  };
}


function createSignInWorkflow(
  headers,
) {
  return {
    version:
      1,

    name:
      'ivac-device-id-test',

    enabled:
      true,

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

        headers,

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
    ],
  };
}


test(
  'JobContext creates one memory-only 20-character device ID',
  () => {
    const context =
      createJobContext();

    const first =
      context.runtime.deviceId;

    const second =
      context.runtime.deviceId;

    assert.equal(
      typeof first,
      'string',
    );

    assert.equal(
      first.length,
      20,
    );

    assert.match(
      first,
      /^[A-Za-z0-9]{20}$/,
    );

    assert.equal(
      second,
      first,
    );

    assert.equal(
      Object.isFrozen(
        context.runtime,
      ),
      true,
    );
  },
);


test(
  'workflow renders the same JobContext device ID into x-device-id header',
  async () => {
    const context =
      createJobContext();

    const requests =
      [];

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createOtpService(),

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

    const result =
      await engine.execute({
        workflow:
          createSignInWorkflow({
            Accept:
              'application/json',

            'x-device-id':
              '{{runtime.deviceId}}',
          }),

        jobContext:
          context,
      });

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      requests.length,
      1,
    );

    assert.equal(
      requests[0]
        .headers[
          'x-device-id'
        ],
      context.runtime.deviceId,
    );

    assert.match(
      requests[0]
        .headers[
          'x-device-id'
        ],
      /^[A-Za-z0-9]{20}$/,
    );
  },
);


test(
  'runtime device ID remains stable across multiple workflow requests in one JobContext',
  async () => {
    const context =
      createJobContext();

    const receivedDeviceIds =
      [];

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createOtpService(),

        targetHttpClient: {
          async requestStep(
            request,
          ) {
            receivedDeviceIds.push(
              request.headers[
                'x-device-id'
              ],
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

    await engine.execute({
      jobContext:
        context,

      workflow: {
        version:
          1,

        name:
          'stable-device-id',

        enabled:
          true,

        steps: [
          {
            id:
              'first',

            type:
              'http',

            method:
              'POST',

            route:
              '/auth/sign-in-v2',

            headers: {
              'x-device-id':
                '{{runtime.deviceId}}',
            },

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
              'second',

            type:
              'http',

            method:
              'POST',

            route:
              '/otp/verifySigninOtp',

            headers: {
              'x-device-id':
                '{{runtime.deviceId}}',
            },

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
      },
    });

    assert.equal(
      receivedDeviceIds.length,
      2,
    );

    assert.equal(
      receivedDeviceIds[0],
      context.runtime.deviceId,
    );

    assert.equal(
      receivedDeviceIds[1],
      context.runtime.deviceId,
    );

    assert.equal(
      receivedDeviceIds[0],
      receivedDeviceIds[1],
    );
  },
);


test(
  'workflow cannot access arbitrary non-allowlisted runtime metadata',
  async () => {
    const context =
      createJobContext();

    /*
     * Even if unrelated data is attached elsewhere on the
     * JobContext, createTemplateContext() projects only
     * runtime.deviceId into the workflow template context.
     */
    context.internalRuntimeSecret =
      'must-not-be-visible';

    let requestCalls =
      0;

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createOtpService(),

        targetHttpClient: {
          async requestStep() {
            requestCalls +=
              1;

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

    await assert.rejects(
      () =>
        engine.execute({
          jobContext:
            context,

          workflow:
            createSignInWorkflow({
              'x-device-id':
                '{{runtime.internalRuntimeSecret}}',
            }),
        }),

      /Template value is missing: runtime\.internalRuntimeSecret/,
    );

    assert.equal(
      requestCalls,
      0,
    );
  },
);