import {
  OtpMatcher,
} from '../otp/otp-matcher.js';

import {
  OtpService,
} from '../otp/otp-service.js';

import {
  WorkflowEngine,
} from '../workflow/engine.js';

import {
  assertIvacWorkflowContractReady,
} from '../workflow/ivac-workflow-contract.js';

import {
  createJobDocumentService,
} from './job-document-service.js';

import {
  createJobWorkflowClients,
} from './job-workflow-clients.js';


function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}


function requirePositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}


function normalizeOptionalSecret(
  value,
  name,
) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string when supplied.`,
    );
  }

  return value.trim();
}


function validateInjectedDocumentService(
  value,
) {
  if (
    value === null
  ) {
    return null;
  }

  if (
    typeof value !== 'object'
    || Array.isArray(value)
    || typeof value
      .prepareForJobContext
      !== 'function'
  ) {
    throw new TypeError(
      'documentService must expose prepareForJobContext().',
    );
  }

  return value;
}


/*
 * Builds one workflow executor for one in-memory job session.
 *
 * Safety boundaries:
 *
 * - Target, OTP, and PDF document traffic all share the exact
 *   same allocation-bound JobHttpClient;
 * - no direct-network fallback is created;
 * - cookies remain isolated inside the one in-memory job
 *   session;
 * - OTP values remain inside JobContext memory;
 * - PDF binary remains inside JobContext memory;
 * - target routes remain constrained by TargetHttpClient;
 * - enabled IVAC workflow routes are preflight-verified against
 *   the exact METHOD + PATH pairs in the verified target
 *   contract before job-level clients are created;
 * - verified IVAC target contract is required before target
 *   workflow traffic can execute;
 * - document source URLs remain HTTPS + allowlist constrained;
 * - redirects remain disabled by the underlying clients;
 * - human-verification challenges propagate as
 *   MANUAL_CHALLENGE_REQUIRED;
 * - this layer performs no challenge or anti-bot bypass;
 * - Portal bearer token forwarding remains restricted by
 *   DocumentClient to the configured Portal origin;
 * - secrets, cookies, OTPs, PDFs, passwords, and full Portal
 *   payloads are not persisted or logged here;
 * - sessions/cookies are not claimed to survive restart.
 *
 * documentService remains injectable for focused tests and
 * composition use. In normal config-driven construction,
 * documentConfig is used to build the verified document
 * pipeline against the same JobHttpClient.
 */

export function createJobWorkflowExecutor({
  session,
  workflow,
  targetConfig,
  otpConfig,
  contract,
  maxSteps,
  documentConfig = null,
  portalAccessToken = null,
  documentService = null,
}) {

  requireObject(
    session,
    'session',
  );

  requireObject(
    workflow,
    'workflow',
  );

  requireObject(
    targetConfig,
    'targetConfig',
  );

  requireObject(
    otpConfig,
    'otpConfig',
  );

  requireObject(
    contract,
    'contract',
  );

  requirePositiveInteger(
    maxSteps,
    'maxSteps',
  );

  /*
   * Phase 29 target-contract preflight.
   *
   * Disabled workflow construction remains available for safe
   * fail-closed bootstrap/tests.
   *
   * An enabled workflow, however, must prove that every target
   * HTTP request and document upload is represented by an exact
   * verified METHOD + PATH pair before any job-level network
   * client is constructed.
   */
  if (
    workflow.enabled === true
  ) {
    assertIvacWorkflowContractReady({
      workflow,
      contract,
    });
  }

  const injectedDocumentService =
    validateInjectedDocumentService(
      documentService,
    );

  if (
    documentConfig !== null
    && injectedDocumentService
      !== null
  ) {
    throw new TypeError(
      'Provide either documentConfig or documentService, not both.',
    );
  }

  if (
    documentConfig !== null
  ) {
    requireObject(
      documentConfig,
      'documentConfig',
    );
  }

  const normalizedPortalAccessToken =
    normalizeOptionalSecret(
      portalAccessToken,
      'portalAccessToken',
    );

  const clients =
    createJobWorkflowClients({
      session,

      target:
        targetConfig,

      otp:
        otpConfig,

      contract,
    });

  let resolvedDocumentService =
    injectedDocumentService;

  let documentClient =
    null;

  if (
    documentConfig !== null
  ) {
    const documentPipeline =
      createJobDocumentService({

        jobHttpClient:
          clients.jobHttpClient,

        client: {

          baseUrl:
            documentConfig.baseUrl,

          allowedOrigins:
            documentConfig.allowedOrigins,

          timeoutMs:
            documentConfig.timeoutMs,

          maxFileBytes:
            documentConfig.maxFileBytes,

          portalAccessToken:
            normalizedPortalAccessToken,

        },

        service: {

          maxCount:
            documentConfig.maxCount,

          maxFileBytes:
            documentConfig.maxFileBytes,

          maxTotalBytes:
            documentConfig.maxTotalBytes,

        },

      });


    documentClient =
      documentPipeline
        .documentClient;


    resolvedDocumentService =
      documentPipeline
        .documentService;
  }


  const otpMatcher =
    new OtpMatcher();


  const otpService =
    new OtpService({

      otpClient:
        clients.otpClient,

      otpTableParser:
        clients.otpTableParser,

      otpMatcher,

      pollIntervalMs:
        requirePositiveInteger(
          otpConfig.pollIntervalMs,
          'otpConfig.pollIntervalMs',
        ),

      timeoutMs:
        requirePositiveInteger(
          otpConfig.timeoutMs,
          'otpConfig.timeoutMs',
        ),

    });


  const workflowEngine =
    new WorkflowEngine({

      targetHttpClient:
        clients.targetHttpClient,

      otpService,

      documentService:
        resolvedDocumentService,

      maxSteps,

    });


  const execute =
    async ({
      jobContext,
      signal = null,
    }) => (
      workflowEngine.execute({

        workflow,

        jobContext,

        signal,

      })
    );


  return Object.freeze({

    execute,

    /*
     * Exposed only for internal composition/testing.
     *
     * None of these objects should be serialized, logged, or
     * persisted because they can contain live session/network
     * state and sensitive in-memory data.
     */

    jobHttpClient:
      clients.jobHttpClient,

    targetHttpClient:
      clients.targetHttpClient,

    otpClient:
      clients.otpClient,

    otpTableParser:
      clients.otpTableParser,

    otpMatcher,

    otpService,

    documentClient,

    documentService:
      resolvedDocumentService,

    workflowEngine,

  });

}