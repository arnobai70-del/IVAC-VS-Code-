import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSecretReadinessForIntake,
  inspectSecretReadiness,
} from '../src/runtime/secret-readiness.js';


function createReadyOptions() {
  return {
    intakeEnabled:
      true,

    portalResultEnabled:
      true,

    portalApiAccessToken:
      'test-secret-token',
  };
}


test(
  'safe disabled startup does not require production secrets',
  () => {
    const result =
      inspectSecretReadiness({
        intakeEnabled:
          false,

        portalResultEnabled:
          false,

        portalApiAccessToken:
          null,
      });

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
          false,

        portalResultEnabled:
          false,

        portalApiAccessTokenConfigured:
          false,
      },
    );

    assert.deepEqual(
      result.secrets,
      {
        portalApiAccessTokenConfigured:
          false,
      },
    );
  },
);


test(
  'enabled intake requires Portal result activation and API token',
  () => {
    const result =
      inspectSecretReadiness({
        intakeEnabled:
          true,

        portalResultEnabled:
          false,

        portalApiAccessToken:
          null,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PORTAL_RESULT_DISABLED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PORTAL_RESULT_DISABLED',
        'PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED',
      ],
    );

    assert.deepEqual(
      result.gates,
      {
        intakeEnabled:
          true,

        portalResultEnabled:
          false,

        portalApiAccessTokenConfigured:
          false,
      },
    );
  },
);


test(
  'enabled intake fails closed when Portal API token is missing',
  () => {
    const result =
      inspectSecretReadiness({
        intakeEnabled:
          true,

        portalResultEnabled:
          true,

        portalApiAccessToken:
          null,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED',
      ],
    );

    assert.equal(
      result.gates
        .portalApiAccessTokenConfigured,
      false,
    );
  },
);


test(
  'blank Portal API token is treated as not configured',
  () => {
    const result =
      inspectSecretReadiness({
        intakeEnabled:
          true,

        portalResultEnabled:
          true,

        portalApiAccessToken:
          '   ',
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED',
    );

    assert.equal(
      result.secrets
        .portalApiAccessTokenConfigured,
      false,
    );
  },
);


test(
  'enabled intake is secret-ready only when required activation and token exist',
  () => {
    const result =
      inspectSecretReadiness(
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

        portalResultEnabled:
          true,

        portalApiAccessTokenConfigured:
          true,
      },
    );

    assert.deepEqual(
      result.secrets,
      {
        portalApiAccessTokenConfigured:
          true,
      },
    );
  },
);


test(
  'secret readiness output never exposes the Portal API token',
  () => {
    const secret =
      'highly-sensitive-test-token';

    const result =
      inspectSecretReadiness({
        intakeEnabled:
          true,

        portalResultEnabled:
          true,

        portalApiAccessToken:
          secret,
      });

    const serialized =
      JSON.stringify(
        result,
      );

    assert.equal(
      serialized.includes(
        secret,
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        result,
        'portalApiAccessToken',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        result.secrets,
        'portalApiAccessToken',
      ),
      false,
    );

    assert.equal(
      result.secrets
        .portalApiAccessTokenConfigured,
      true,
    );
  },
);


test(
  'secret readiness result and bounded nested state are frozen',
  () => {
    const result =
      inspectSecretReadiness(
        createReadyOptions(),
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

    assert.equal(
      Object.isFrozen(
        result.secrets,
      ),
      true,
    );
  },
);


test(
  'disabled intake may inspect missing secrets without startup failure',
  () => {
    const readiness =
      inspectSecretReadiness({
        intakeEnabled:
          false,

        portalResultEnabled:
          false,

        portalApiAccessToken:
          null,
      });

    const result =
      assertSecretReadinessForIntake({
        intakeEnabled:
          false,

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
  },
);


test(
  'enabled intake fails closed when secret readiness is blocked',
  () => {
    const readiness =
      inspectSecretReadiness({
        intakeEnabled:
          true,

        portalResultEnabled:
          true,

        portalApiAccessToken:
          null,
      });

    assert.throws(
      () => {
        assertSecretReadinessForIntake({
          intakeEnabled:
            true,

          readiness,
        });
      },

      /Secret readiness blocked: PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED/,
    );
  },
);


test(
  'enabled intake accepts only ready secret state',
  () => {
    const readiness =
      inspectSecretReadiness(
        createReadyOptions(),
      );

    const result =
      assertSecretReadinessForIntake({
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
  },
);


test(
  'secret readiness validates bounded boolean inputs',
  () => {
    assert.throws(
      () => {
        inspectSecretReadiness({
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
        inspectSecretReadiness({
          ...createReadyOptions(),

          portalResultEnabled:
            1,
        });
      },

      {
        name:
          'TypeError',

        message:
          'portalResultEnabled must be a boolean.',
      },
    );

    assert.throws(
      () => {
        assertSecretReadinessForIntake({
          intakeEnabled:
            null,

          readiness: {
            ready:
              true,

            reason:
              'READY',
          },
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


test(
  'secret readiness assertion rejects malformed readiness objects',
  () => {
    for (
      const readiness
      of [
        null,
        [],
        {},
        {
          ready:
            'true',

          reason:
            'READY',
        },
        {
          ready:
            true,

          reason:
            null,
        },
      ]
    ) {
      assert.throws(
        () => {
          assertSecretReadinessForIntake({
            intakeEnabled:
              true,

            readiness,
          });
        },

        {
          name:
            'TypeError',

          message:
            'readiness must be a valid secret readiness result.',
        },
      );
    }
  },
);