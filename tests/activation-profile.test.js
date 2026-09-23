import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVATION_PROFILES,
  assertActivationProfileForIntake,
  inspectActivationProfile,
} from '../src/runtime/activation-profile.js';


function createControlledReadyOptions() {
  return {
    profile:
      ACTIVATION_PROFILES
        .CONTROLLED,

    intakeEnabled:
      true,

    workflowRuntimeEnabled:
      true,

    portalResultEnabled:
      true,
  };
}


test(
  'safe profile remains non-destructive while intake is disabled',
  () => {
    const result =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .SAFE,

        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        portalResultEnabled:
          false,
      });

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.equal(
      result.state,
      'SAFE',
    );

    assert.equal(
      result.profile,
      'safe',
    );

    assert.deepEqual(
      result.blockers,
      [],
    );

    assert.deepEqual(
      result.gates,
      {
        controlledProfile:
          false,

        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        portalResultEnabled:
          false,
      },
    );
  },
);


test(
  'controlled profile may be armed without enabling destructive intake',
  () => {
    const result =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .CONTROLLED,

        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        portalResultEnabled:
          false,
      });

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.equal(
      result.state,
      'ARMED',
    );

    assert.equal(
      result.profile,
      'controlled',
    );

    assert.deepEqual(
      result.blockers,
      [],
    );

    assert.equal(
      result.gates
        .controlledProfile,
      true,
    );

    assert.equal(
      result.gates
        .intakeEnabled,
      false,
    );
  },
);


test(
  'destructive intake cannot run under safe activation profile',
  () => {
    const result =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .SAFE,

        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          true,

        portalResultEnabled:
          true,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'CONTROLLED_ACTIVATION_PROFILE_REQUIRED',
    );

    assert.equal(
      result.state,
      'SAFE',
    );

    assert.deepEqual(
      result.blockers,
      [
        'CONTROLLED_ACTIVATION_PROFILE_REQUIRED',
      ],
    );
  },
);


test(
  'controlled profile still requires workflow runtime before intake',
  () => {
    const result =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .CONTROLLED,

        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          false,

        portalResultEnabled:
          true,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'WORKFLOW_RUNTIME_DISABLED',
    );

    assert.equal(
      result.state,
      'ARMED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'WORKFLOW_RUNTIME_DISABLED',
      ],
    );
  },
);


test(
  'controlled profile still requires Portal final-result activation',
  () => {
    const result =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .CONTROLLED,

        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          true,

        portalResultEnabled:
          false,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PORTAL_RESULT_DISABLED',
    );

    assert.equal(
      result.state,
      'ARMED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PORTAL_RESULT_DISABLED',
      ],
    );
  },
);


test(
  'all activation blockers remain bounded and ordered',
  () => {
    const result =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .SAFE,

        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          false,

        portalResultEnabled:
          false,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'CONTROLLED_ACTIVATION_PROFILE_REQUIRED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'CONTROLLED_ACTIVATION_PROFILE_REQUIRED',
        'WORKFLOW_RUNTIME_DISABLED',
        'PORTAL_RESULT_DISABLED',
      ],
    );
  },
);


test(
  'controlled profile becomes active only when every activation gate passes',
  () => {
    const result =
      inspectActivationProfile(
        createControlledReadyOptions(),
      );

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.equal(
      result.state,
      'ACTIVE',
    );

    assert.equal(
      result.profile,
      'controlled',
    );

    assert.deepEqual(
      result.blockers,
      [],
    );

    assert.deepEqual(
      result.gates,
      {
        controlledProfile:
          true,

        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          true,

        portalResultEnabled:
          true,
      },
    );
  },
);


test(
  'activation readiness result and bounded nested state are frozen',
  () => {
    const result =
      inspectActivationProfile(
        createControlledReadyOptions(),
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
  'disabled intake may inspect activation state without startup failure',
  () => {
    const readiness =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .SAFE,

        intakeEnabled:
          false,

        workflowRuntimeEnabled:
          false,

        portalResultEnabled:
          false,
      });

    const result =
      assertActivationProfileForIntake({
        intakeEnabled:
          false,

        readiness,
      });

    assert.equal(
      result,
      readiness,
    );

    assert.equal(
      result.state,
      'SAFE',
    );
  },
);


test(
  'enabled intake fails closed when controlled profile is not selected',
  () => {
    const readiness =
      inspectActivationProfile({
        profile:
          ACTIVATION_PROFILES
            .SAFE,

        intakeEnabled:
          true,

        workflowRuntimeEnabled:
          true,

        portalResultEnabled:
          true,
      });

    assert.throws(
      () => {
        assertActivationProfileForIntake({
          intakeEnabled:
            true,

          readiness,
        });
      },

      /Activation profile blocked: CONTROLLED_ACTIVATION_PROFILE_REQUIRED/,
    );
  },
);


test(
  'enabled intake accepts ready controlled activation state',
  () => {
    const readiness =
      inspectActivationProfile(
        createControlledReadyOptions(),
      );

    const result =
      assertActivationProfileForIntake({
        intakeEnabled:
          true,

        readiness,
      });

    assert.equal(
      result,
      readiness,
    );

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.state,
      'ACTIVE',
    );
  },
);


test(
  'activation profile validates supported profile names',
  () => {
    for (
      const profile
      of [
        null,
        '',
        'production',
        'unsafe',
        true,
      ]
    ) {
      assert.throws(
        () => {
          inspectActivationProfile({
            ...createControlledReadyOptions(),

            profile,
          });
        },

        {
          name:
            'TypeError',

          message:
            'profile must be "safe" or "controlled".',
        },
      );
    }
  },
);


test(
  'activation profile validates bounded boolean inputs',
  () => {
    assert.throws(
      () => {
        inspectActivationProfile({
          ...createControlledReadyOptions(),

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
        inspectActivationProfile({
          ...createControlledReadyOptions(),

          workflowRuntimeEnabled:
            1,
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
        inspectActivationProfile({
          ...createControlledReadyOptions(),

          portalResultEnabled:
            null,
        });
      },

      {
        name:
          'TypeError',

        message:
          'portalResultEnabled must be a boolean.',
      },
    );
  },
);


test(
  'activation assertion rejects malformed readiness objects',
  () => {
    for (
      const readiness
      of [
        null,
        [],
        {},
        {
          ready:
            true,

          reason:
            'READY',

          state:
            'ACTIVE',
        },
        {
          ready:
            'true',

          reason:
            'READY',

          state:
            'ACTIVE',

          profile:
            'controlled',
        },
        {
          ready:
            true,

          reason:
            null,

          state:
            'ACTIVE',

          profile:
            'controlled',
        },
        {
          ready:
            true,

          reason:
            'READY',

          state:
            null,

          profile:
            'controlled',
        },
      ]
    ) {
      assert.throws(
        () => {
          assertActivationProfileForIntake({
            intakeEnabled:
              true,

            readiness,
          });
        },

        {
          name:
            'TypeError',

          message:
            'readiness must be a valid activation profile readiness result.',
        },
      );
    }
  },
);


test(
  'activation assertion validates intake flag',
  () => {
    assert.throws(
      () => {
        assertActivationProfileForIntake({
          intakeEnabled:
            'true',

          readiness:
            inspectActivationProfile(
              createControlledReadyOptions(),
            ),
        });
      },

      {
        name:
          'TypeError',

        message:
          'intakeEnabled must be a boolean.',
      },
    );
  },
);