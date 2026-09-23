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
  'application bootstrap uses Phase 39 release validation with existing readiness gates',
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
     * Phase 30 static destructive runtime readiness remains wired.
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
     * Phase 31 proxy readiness remains wired and fail-closed.
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

    assert.match(
      source,
      /config\.runtime\s*\.intakeEnabled\s*\?\s*await probeProxyReadiness/,
    );

    assert.match(
      source,
      /:\s*inspectProxyPoolReadiness/,
    );

    /*
     * Phase 32 secret/environment readiness remains wired before
     * destructive intake can proceed.
     */
    assert.equal(
      source.includes(
        "from './runtime/secret-readiness.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'inspectSecretReadiness',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'assertSecretReadinessForIntake',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'secretReadiness',
      ),
      true,
    );

    assert.match(
      source,
      /portalApiAccessToken:\s*config\.secrets\s*\.portalApiAccessToken/,
    );

    assert.match(
      source,
      /readiness:\s*secretReadiness/,
    );

    /*
     * Phase 33 adds a separate explicit controlled activation gate.
     */
    assert.equal(
      source.includes(
        "from './runtime/activation-profile.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'inspectActivationProfile',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'assertActivationProfileForIntake',
      ),
      true,
    );

    assert.equal(
      source.includes(
        'activationReadiness',
      ),
      true,
    );

    assert.match(
      source,
      /profile:\s*config\.runtime\s*\.activationProfile/,
    );

    assert.match(
      source,
      /workflowRuntimeEnabled,/,
    );

    assert.match(
      source,
      /portalResultEnabled:\s*config\.portal\s*\.result\s*\.enabled/,
    );

    assert.match(
      source,
      /readiness:\s*activationReadiness/,
    );

    /*
     * Phase 35 exposes an explicit in-process manual challenge
     * operations boundary without adding automatic resume or a
     * dashboard mutation endpoint.
     */
    assert.equal(
      source.includes(
        "from './runtime/manual-challenge-operations.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'ManualChallengeOperations',
      ),
      true,
    );

    assert.match(
      source,
      /new ManualChallengeOperations\(\{\s*jobStore,\s*ipAllocator,\s*intakeExecutionHandler,\s*\}\)/,
    );

    assert.match(
      source,
      /operations:\s*config\.runtime\s*\.intakeEnabled\s*\?\s*manualChallengeOperations\s*:\s*null/,
    );

    assert.match(
      source,
      /resumeAvailableWithinProcess:\s*config\.runtime\s*\.intakeEnabled/,
    );

    assert.match(
      source,
      /automaticResume:\s*false/,
    );

    assert.match(
      source,
      /restartRecoverable:\s*false/,
    );

    assert.match(
      source,
      /dashboardMutationEndpoint:\s*false/,
    );

    /*
     * Phase 36 adds bounded read-only observability.
     * Bootstrap must construct RuntimeObservability and expose
     * only its snapshot through the operational service.
     */
    assert.equal(
      source.includes(
        "from './runtime/observability.js';",
      ),
      true,
    );

    assert.equal(
      source.includes(
        'RuntimeObservability',
      ),
      true,
    );

    assert.match(
      source,
      /new RuntimeObservability\(\{\s*jobStore,\s*ipAllocator,\s*proxyPool,\s*finalResultStore,\s*executionWorker,\s*intakeExecutionHandler,\s*\}\)/,
    );

    assert.match(
      source,
      /observabilityProvider:\s*\(\)\s*=>\s*runtimeObservability\s*\.snapshot\(\)/,
    );

    /*
     * Bootstrap surfaces bounded readiness states and Phase 39.
     */
    assert.match(
      source,
      /phase:\s*39/,
    );

    assert.match(
      source,
      /activationReadiness,/,
    );

    assert.match(
      source,
      /secretReadiness,/,
    );

    assert.match(
      source,
      /proxyReadiness,/,
    );
  },
);
