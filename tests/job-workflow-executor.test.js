import assert from 'node:assert/strict';
import test from 'node:test';

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

function createWorkflow({
  enabled = false,
  steps = [],
} = {}) {
  return {
    name:
      'test-workflow',

    version:
      1,

    enabled,

    steps,
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

function createDocumentConfig() {
  return {
    baseUrl:
      'https://portal.example',

    allowedOrigins: [
      'https://portal.example',
      'https://cdn.example',
    ],

    timeoutMs:
      15000,

    maxCount:
      5,

    maxFileBytes:
      5 * 1024 * 1024,

    maxTotalBytes:
      20 * 1024 * 1024,
  };
}

test(
  'target and OTP integrations share the exact same per-job HTTP client',
  () => {
    const executor =
      createJobWorkflowExecutor({
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
      });

    assert.equal(
      executor
        .targetHttpClient
        .jobHttpClient,
      executor.jobHttpClient,
    );

    assert.equal(
      executor
        .otpClient
        .jobHttpClient,
      executor.jobHttpClient,
    );

    assert.equal(
      executor
        .jobHttpClient
        .session
        .allocationId,
      'allocation-1',
    );

    assert.equal(
      executor
        .jobHttpClient
        .session
        .assignedIp,
      '192.0.2.10',
    );
  },
);

test(
  'document pipeline shares the same per-job HTTP client',
  () => {
    const executor =
      createJobWorkflowExecutor({
        session:
          createSession(),

        workflow:
          createWorkflow(),

        targetConfig:
          createTargetConfig(),

        otpConfig:
          createOtpConfig(),

        documentConfig:
          createDocumentConfig(),

        maxSteps:
          100,
      });

    assert.ok(
      executor.documentClient,
    );

    assert.ok(
      executor.documentService,
    );

    assert.equal(
      executor
        .documentClient
        .jobHttpClient,
      executor.jobHttpClient,
    );

    assert.equal(
      executor
        .documentService
        .documentClient,
      executor.documentClient,
    );

    assert.equal(
      executor
        .workflowEngine
        .documentService,
      executor.documentService,
    );

    assert.equal(
      executor
        .documentClient
        .jobHttpClient,
      executor
        .targetHttpClient
        .jobHttpClient,
    );

    assert.equal(
      executor
        .documentClient
        .jobHttpClient,
      executor
        .otpClient
        .jobHttpClient,
    );
  },
);

test(
  'portal access token is passed only into the document client',
  () => {
    const executor =
      createJobWorkflowExecutor({
        session:
          createSession(),

        workflow:
          createWorkflow(),

        targetConfig:
          createTargetConfig(),

        otpConfig:
          createOtpConfig(),

        documentConfig:
          createDocumentConfig(),

        portalAccessToken:
          'portal-secret-token',

        maxSteps:
          100,
      });

    assert.equal(
      executor
        .documentClient
        .portalAccessToken,
      'portal-secret-token',
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          executor
            .targetHttpClient,
          'portalAccessToken',
        ),
      false,
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          executor
            .otpClient,
          'portalAccessToken',
        ),
      false,
    );
  },
);

test(
  'missing portal access token remains null in document client',
  () => {
    const executor =
      createJobWorkflowExecutor({
        session:
          createSession(),

        workflow:
          createWorkflow(),

        targetConfig:
          createTargetConfig(),

        otpConfig:
          createOtpConfig(),

        documentConfig:
          createDocumentConfig(),

        maxSteps:
          100,
      });

    assert.equal(
      executor
        .documentClient
        .portalAccessToken,
      null,
    );
  },
);

test(
  'OTP service uses the verified client, parser, and matcher instances',
  () => {
    const executor =
      createJobWorkflowExecutor({
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
      });

    assert.equal(
      executor
        .otpService
        .otpClient,
      executor.otpClient,
    );

    assert.equal(
      executor
        .otpService
        .otpTableParser,
      executor.otpTableParser,
    );

    assert.equal(
      executor
        .otpService
        .otpMatcher,
      executor.otpMatcher,
    );

    assert.equal(
      executor
        .otpService
        .pollIntervalMs,
      3000,
    );

    assert.equal(
      executor
        .otpService
        .timeoutMs,
      120000,
    );
  },
);

test(
  'workflow engine uses the same target client and OTP service',
  () => {
    const executor =
      createJobWorkflowExecutor({
        session:
          createSession(),

        workflow:
          createWorkflow(),

        targetConfig:
          createTargetConfig(),

        otpConfig:
          createOtpConfig(),

        maxSteps:
          25,
      });

    assert.equal(
      executor
        .workflowEngine
        .targetHttpClient,
      executor.targetHttpClient,
    );

    assert.equal(
      executor
        .workflowEngine
        .otpService,
      executor.otpService,
    );

    assert.equal(
      executor
        .workflowEngine
        .maxSteps,
      25,
    );

    assert.equal(
      executor
        .workflowEngine
        .documentService,
      null,
    );
  },
);

test(
  'verified injected document service is passed through without modification',
  () => {
    const documentService = {
      async prepareForJobContext() {
        return {
          count:
            0,

          totalBytes:
            0,

          documents: [],
        };
      },
    };

    const executor =
      createJobWorkflowExecutor({
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

        documentService,
      });

    assert.equal(
      executor.documentClient,
      null,
    );

    assert.equal(
      executor.documentService,
      documentService,
    );

    assert.equal(
      executor
        .workflowEngine
        .documentService,
      documentService,
    );
  },
);

test(
  'document config and injected document service cannot both be supplied',
  () => {
    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session:
            createSession(),

          workflow:
            createWorkflow(),

          targetConfig:
            createTargetConfig(),

          otpConfig:
            createOtpConfig(),

          documentConfig:
            createDocumentConfig(),

          documentService: {
            async prepareForJobContext() {},
          },

          maxSteps:
            100,
        });
      },
      /Provide either documentConfig or documentService, not both/,
    );
  },
);

test(
  'disabled workflow fails closed before any target execution',
  async () => {
    const executor =
      createJobWorkflowExecutor({
        session:
          createSession(),

        workflow:
          createWorkflow({
            enabled:
              false,

            steps: [],
          }),

        targetConfig:
          createTargetConfig(),

        otpConfig:
          createOtpConfig(),

        maxSteps:
          100,
      });

    const jobContext = {
      setCurrentStep() {},

      setResponse() {},
    };

    await assert.rejects(
      executor.execute({
        jobContext,
      }),
      /Workflow execution is disabled/,
    );
  },
);

test(
  'executor preserves allocation-bound session identity',
  () => {
    const session =
      createSession();

    const executor =
      createJobWorkflowExecutor({
        session,

        workflow:
          createWorkflow(),

        targetConfig:
          createTargetConfig(),

        otpConfig:
          createOtpConfig(),

        documentConfig:
          createDocumentConfig(),

        maxSteps:
          100,
      });

    assert.equal(
      executor
        .jobHttpClient
        .session,
      session,
    );

    assert.equal(
      executor
        .jobHttpClient
        .session
        .jobId,
      'job-1',
    );

    assert.equal(
      executor
        .jobHttpClient
        .session
        .allocationId,
      'allocation-1',
    );

    assert.equal(
      executor
        .documentClient
        .jobHttpClient
        .session,
      session,
    );
  },
);

test(
  'executor validates required configuration',
  () => {
    const session =
      createSession();

    const workflow =
      createWorkflow();

    const targetConfig =
      createTargetConfig();

    const otpConfig =
      createOtpConfig();

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session:
            null,

          workflow,

          targetConfig,

          otpConfig,

          maxSteps:
            100,
        });
      },
      /session must be an object/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow:
            null,

          targetConfig,

          otpConfig,

          maxSteps:
            100,
        });
      },
      /workflow must be an object/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow,

          targetConfig:
            null,

          otpConfig,

          maxSteps:
            100,
        });
      },
      /targetConfig must be an object/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow,

          targetConfig,

          otpConfig:
            null,

          maxSteps:
            100,
        });
      },
      /otpConfig must be an object/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow,

          targetConfig,

          otpConfig,

          maxSteps:
            0,
        });
      },
      /maxSteps must be a positive integer/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow,

          targetConfig,

          otpConfig,

          maxSteps:
            100,

          documentConfig:
            [],
        });
      },
      /documentConfig must be an object/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow,

          targetConfig,

          otpConfig,

          maxSteps:
            100,

          documentService: {},
        });
      },
      /documentService must expose prepareForJobContext/,
    );

    assert.throws(
      () => {
        createJobWorkflowExecutor({
          session,

          workflow,

          targetConfig,

          otpConfig,

          maxSteps:
            100,

          portalAccessToken: {},
        });
      },
      /portalAccessToken must be a non-empty string when supplied/,
    );
  },
);