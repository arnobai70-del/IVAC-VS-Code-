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
  createIvacTargetContract,
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

function createVerifiedContract() {
  return createIvacTargetContract({
    verified:
      true,

    endpoints: [
      {
        name:
          'example-get',

        method:
          'GET',

        path:
          '/example',

        verified:
          true,
      },
    ],
  });
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
  'bootstrap target contract is explicitly unverified and contains no invented endpoints',
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
  'verified target contract reaches TargetHttpClient unchanged',
  () => {
    const contract =
      createVerifiedContract();

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
  'target route absent from verified contract fails before network execution',
  async () => {
    const executor =
      createJobWorkflowExecutor({
        ...createExecutorOptions(),

        contract:
          createVerifiedContract(),
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
  'repository activation defaults remain non-destructive',
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

    assert.deepEqual(
      workflowConfig.steps,
      [],
    );
  },
);