import assert from 'node:assert/strict';

import test from 'node:test';

import {
  createIvacTargetContract,
  validateIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';


test(
  'verified IVAC target contract cannot be empty',
  () => {
    assert.throws(
      () =>
        createIvacTargetContract({
          verified:
            true,

          endpoints:
            [],
        }),

      /requires at least one endpoint definition/,
    );
  },
);


test(
  'verified IVAC target contract rejects unverified endpoints',
  () => {
    assert.throws(
      () =>
        createIvacTargetContract({
          verified:
            true,

          endpoints: [
            {
              name:
                'example',

              method:
                'GET',

              path:
                '/example',

              verified:
                false,
            },
          ],
        }),

      /cannot contain an unverified endpoint/,
    );
  },
);


test(
  'IVAC target contract rejects unsupported HTTP methods',
  () => {
    assert.throws(
      () =>
        createIvacTargetContract({
          endpoints: [
            {
              name:
                'unsafe-method',

              method:
                'CONNECT',

              path:
                '/example',

              verified:
                true,
            },
          ],
        }),

      /Unsupported endpoint method: CONNECT/,
    );
  },
);


test(
  'IVAC target contract rejects network-path endpoint syntax',
  () => {
    assert.throws(
      () =>
        createIvacTargetContract({
          endpoints: [
            {
              name:
                'unsafe-path',

              method:
                'GET',

              path:
                '//other.example.test/example',

              verified:
                true,
            },
          ],
        }),

      /must remain relative to the configured IVAC target API/,
    );
  },
);


test(
  'verified IVAC target contract rejects duplicate method and path pairs',
  () => {
    assert.throws(
      () =>
        createIvacTargetContract({
          verified:
            true,

          endpoints: [
            {
              name:
                'first',

              method:
                'POST',

              path:
                '/example',

              verified:
                true,
            },

            {
              name:
                'second',

              method:
                'post',

              path:
                '/example',

              verified:
                true,
            },
          ],
        }),

      /Duplicate IVAC target contract route: POST \/example/,
    );
  },
);


test(
  'different HTTP methods may share the same verified path',
  () => {
    const contract =
      createIvacTargetContract({
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

          {
            name:
              'example-post',

            method:
              'POST',

            path:
              '/example',

            verified:
              true,
          },
        ],
      });

    assert.equal(
      validateIvacTargetContract(
        contract,
      ),
      true,
    );

    assert.equal(
      contract.endpoints.length,
      2,
    );
  },
);


test(
  'verified boolean cannot be paired with non-VERIFIED status',
  () => {
    const contract = {
      version:
        1,

      status:
        'UNVERIFIED',

      verified:
        true,

      endpoints: [
        {
          name:
            'example',

          method:
            'GET',

          path:
            '/example',

          verified:
            true,
        },
      ],
    };

    assert.throws(
      () =>
        validateIvacTargetContract(
          contract,
        ),

      /must declare VERIFIED status/,
    );
  },
);