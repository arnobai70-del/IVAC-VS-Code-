import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PortalResultClient,
} from '../src/portal/portal-result-client.js';

import {
  FINAL_RESULT_ERROR_CODES,
} from '../src/results/final-result-errors.js';

function makeInputs() {
  return {
    record: {
      id:
        'result-1',

      jobId:
        'job-1',

      applicationId:
        'app-1',

      outcome:
        'SUCCESS',

      terminalState:
        'COMPLETED',

      code:
        'OK',

      message:
        'Done',

      data: {
        reference:
          'safe-ref',
      },

      payloadHash:
        'hash',

      idempotencyKey:
        'idem',

      deliveryAttempts:
        1,

      canonicalPayload:
        'must-not-be-forwarded',
    },

    job: {
      id:
        'job-1',

      applicationId:
        'app-1',

      userId:
        'user-1',

      state:
        'RUNNING',

      failureMessage:
        'must-not-be-forwarded',
    },

    allocation: {
      allocationId:
        'allocation-1',

      jobId:
        'job-1',

      proxyId:
        'proxy-1',

      ip:
        '203.0.113.10',

      port:
        8080,

      releaseReason:
        'must-not-be-forwarded',
    },
  };
}

test(
  'unverified Portal result contract is blocked before any send',
  async () => {
    const client =
      new PortalResultClient();

    await assert.rejects(
      client.sendResult(
        makeInputs(),
      ),

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .PORTAL_RESULT_NOT_CONFIGURED
      ),
    );
  },
);

test(
  'Portal result client forwards only bounded safe delivery context',
  async () => {
    let received =
      null;

    const client =
      new PortalResultClient({
        contract: {
          supportsIdempotentReplay:
            true,

          async send(value) {
            received =
              value;

            return {
              accepted:
                true,

              statusCode:
                200,
            };
          },
        },
      });

    const acknowledgement =
      await client.sendResult(
        makeInputs(),
      );

    assert.deepEqual(
      acknowledgement,
      {
        accepted:
          true,

        statusCode:
          200,
      },
    );

    assert.equal(
      received.result
        .canonicalPayload,
      undefined,
    );

    assert.equal(
      received.job
        .failureMessage,
      undefined,
    );

    assert.equal(
      received.allocation
        .releaseReason,
      undefined,
    );

    assert.equal(
      received.allocation
        .assignedIp,
      '203.0.113.10',
    );

    assert.equal(
      received.result
        .idempotencyKey,
      'idem',
    );
  },
);

test(
  'Portal result client requires explicit accepted acknowledgement',
  async () => {
    const client =
      new PortalResultClient({
        contract: {
          async send() {
            return {
              accepted:
                false,
            };
          },
        },
      });

    await assert.rejects(
      client.sendResult(
        makeInputs(),
      ),

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .PORTAL_RESULT_RESPONSE_ERROR
      ),
    );
  },
);

test(
  'Portal result client rejects invalid HTTP status metadata',
  async () => {
    const client =
      new PortalResultClient({
        contract: {
          async send() {
            return {
              accepted:
                true,

              statusCode:
                999,
            };
          },
        },
      });

    await assert.rejects(
      client.sendResult(
        makeInputs(),
      ),

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .PORTAL_RESULT_RESPONSE_ERROR
      ),
    );
  },
);