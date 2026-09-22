import assert from 'node:assert/strict';

import test from 'node:test';

import {
  createIvacTargetContract,
  createUnverifiedIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';

import {
  createJobWorkflowExecutor,
} from '../src/runtime/job-workflow-executor.js';


function createSession() {
  return {
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

    dispatcher: {},

    cookieJar: {
      getCookieHeader() {
        return null;
      },

      setCookies() {},

      clear() {},
    },

    closed:
      false,
  };
}


function createEnabledWorkflow({
  method = 'POST',
  route = '/auth/sign-in-v2',
} = {}) {
  return {
    version:
      1,

    name:
      'ivac-target-workflow',

    enabled:
      true,

    steps: [
      {
        id:
          'sign_in',

        type:
          'http',

        method,

        route,

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
  };
}


function createVerifiedContract({
  method = 'POST',
  path = '/auth/sign-in-v2',
} = {}) {
  return createIvacTargetContract({
    verified:
      true,

    endpoints: [
      {
        name:
          'sign-in',

        method,

        path,

        verified:
          true,
      },
    ],
  });
}


test(
  'enabled executor rejects unverified target contract before client configuration is evaluated',
  () => {
    assert.throws(
      () =>
        createJobWorkflowExecutor({
          session:
            createSession(),

          workflow:
            createEnabledWorkflow(),

          /*
           * Deliberately incomplete.
           *
           * If client construction happens before contract
           * preflight this would fail on target.baseUrl instead.
           */
          targetConfig: {},

          otpConfig: {},

          contract:
            createUnverifiedIvacTargetContract(),

          maxSteps:
            100,
        }),

      /Enabled IVAC workflow requires a verified IVAC target contract/,
    );
  },
);


test(
  'enabled executor rejects method-path mismatch before job clients are created',
  () => {
    assert.throws(
      () =>
        createJobWorkflowExecutor({
          session:
            createSession(),

          workflow:
            createEnabledWorkflow({
              method:
                'POST',

              route:
                '/auth/sign-in-v2',
            }),

          /*
           * These remain intentionally incomplete so the test
           * proves workflow-contract preflight executes first.
           */
          targetConfig: {},

          otpConfig: {},

          contract:
            createVerifiedContract({
              method:
                'GET',

              path:
                '/auth/sign-in-v2',
            }),

          maxSteps:
            100,
        }),

      /requires unverified target route POST \/auth\/sign-in-v2/,
    );
  },
);


test(
  'executor proceeds to client validation only after workflow contract preflight succeeds',
  () => {
    assert.throws(
      () =>
        createJobWorkflowExecutor({
          session:
            createSession(),

          workflow:
            createEnabledWorkflow(),

          /*
           * The workflow and contract match, so preflight should
           * succeed and construction should continue far enough to
           * validate the actual client configuration.
           */
          targetConfig: {},

          otpConfig: {},

          contract:
            createVerifiedContract(),

          maxSteps:
            100,
        }),

      /target\.baseUrl must be a non-empty string/,
    );
  },
);