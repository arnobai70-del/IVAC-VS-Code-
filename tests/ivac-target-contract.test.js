import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIvacTargetContract,
  createUnverifiedIvacTargetContract,
  getIvacTargetContractSummary,
  validateIvacTargetContract,
} from '../src/contracts/ivac-target-contract.js';


test(
  'unverified IVAC target contract remains fail-closed',
  () => {
    const contract =
      createUnverifiedIvacTargetContract();

    assert.equal(
      contract.verified,
      false,
    );

    assert.equal(
      contract.status,
      'UNVERIFIED',
    );

    assert.equal(
      contract.endpoints.length,
      0,
    );

    assert.equal(
      validateIvacTargetContract(
        contract,
      ),
      false,
    );
  },
);


test(
  'IVAC target contract normalizes verified endpoint metadata',
  () => {
    const contract =
      createIvacTargetContract({
        verified:
          true,

        endpoints: [
          {
            name:
              'health-check',

            method:
              'get',

            path:
              '/health',

            verified:
              true,
          },
        ],
      });

    assert.equal(
      contract.verified,
      true,
    );

    assert.equal(
      contract.status,
      'VERIFIED',
    );

    assert.equal(
      contract.endpoints[0].method,
      'GET',
    );

    assert.equal(
      validateIvacTargetContract(
        contract,
      ),
      true,
    );
  },
);


test(
  'IVAC target contract rejects invalid endpoint paths',
  () => {
    assert.throws(
      () =>
        createIvacTargetContract({
          endpoints: [
            {
              name:
                'invalid',

              method:
                'GET',

              path:
                'https://example.com',

              verified:
                true,
            },
          ],
        }),
    );
  },
);


test(
  'IVAC target contract summary exposes bounded metadata only',
  () => {
    const contract =
      createIvacTargetContract({
        endpoints: [
          {
            name:
              'status',

            method:
              'POST',

            path:
              '/status',

            verified:
              true,
          },
        ],
      });

    const summary =
      getIvacTargetContractSummary(
        contract,
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
          1,

        endpoints: [
          {
            name:
              'status',

            method:
              'POST',

            path:
              '/status',

            verified:
              true,
          },
        ],
      },
    );
  },
);