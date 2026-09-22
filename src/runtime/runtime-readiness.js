import {
  validateIvacTargetContract,
} from '../contracts/ivac-target-contract.js';

import {
  inspectIvacWorkflowContract,
} from '../workflow/ivac-workflow-contract.js';


const READY_REASON =
  'READY';


function requireBoolean(
  value,
  name,
) {
  if (
    typeof value
    !== 'boolean'
  ) {
    throw new TypeError(
      `${name} must be a boolean.`,
    );
  }

  return value;
}


function requireWorkflowObject(
  workflow,
) {
  if (
    workflow === null
    || typeof workflow
      !== 'object'
    || Array.isArray(
      workflow,
    )
  ) {
    throw new TypeError(
      'workflow must be an object.',
    );
  }

  return workflow;
}


function isVerifiedTargetContract(
  contract,
) {
  if (
    contract === null
    || typeof contract
      !== 'object'
    || Array.isArray(
      contract,
    )
  ) {
    return false;
  }

  try {
    return (
      validateIvacTargetContract(
        contract,
      )
      === true
    );
  } catch {
    return false;
  }
}


function inspectWorkflowContractGate({
  workflow,
  targetContract,
  targetContractVerified,
}) {
  if (
    workflow.enabled
    !== true
  ) {
    return Object.freeze({
      ready:
        false,

      reason:
        'WORKFLOW_DEFINITION_DISABLED',
    });
  }

  if (
    !targetContractVerified
  ) {
    return Object.freeze({
      ready:
        false,

      reason:
        'TARGET_CONTRACT_NOT_VERIFIED',
    });
  }

  try {
    const inspection =
      inspectIvacWorkflowContract({
        workflow,

        contract:
          targetContract,
      });

    return Object.freeze({
      ready:
        inspection.ready
        === true,

      reason:
        inspection.reason
        ?? (
          inspection.ready
            ? READY_REASON
            : 'WORKFLOW_CONTRACT_NOT_READY'
        ),

      requiredEndpointCount:
        inspection
          .requiredEndpointCount
        ?? 0,
    });
  } catch {
    /*
     * Readiness inspection must remain fail-closed.
     *
     * The detailed thrown error may contain implementation
     * information that does not belong in bounded operational
     * readiness output.
     */
    return Object.freeze({
      ready:
        false,

      reason:
        'WORKFLOW_CONTRACT_INVALID',
    });
  }
}


function createBlockers({
  intakeEnabled,
  workflowRuntimeEnabled,
  workflowDefinitionEnabled,
  targetContractVerified,
  workflowContractReady,
  portalResultConfigured,
}) {
  const blockers = [];

  if (
    !intakeEnabled
  ) {
    blockers.push(
      'INTAKE_DISABLED',
    );
  }

  if (
    !workflowRuntimeEnabled
  ) {
    blockers.push(
      'WORKFLOW_RUNTIME_DISABLED',
    );
  }

  if (
    !workflowDefinitionEnabled
  ) {
    blockers.push(
      'WORKFLOW_DEFINITION_DISABLED',
    );
  }

  if (
    !targetContractVerified
  ) {
    blockers.push(
      'TARGET_CONTRACT_NOT_VERIFIED',
    );
  }

  if (
    !workflowContractReady
  ) {
    blockers.push(
      'WORKFLOW_CONTRACT_NOT_READY',
    );
  }

  if (
    !portalResultConfigured
  ) {
    blockers.push(
      'PORTAL_RESULT_NOT_CONFIGURED',
    );
  }

  return Object.freeze(
    blockers,
  );
}


export function inspectRuntimeReadiness({
  intakeEnabled,
  workflowRuntimeEnabled,
  workflow,
  targetContract,
  portalResultConfigured,
}) {
  requireBoolean(
    intakeEnabled,
    'intakeEnabled',
  );

  requireBoolean(
    workflowRuntimeEnabled,
    'workflowRuntimeEnabled',
  );

  requireBoolean(
    portalResultConfigured,
    'portalResultConfigured',
  );

  requireWorkflowObject(
    workflow,
  );

  const workflowDefinitionEnabled =
    workflow.enabled
    === true;

  const targetContractVerified =
    isVerifiedTargetContract(
      targetContract,
    );

  const workflowContract =
    inspectWorkflowContractGate({
      workflow,

      targetContract,

      targetContractVerified,
    });

  const gates =
    Object.freeze({
      intakeEnabled,

      workflowRuntimeEnabled,

      workflowDefinitionEnabled,

      targetContractVerified,

      workflowContractReady:
        workflowContract.ready,

      portalResultConfigured,
    });

  const blockers =
    createBlockers(
      gates,
    );

  const ready =
    blockers.length
    === 0;

  return Object.freeze({
    ready,

    reason:
      ready
        ? READY_REASON
        : blockers[0],

    blockers,

    gates,

    workflowContract,
  });
}


/*
 * Destructive Portal intake remains an explicit opt-in.
 *
 * When intake is disabled this function performs inspection but
 * intentionally does not throw. Normal development/startup must
 * remain safe with activation switches disabled.
 *
 * Once intake is explicitly enabled, every Phase 30 static gate
 * must pass before destructive runtime startup is allowed.
 *
 * Network/proxy readiness is intentionally not handled here.
 * That belongs to the separate Phase 31 readiness boundary.
 *
 * Environment/secret readiness is also intentionally separate
 * and will be hardened in Phase 32.
 */
export function assertDestructiveRuntimeReadiness(
  options,
) {
  const readiness =
    inspectRuntimeReadiness(
      options,
    );

  if (
    options.intakeEnabled
    !== true
  ) {
    return readiness;
  }

  if (
    !readiness.ready
  ) {
    throw new Error(
      `Destructive runtime readiness blocked: ${readiness.reason}.`,
    );
  }

  return readiness;
}