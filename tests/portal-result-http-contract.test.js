import assert from 'node:assert/strict';
import {
  Readable,
} from 'node:stream';
import test from 'node:test';

import {
  PortalResultHttpContract,
} from '../src/portal/portal-result-http-contract.js';

import {
  PORTAL_RESULT_DELIVERY_CERTAINTY,
} from '../src/portal/portal-result-client.js';

import {
  FINAL_RESULT_ERROR_CODES,
} from '../src/results/final-result-errors.js';

function response({
  statusCode = 200,
  body = '',
} = {}) {
  return {
    statusCode,

    body:
      Readable.from([
        body,
      ]),
  };
}

function makeResult(
  overrides = {},
) {
  return {
    id:
      'result-1',

    jobId:
      'job-1',

    applicationId:
      '123',

    outcome:
      'SUCCESS',

    terminalState:
      'COMPLETED',

    code:
      'OK',

    message:
      'Workflow completed.',

    data: {
      otp:
        'must-not-send',

      password:
        'must-not-send',

      payment_status:
        'must-not-invent',
    },

    idempotencyKey:
      'local-only-idempotency-key',

    ...overrides,
  };
}

function makeContract({
  requestFn,
  accessToken =
    'test-token',

  workerServerName =
    'gw.dataimpulse.com',
} = {}) {
  return new PortalResultHttpContract({
    baseUrl:
      'https://mrboss.live',

    statusPathTemplate:
      '/api/application/{application}/status',

    workerServerName,

    accessToken,

    timeoutMs:
      2000,

    maxResponseBytes:
      1024 * 1024,

    requestFn:
      requestFn
      ?? (async () =>
        response({
          statusCode:
            200,

          body:
            JSON.stringify({
              data: {
                id:
                  123,

                status:
                  'completed',

                server_name:
                  'gw.dataimpulse.com',
              },
            }),
        })),
  });
}

function assertCertainty(
  expected,
) {
  return (error) => {
    assert.equal(
      error.details
        ?.deliveryCertainty,
      expected,
    );

    return true;
  };
}

test(
  'verified Portal result contract declares remote idempotent replay unsupported',
  () => {
    const contract =
      makeContract();

    assert.equal(
      contract
        .supportsIdempotentReplay,
      false,
    );
  },
);

test(
  'successful final result uses numeric Portal ID, static Server-Name, Bearer auth, and minimal payload',
  async () => {
    let receivedUrl =
      null;

    let receivedOptions =
      null;

    const contract =
      makeContract({
        requestFn:
          async (
            url,
            options,
          ) => {
            receivedUrl =
              url;

            receivedOptions =
              options;

            return response({
              statusCode:
                200,

              body:
                JSON.stringify({
                  data: {
                    id:
                      123,

                    status:
                      'completed',

                    server_name:
                      'gw.dataimpulse.com',
                  },
                }),
            });
          },
      });

    const acknowledgement =
      await contract.send({
        result:
          makeResult(),
      });

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
      receivedUrl,
      'https://mrboss.live/api/application/123/status',
    );

    assert.equal(
      receivedOptions.method,
      'POST',
    );

    assert.equal(
      receivedOptions
        .headers
        .Authorization,
      'Bearer test-token',
    );

    assert.equal(
      receivedOptions
        .headers[
          'Server-Name'
        ],
      'gw.dataimpulse.com',
    );

    const payload =
      JSON.parse(
        receivedOptions.body,
      );

    assert.deepEqual(
      payload,
      {
        status:
          'completed',

        message:
          'Workflow completed.',
      },
    );

    assert.equal(
      payload.otp,
      undefined,
    );

    assert.equal(
      payload.password,
      undefined,
    );

    assert.equal(
      payload.payment_status,
      undefined,
    );

    assert.equal(
      payload.idempotencyKey,
      undefined,
    );

    assert.equal(
      payload.data,
      undefined,
    );
  },
);

test(
  'terminal workflow failure maps only to Portal failed status',
  async () => {
    let sentPayload =
      null;

    const contract =
      makeContract({
        requestFn:
          async (
            url,
            options,
          ) => {
            void url;

            sentPayload =
              JSON.parse(
                options.body,
              );

            return response({
              statusCode:
                200,

              body:
                JSON.stringify({
                  data: {
                    id:
                      123,

                    status:
                      'failed',

                    server_name:
                      'gw.dataimpulse.com',
                  },
                }),
            });
          },
      });

    await contract.send({
      result:
        makeResult({
          outcome:
            'FAILURE',

          terminalState:
            'FAILED_FINAL',

          message:
            'Final workflow failure.',
        }),
    });

    assert.deepEqual(
      sentPayload,
      {
        status:
          'failed',

        message:
          'Final workflow failure.',
      },
    );
  },
);

test(
  'non-terminal final-result input fails before any request is sent',
  async () => {
    let requests = 0;

    const contract =
      makeContract({
        requestFn:
          async () => {
            requests += 1;

            throw new Error(
              'must not be called',
            );
          },
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult({
            outcome:
              'RETRY_PENDING',

            terminalState:
              'RETRY_PENDING',
          }),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .NOT_SENT,
      ),
    );

    assert.equal(
      requests,
      0,
    );
  },
);

test(
  'missing token fails closed before send',
  async () => {
    let requests = 0;

    const contract =
      makeContract({
        accessToken:
          null,

        requestFn:
          async () => {
            requests += 1;

            throw new Error(
              'must not be called',
            );
          },
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .NOT_SENT,
      ),
    );

    assert.equal(
      requests,
      0,
    );
  },
);

test(
  'non-numeric Portal application ID fails closed before send',
  async () => {
    let requests = 0;

    const contract =
      makeContract({
        requestFn:
          async () => {
            requests += 1;

            throw new Error(
              'must not be called',
            );
          },
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult({
            applicationId:
              'external-app-id',
          }),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .NOT_SENT,
      ),
    );

    assert.equal(
      requests,
      0,
    );
  },
);

for (
  const statusCode
  of [
    401,
    403,
    422,
  ]
) {
  test(
    `Portal HTTP ${statusCode} is an explicit rejected delivery`,
    async () => {
      const contract =
        makeContract({
          requestFn:
            async () =>
              response({
                statusCode,

                body:
                  JSON.stringify({
                    message:
                      'Rejected.',
                  }),
              }),
        });

      await assert.rejects(
        contract.send({
          result:
            makeResult(),
        }),

        (error) => {
          assert.equal(
            error.code,
            FINAL_RESULT_ERROR_CODES
              .PORTAL_RESULT_RESPONSE_ERROR,
          );

          assert.equal(
            error.details
              ?.deliveryCertainty,
            PORTAL_RESULT_DELIVERY_CERTAINTY
              .REJECTED,
          );

          assert.equal(
            error.details
              ?.statusCode,
            statusCode,
          );

          return true;
        },
      );
    },
  );
}

test(
  'Portal 5xx is UNCERTAIN because mutation may already have occurred',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () =>
            response({
              statusCode:
                500,

              body:
                'server error',
            }),
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      (error) => {
        assert.equal(
          error.code,
          FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_DELIVERY_UNCERTAIN,
        );

        assert.equal(
          error.details
            ?.deliveryCertainty,
          PORTAL_RESULT_DELIVERY_CERTAINTY
            .UNCERTAIN,
        );

        return true;
      },
    );
  },
);

test(
  'network failure after send initiation is UNCERTAIN',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () => {
            const error =
              new Error(
                'connection reset',
              );

            error.code =
              'ECONNRESET';

            throw error;
          },
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      (error) => {
        assert.equal(
          error.code,
          FINAL_RESULT_ERROR_CODES
            .PORTAL_RESULT_DELIVERY_UNCERTAIN,
        );

        assert.equal(
          error.details
            ?.deliveryCertainty,
          PORTAL_RESULT_DELIVERY_CERTAINTY
            .UNCERTAIN,
        );

        return true;
      },
    );
  },
);

test(
  'timeout after send initiation is UNCERTAIN',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () => {
            const error =
              new Error(
                'timeout',
              );

            error.name =
              'TimeoutError';

            throw error;
          },
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN,
      ),
    );
  },
);

test(
  'HTTP success with mismatched Portal application ID is UNCERTAIN and not accepted',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () =>
            response({
              statusCode:
                200,

              body:
                JSON.stringify({
                  data: {
                    id:
                      999,

                    status:
                      'completed',

                    server_name:
                      'gw.dataimpulse.com',
                  },
                }),
            }),
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN,
      ),
    );
  },
);

test(
  'HTTP success with mismatched terminal status is UNCERTAIN and not accepted',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () =>
            response({
              statusCode:
                200,

              body:
                JSON.stringify({
                  data: {
                    id:
                      123,

                    status:
                      'failed',

                    server_name:
                      'gw.dataimpulse.com',
                  },
                }),
            }),
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN,
      ),
    );
  },
);

test(
  'HTTP success with mismatched Server-Name is UNCERTAIN and not accepted',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () =>
            response({
              statusCode:
                200,

              body:
                JSON.stringify({
                  data: {
                    id:
                      123,

                    status:
                      'completed',

                    server_name:
                      'different-worker',
                  },
                }),
            }),
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN,
      ),
    );
  },
);

test(
  'HTTP success with malformed acknowledgement is UNCERTAIN and not accepted',
  async () => {
    const contract =
      makeContract({
        requestFn:
          async () =>
            response({
              statusCode:
                200,

              body:
                JSON.stringify({
                  ok:
                    true,
                }),
            }),
      });

    await assert.rejects(
      contract.send({
        result:
          makeResult(),
      }),

      assertCertainty(
        PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN,
      ),
    );
  },
);