import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVerifiedIvacAuthTargetContract,
} from '../src/contracts/ivac-auth-target-contract.js';

import {
  createIvacTargetContract,
  createUnverifiedIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';

import {
  assertDestructiveRuntimeReadiness,
  inspectRuntimeReadiness,
} from '../src/runtime/runtime-readiness.js';

import {
  createIvacAuthWorkflow,
} from '../src/workflow/ivac-auth-workflow.js';


function createReadyOptions() {
  return {
    intakeEnabled:
      true,

    workflowRuntimeEnabled:
      true,

    workflow:
      createIvacAuthWorkflow(),

    targetContract:
      createVerifiedIvacAuthTargetContract(),

    portalResultConfigured:
      true,
  };
}


test(
  'default disabled runtime remains fail-closed with bounded blockers',
  () => {
    const result =
      inspectRuntimeReadiness({
        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        workflow: {
          version:
            1,

          name:
            'ivac-target-workflow',

          enabled:
            false,

          steps:
            [],
        },

        targetContract:
          createUnverifiedIvacTargetContract(),

        portalResultConfigured:
          false,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'INTAKE_DISABLED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'INTAKE_DISABLED',
        'WORKFLOW_RUNTIME_DISABLED',
        'WORKFLOW_DEFINITION_DISABLED',
        'TARGET_CONTRACT_NOT_VERIFIED',
        'WORKFLOW_CONTRACT_NOT_READY',
        'PORTAL_RESULT_NOT_CONFIGURED',
      ],
    );

    assert.deepEqual(
      result.gates,
      {
        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        workflowDefinitionEnabled:
          false,

        targetContractVerified:
          false,

        workflowContractReady:
          false,

        portalResultConfigured:
          false,
      },
    );

    assert.deepEqual(
      result.workflowContract,
      {
        ready:
          false,

        reason:
          'WORKFLOW_DEFINITION_DISABLED',
      },
    );

    assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result.blockers,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result.gates,
      ),
      true,
    );
  },
);


test(
  'all Phase 30 static readiness gates pass for verified auth workflow',
  () => {
    const result =
      inspectRuntimeReadiness(
        createReadyOptions(),
      );

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.deepEqual(
      result.blockers,
      [],
    );

    assert.deepEqual(
      result.gates,
      {
        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          true,

        workflowDefinitionEnabled:
          true,

        targetContractVerified:
          true,

        workflowContractReady:
          true,

        portalResultConfigured:
          true,
      },
    );

    assert.equal(
      result.workflowContract
        .ready,
      true,
    );

    assert.equal(
      result.workflowContract
        .reason,
      'READY',
    );

    assert.equal(
      result.workflowContract
        .requiredEndpointCount,
      2,
    );
  },
);


test(
  'unverified target contract blocks destructive runtime readiness',
  () => {
    const result =
      inspectRuntimeReadiness({
        ...createReadyOptions(),

        targetContract:
          createUnverifiedIvacTargetContract(),
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'TARGET_CONTRACT_NOT_VERIFIED',
    );

    assert.equal(
      result.gates
        .targetContractVerified,
      false,
    );

    assert.equal(
      result.gates
        .workflowContractReady,
      false,
    );

    assert.deepEqual(
      result.blockers,
      [
        'TARGET_CONTRACT_NOT_VERIFIED',
        'WORKFLOW_CONTRACT_NOT_READY',
      ],
    );

    assert.deepEqual(
      result.workflowContract,
      {
        ready:
          false,

        reason:
          'TARGET_CONTRACT_NOT_VERIFIED',
      },
    );
  },
);


test(
  'verified but incomplete target contract blocks workflow-contract readiness',
  () => {
    const incompleteContract =
      createIvacTargetContract({
        verified:
          true,

        endpoints: [
          {
            name:
              'sign-in',

            method:
              'POST',

            path:
              '/auth/sign-in-v2',

            verified:
              true,
          },
        ],
      });

    const result =
      inspectRuntimeReadiness({
        ...createReadyOptions(),

        targetContract:
          incompleteContract,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'WORKFLOW_CONTRACT_NOT_READY',
    );

    assert.equal(
      result.gates
        .targetContractVerified,
      true,
    );

    assert.equal(
      result.gates
        .workflowContractReady,
      false,
    );

    assert.deepEqual(
      result.blockers,
      [
        'WORKFLOW_CONTRACT_NOT_READY',
      ],
    );

    assert.deepEqual(
      result.workflowContract,
      {
        ready:
          false,

        reason:
          'WORKFLOW_CONTRACT_INVALID',
      },
    );
  },
);


test(
  'missing Portal final-result configuration blocks readiness',
  () => {
    const result =
      inspectRuntimeReadiness({
        ...createReadyOptions(),

        portalResultConfigured:
          false,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PORTAL_RESULT_NOT_CONFIGURED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PORTAL_RESULT_NOT_CONFIGURED',
      ],
    );

    assert.equal(
      result.gates
        .portalResultConfigured,
      false,
    );
  },
);


test(
  'disabled intake inspection does not throw during safe startup',
  () => {
    const result =
      assertDestructiveRuntimeReadiness({
        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        workflow: {
          version:
            1,

          name:
            'ivac-target-workflow',

          enabled:
            false,

          steps:
            [],
        },

        targetContract:
          createUnverifiedIvacTargetContract(),

        portalResultConfigured:
          false,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'INTAKE_DISABLED',
    );
  },
);


test(
  'enabled destructive intake throws when any static readiness gate is blocked',
  () => {
    assert.throws(
      () => {
        assertDestructiveRuntimeReadiness({
          ...createReadyOptions(),

          portalResultConfigured:
            false,
        });
      },

      /Destructive runtime readiness blocked: PORTAL_RESULT_NOT_CONFIGURED/,
    );
  },
);


test(
  'enabled destructive intake passes assertion only when every static gate is ready',
  () => {
    const result =
      assertDestructiveRuntimeReadiness(
        createReadyOptions(),
      );

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.deepEqual(
      result.blockers,
      [],
    );
  },
);


test(
  'runtime readiness validates bounded boolean inputs',
  () => {
    assert.throws(
      () => {
        inspectRuntimeReadiness({
          ...createReadyOptions(),

          intakeEnabled:
            'true',
        });
      },

      {
        name:
          'TypeError',

        message:
          'intakeEnabled must be a boolean.',
      },
    );

    assert.throws(
      () => {
        inspectRuntimeReadiness({
          ...createReadyOptions(),

          workflowRuntimeEnabled:
            null,
        });
      },

      {
        name:
          'TypeError',

        message:
          'workflowRuntimeEnabled must be a boolean.',
      },
    );

    assert.throws(
      () => {
        inspectRuntimeReadiness({
          ...createReadyOptions(),

          portalResultConfigured:
            1,
        });
      },

      {
        name:
          'TypeError',

        message:
          'portalResultConfigured must be a boolean.',
      },
    );
  },
);