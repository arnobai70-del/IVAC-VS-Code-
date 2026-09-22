import {
  validateIvacTargetContract,
} from '../contracts/ivac-target-contract.js';


const supportedTargetStepTypes =
  new Set([
    'http',
    'documents.upload',
  ]);


function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(
      value,
    )
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}


function normalizeMethod(
  method,
  stepId,
) {
  if (
    typeof method !== 'string'
    || method.trim() === ''
  ) {
    throw new Error(
      `Workflow step ${stepId} must declare a non-empty HTTP method.`,
    );
  }

  return method
    .trim()
    .toUpperCase();
}


function normalizeStaticRoute(
  route,
  stepId,
) {
  if (
    typeof route !== 'string'
    || route.trim() === ''
  ) {
    throw new Error(
      `Workflow step ${stepId} must declare a non-empty target route.`,
    );
  }

  const normalized =
    route.trim();

  /*
   * Phase 29 startup preflight intentionally authorizes only
   * static target routes.
   *
   * Runtime-derived target URLs cannot be proven against the
   * verified contract before a job starts, so they remain
   * fail-closed.
   *
   * Request bodies and headers may still use safe workflow
   * templates. Only the target route itself must be static.
   */
  if (
    normalized.includes(
      '{{',
    )
    || normalized.includes(
      '}}',
    )
  ) {
    throw new Error(
      `Workflow step ${stepId} uses a dynamic target route that cannot be preflight-verified.`,
    );
  }

  if (
    normalized.includes(
      '://',
    )
    || normalized.startsWith(
      '//',
    )
    || normalized.includes(
      '\\',
    )
  ) {
    throw new Error(
      `Workflow step ${stepId} contains an unsafe target route.`,
    );
  }

  return normalized.replace(
    /^\/+/,
    '/',
  );
}


function targetRequirementForStep(
  step,
) {
  if (
    !step
    || typeof step !== 'object'
    || Array.isArray(
      step,
    )
  ) {
    throw new TypeError(
      'Workflow step must be an object.',
    );
  }

  const stepId =
    typeof step.id === 'string'
    && step.id.trim() !== ''
      ? step.id.trim()
      : '<unknown>';

  if (
    step.type === 'http'
  ) {
    return {
      stepId,

      method:
        normalizeMethod(
          step.method,
          stepId,
        ),

      path:
        normalizeStaticRoute(
          step.route,
          stepId,
        ),
    };
  }

  if (
    step.type
      === 'documents.upload'
  ) {
    return {
      stepId,

      /*
       * WorkflowEngine -> TargetHttpClient.uploadPdf()
       * always performs POST.
       */
      method:
        'POST',

      path:
        normalizeStaticRoute(
          step.route,
          stepId,
        ),
    };
  }

  return null;
}


function createVerifiedEndpointSet(
  contract,
) {
  const endpoints =
    new Set();

  for (
    const endpoint
    of contract.endpoints
  ) {
    endpoints.add(
      `${endpoint.method} ${endpoint.path}`,
    );
  }

  return endpoints;
}


function collectTargetRequirements(
  workflow,
) {
  const requirements =
    [];

  for (
    const step
    of workflow.steps
  ) {
    const requirement =
      targetRequirementForStep(
        step,
      );

    if (
      requirement
    ) {
      requirements.push(
        requirement,
      );

      continue;
    }

    /*
     * These step types do not directly send traffic to the IVAC
     * target API and therefore do not consume a target-contract
     * endpoint:
     *
     * - otp.prepare
     * - otp.wait
     * - documents.prepare
     */
    if (
      step.type === 'otp.prepare'
      || step.type === 'otp.wait'
      || step.type
        === 'documents.prepare'
    ) {
      continue;
    }

    throw new Error(
      `Unsupported workflow step type during target-contract preflight: ${step.type}`,
    );
  }

  return requirements;
}


function publicRequirement(
  requirement,
) {
  return Object.freeze({
    stepId:
      requirement.stepId,

    method:
      requirement.method,

    path:
      requirement.path,
  });
}


/*
 * Checks an IVAC workflow against the verified target contract
 * before any job-level target traffic can begin.
 *
 * Safety boundary:
 *
 * - disabled workflows remain non-executable and do not require
 *   a production target contract;
 * - enabled workflows require a VERIFIED target contract;
 * - every HTTP step requires an exact verified METHOD + PATH;
 * - documents.upload is always checked as POST;
 * - dynamic target routes are rejected;
 * - OTP polling and Portal document preparation are outside the
 *   IVAC target-contract route list;
 * - this function performs no network request.
 */
export function inspectIvacWorkflowContract({
  workflow,
  contract,
}) {
  requireObject(
    workflow,
    'workflow',
  );

  requireObject(
    contract,
    'contract',
  );

  if (
    !Array.isArray(
      workflow.steps,
    )
  ) {
    throw new TypeError(
      'workflow.steps must be an array.',
    );
  }

  if (
    workflow.enabled !== true
  ) {
    return Object.freeze({
      ready:
        false,

      reason:
        'WORKFLOW_DISABLED',

      requiredEndpointCount:
        0,

      requiredEndpoints:
        Object.freeze(
          [],
        ),
    });
  }

  if (
    validateIvacTargetContract(
      contract,
    )
    !== true
  ) {
    throw new Error(
      'Enabled IVAC workflow requires a verified IVAC target contract.',
    );
  }

  const verifiedEndpoints =
    createVerifiedEndpointSet(
      contract,
    );

  const requirements =
    collectTargetRequirements(
      workflow,
    );

  const missing =
    [];

  for (
    const requirement
    of requirements
  ) {
    const key =
      `${requirement.method} ${requirement.path}`;

    if (
      !verifiedEndpoints.has(
        key,
      )
    ) {
      missing.push(
        requirement,
      );
    }
  }

  if (
    missing.length > 0
  ) {
    const first =
      missing[0];

    throw new Error(
      `Workflow step ${first.stepId} requires unverified target route ${first.method} ${first.path}.`,
    );
  }

  const publicRequirements =
    Object.freeze(
      requirements.map(
        publicRequirement,
      ),
    );

  return Object.freeze({
    ready:
      true,

    reason:
      'READY',

    requiredEndpointCount:
      publicRequirements.length,

    requiredEndpoints:
      publicRequirements,
  });
}


export function assertIvacWorkflowContractReady({
  workflow,
  contract,
}) {
  const result =
    inspectIvacWorkflowContract({
      workflow,
      contract,
    });

  if (
    result.ready !== true
  ) {
    throw new Error(
      `IVAC workflow target-contract preflight is not ready: ${result.reason}`,
    );
  }

  return result;
}


export function getIvacWorkflowTargetRequirements(
  workflow,
) {
  requireObject(
    workflow,
    'workflow',
  );

  if (
    !Array.isArray(
      workflow.steps,
    )
  ) {
    throw new TypeError(
      'workflow.steps must be an array.',
    );
  }

  return Object.freeze(
    collectTargetRequirements(
      workflow,
    ).map(
      publicRequirement,
    ),
  );
}