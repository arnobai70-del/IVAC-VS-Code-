import assert from 'node:assert/strict';

import {
  readFileSync,
} from 'node:fs';

import {
  dirname,
  resolve,
} from 'node:path';

import test from 'node:test';

import {
  fileURLToPath,
} from 'node:url';

import {
  createVerifiedIvacAuthTargetContract,
} from '../src/contracts/ivac-auth-target-contract.js';

import {
  createUnverifiedIvacTargetContract,
  getIvacTargetContractSummary,
} from '../src/contracts/ivac-target-contract.js';

import {
  createJobWorkflowExecutor,
} from '../src/runtime/job-workflow-executor.js';


const testDirectory =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const projectRoot =
  resolve(
    testDirectory,
    '..',
  );


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


function createWorkflow() {
  return {
    name:
      'bootstrap-contract-test',

    version:
      1,

    enabled:
      false,

    steps:
      [],
  };
}


function createTargetConfig() {
  return {
    baseUrl:
      'https://target.example/api/v1',

    timeoutMs:
      15000,
  };
}


function createOtpConfig() {
  return {
    baseUrl:
      'https://otp.example',

    tablePath:
      '/otp_table',

    pollIntervalMs:
      3000,

    timeoutMs:
      120000,

    maxResponseBytes:
      2097152,

    maxRows:
      5000,

    tableSelector:
      'table',

    columns: {
      phone:
        'Phone Number',

      code:
        'OTP',

      createdAt:
        'Created At',
    },
  };
}


function createExecutorOptions() {
  return {
    session:
      createSession(),

    workflow:
      createWorkflow(),

    targetConfig:
      createTargetConfig(),

    otpConfig:
      createOtpConfig(),

    maxSteps:
      100,
  };
}


test(
  'unverified target contract helper remains empty and fail-closed',
  () => {
    const contract =
      createUnverifiedIvacTargetContract();

    const summary =
      getIvacTargetContractSummary(
        contract,
      );

    assert.equal(
      contract.verified,
      false,
    );

    assert.equal(
      contract.status,
      'UNVERIFIED',
    );

    assert.deepEqual(
      contract.endpoints,
      [],
    );

    assert.equal(
      Object.isFrozen(
        contract,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        contract.endpoints,
      ),
      true,
    );

    assert.deepEqual(
      summary,
      {
        version:
          1,

        status:
          'UNVERIFIED',

        verified:
          false,

        endpointCount:
          0,

        endpoints:
          [],
      },
    );
  },
);


test(
  'Phase 29 bootstrap auth contract contains only verified authentication routes',
  () => {
    const contract =
      createVerifiedIvacAuthTargetContract();

    assert.equal(
      contract.status,
      'VERIFIED',
    );

    assert.equal(
      contract.verified,
      true,
    );

    assert.equal(
      contract.endpoints.length,
      2,
    );

    assert.deepEqual(
      contract.endpoints.map(
        (endpoint) => ({
          method:
            endpoint.method,

          path:
            endpoint.path,
        }),
      ),
      [
        {
          method:
            'POST',

          path:
            '/auth/sign-in-v2',
        },

        {
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
  'job workflow executor fails closed when the target contract is missing',
  () => {
    assert.throws(
      () => {
        createJobWorkflowExecutor(
          createExecutorOptions(),
        );
      },

      /contract must be an object/,
    );
  },
);


test(
  'job workflow executor fails closed when the target contract is unverified',
  () => {
    assert.throws(
      () => {
        createJobWorkflowExecutor({
          ...createExecutorOptions(),

          contract:
            createUnverifiedIvacTargetContract(),
        });
      },

      /IVAC target contract is not verified/,
    );
  },
);


test(
  'verified auth target contract reaches TargetHttpClient unchanged',
  () => {
    const contract =
      createVerifiedIvacAuthTargetContract();

    const executor =
      createJobWorkflowExecutor({
        ...createExecutorOptions(),

        contract,
      });

    assert.equal(
      executor
        .targetHttpClient
        .contract,
      contract,
    );

    assert.equal(
      executor
        .targetHttpClient
        .contract
        .verified,
      true,
    );

    assert.deepEqual(
      executor
        .targetHttpClient
        .contract
        .endpoints,
      contract.endpoints,
    );
  },
);


test(
  'target route absent from verified auth contract fails before network execution',
  async () => {
    const executor =
      createJobWorkflowExecutor({
        ...createExecutorOptions(),

        contract:
          createVerifiedIvacAuthTargetContract(),
      });

    await assert.rejects(
      () =>
        executor
          .targetHttpClient
          .requestStep({
            stepId:
              'missing-route',

            method:
              'GET',

            route:
              '/not-in-contract',

            headers: {},

            expect: {
              statuses: [
                200,
              ],

              response:
                'json',
            },
          }),

      /Workflow route is not present in the verified IVAC target contract/,
    );
  },
);


test(
  'repository stores bounded auth workflow while activation defaults remain non-destructive',
  () => {
    const appConfig =
      JSON.parse(
        readFileSync(
          resolve(
            projectRoot,
            'config',
            'app.json',
          ),
          'utf8',
        ),
      );

    const workflowConfig =
      JSON.parse(
        readFileSync(
          resolve(
            projectRoot,
            'config',
            'workflow.json',
          ),
          'utf8',
        ),
      );

    assert.equal(
      appConfig.runtime
        .intakeEnabled,
      false,
    );

    assert.equal(
      appConfig.workflow
        .enabled,
      false,
    );

    assert.equal(
      appConfig.portal
        .result
        .enabled,
      false,
    );

    assert.equal(
      workflowConfig.enabled,
      false,
    );

    assert.equal(
      workflowConfig.steps.length,
      4,
    );

    assert.deepEqual(
      workflowConfig.steps.map(
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

    const signIn =
      workflowConfig.steps
        .find(
          (step) =>
            step.id
            === 'sign_in',
        );

    const verify =
      workflowConfig.steps
        .find(
          (step) =>
            step.id
            === 'verify_signin_otp',
        );

    assert.equal(
      signIn.method,
      'POST',
    );

    assert.equal(
      signIn.route,
      '/auth/sign-in-v2',
    );

    assert.equal(
      verify.method,
      'POST',
    );

    assert.equal(
      verify.route,
      '/otp/verifySigninOtp',
    );
  },
);


test(
  'application bootstrap uses Phase 31 proxy readiness with verified auth contract',
  () => {
    const source =
      readFileSync(
        resolve(
          projectRoot,
          'src',
          'index.js',
        ),
        'utf8',
      );

    /*
     * Phase 29 verified auth contract remains the only target
     * contract source used by bootstrap.
     */
    assert.equal(
      source.includes(
        'createVerifiedIvacAuthTargetContract',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'createUnverifiedIvacTargetContract',
      ),
      false,
    );

    /*
     * Phase 30 static destructive-runtime readiness remains wired.
     */
    assert.equal(
      source.includes(
        "from './runtime/runtime-readiness.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'assertDestructiveRuntimeReadiness',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'runtimeReadiness',
      ),
      true,
    );

    assert.match(
      source,
      /readiness:\s*runtimeReadiness/,
    );

    /*
     * Phase 31 adds bounded proxy/network readiness.
     */
    assert.equal(
      source.includes(
        "from './network/network-health.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'NetworkHealthService',
      ),
      true,
    );

    assert.equal(
      source.includes(
        "from './network/proxy-readiness.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'assertProxyReadinessForIntake',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'inspectProxyPoolReadiness',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'probeProxyReadiness',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'proxyReadiness',
      ),
      true,
    );

    /*
     * Safe startup inspects only. Destructive intake is the only
     * path allowed to invoke active proxy health probing.
     */
    assert.match(
      source,
      /config\.runtime\s*\.intakeEnabled\s*\?\s*await probeProxyReadiness/,
    );

    assert.match(
      source,
      /:\s*inspectProxyPoolReadiness/,
    );

    assert.match(
      source,
      /assertProxyReadinessForIntake/,
    );

    /*
     * Phase 31 readiness is surfaced from bootstrap.
     */
    assert.match(
      source,
      /phase:\s*31/,
    );

    assert.match(
      source,
      /proxyReadiness,/,
    );
  },
);