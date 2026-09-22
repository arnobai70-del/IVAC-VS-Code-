import assert from 'node:assert/strict';

import {
  createServer,
} from 'node:http';

import test from 'node:test';

import {
  PortalClient,
  PORTAL_HEALTH_STATES,
} from '../src/portal/portal-client.js';

async function startServer(
  handler,
) {
  const server =
    createServer(
      handler,
    );

  await new Promise(
    (
      resolve,
      reject,
    ) => {
      server.once(
        'error',
        reject,
      );

      server.listen(
        0,
        '127.0.0.1',
        resolve,
      );
    },
  );

  const address =
    server.address();

  return {
    server,

    baseUrl:
      `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(
  server,
) {
  await new Promise(
    (
      resolve,
      reject,
    ) => {
      server.close(
        (error) => {
          if (error) {
            reject(
              error,
            );

            return;
          }

          resolve();
        },
      );
    },
  );
}

test(
  'TEST K: Portal health check never consumes pending applications',
  async () => {
    let healthRequests = 0;
    let pendingRequests = 0;

    const {
      server,
      baseUrl,
    } = await startServer(
      (
        request,
        response,
      ) => {
        if (
          request.url
          === '/api/novaflow/v1/ping'
        ) {
          healthRequests += 1;

          assert.equal(
            request.method,
            'GET',
          );

          assert.equal(
            request.headers.authorization,
            'Bearer test-token',
          );

          response.writeHead(
            200,
            {
              'Content-Type':
                'application/json',
            },
          );

          response.end(
            JSON.stringify({
              ok:
                true,

              service:
                'NovaFlow API',

              version:
                'v1',

              time:
                '2026-09-22T00:00:00+06:00',

              token_id:
                1,
            }),
          );

          return;
        }

        if (
          request.url
          === '/api/application/pending'
        ) {
          pendingRequests += 1;

          response.writeHead(
            204,
          );

          response.end();

          return;
        }

        response.writeHead(
          404,
        );

        response.end();
      },
    );

    try {
      const client =
        new PortalClient({
          baseUrl,

          pendingPath:
            '/api/application/pending',

          healthPath:
            '/api/novaflow/v1/ping',

          workerServerName:
            'gw.dataimpulse.com',

          timeoutMs:
            2000,

          maxResponseBytes:
            1024,

          accessToken:
            'test-token',
        });

      const result =
        await client
          .healthCheck();

      assert.equal(
        result.status,
        PORTAL_HEALTH_STATES
          .API_AUTHENTICATED,
      );

      assert.equal(
        result.safeToConsume,
        true,
      );

      assert.equal(
        healthRequests,
        1,
      );

      assert.equal(
        pendingRequests,
        0,
      );
    } finally {
      await closeServer(
        server,
      );
    }
  },
);

test(
  'pending request sends static Portal worker Server-Name, no Bearer token, and no request body',
  async () => {
    let receivedBody = '';

    const {
      server,
      baseUrl,
    } = await startServer(
      (
        request,
        response,
      ) => {
        request.on(
          'data',
          (chunk) => {
            receivedBody +=
              chunk.toString();
          },
        );

        request.on(
          'end',
          () => {
            assert.equal(
              request.method,
              'GET',
            );

            assert.equal(
              request.headers[
                'server-name'
              ],
              'gw.dataimpulse.com',
            );

            assert.equal(
              request.headers.authorization,
              undefined,
            );

            response.writeHead(
              200,
              {
                'Content-Type':
                  'application/json',
              },
            );

            response.end(
              JSON.stringify({
                data: {
                  id:
                    123,
                },
              }),
            );
          },
        );
      },
    );

    try {
      const client =
        new PortalClient({
          baseUrl,

          pendingPath:
            '/api/application/pending',

          healthPath:
            '/api/novaflow/v1/ping',

          workerServerName:
            'gw.dataimpulse.com',

          timeoutMs:
            2000,

          maxResponseBytes:
            1024,

          accessToken:
            'test-token',
        });

      const result =
        await client
          .fetchPendingOne();

      assert.deepEqual(
        result,
        {
          data: {
            id:
              123,
          },
        },
      );

      assert.equal(
        receivedBody,
        '',
      );
    } finally {
      await closeServer(
        server,
      );
    }
  },
);

test(
  'pending request does not require Portal API token',
  async () => {
    let requestCount = 0;

    const client =
      new PortalClient({
        baseUrl:
          'https://example.invalid',

        pendingPath:
          '/api/application/pending',

        healthPath:
          '/api/novaflow/v1/ping',

        workerServerName:
          'gw.dataimpulse.com',

        timeoutMs:
          1000,

        maxResponseBytes:
          1024,

        accessToken:
          null,

        requestFn:
          async (
            url,
            options,
          ) => {
            requestCount += 1;

            assert.equal(
              url,
              'https://example.invalid/api/application/pending',
            );

            assert.equal(
              options.headers[
                'Server-Name'
              ],
              'gw.dataimpulse.com',
            );

            assert.equal(
              options.headers.Authorization,
              undefined,
            );

            return {
              statusCode:
                204,

              body: {
                async dump() {},
              },
            };
          },
      });

    const result =
      await client
        .fetchPendingOne();

    assert.equal(
      result,
      null,
    );

    assert.equal(
      requestCount,
      1,
    );
  },
);

test(
  'health HTTP 200 without verified NovaFlow acknowledgement fails closed',
  async () => {
    const client =
      new PortalClient({
        baseUrl:
          'https://example.invalid',

        pendingPath:
          '/api/application/pending',

        healthPath:
          '/api/novaflow/v1/ping',

        workerServerName:
          'gw.dataimpulse.com',

        timeoutMs:
          1000,

        maxResponseBytes:
          1024,

        accessToken:
          'test-token',

        requestFn:
          async () => ({
            statusCode:
              200,

            body: {
              async *[Symbol.asyncIterator]() {
                yield Buffer.from(
                  JSON.stringify({
                    ok:
                      true,
                  }),
                );
              },
            },
          }),
      });

    const result =
      await client
        .healthCheck();

    assert.equal(
      result.status,
      PORTAL_HEALTH_STATES
        .INVALID_HEALTH_RESPONSE,
    );

    assert.equal(
      result.reachable,
      true,
    );

    assert.equal(
      result.authenticated,
      false,
    );

    assert.equal(
      result.safeToConsume,
      false,
    );
  },
);

test(
  'missing Portal API token makes authenticated health readiness fail closed',
  async () => {
    let requests = 0;

    const client =
      new PortalClient({
        baseUrl:
          'https://example.invalid',

        pendingPath:
          '/api/application/pending',

        healthPath:
          '/api/novaflow/v1/ping',

        workerServerName:
          'gw.dataimpulse.com',

        timeoutMs:
          1000,

        maxResponseBytes:
          1024,

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

    const result =
      await client
        .healthCheck();

    assert.equal(
      result.status,
      PORTAL_HEALTH_STATES
        .AUTH_NOT_CONFIGURED,
    );

    assert.equal(
      result.safeToConsume,
      false,
    );

    assert.equal(
      requests,
      0,
    );
  },
);

test(
  'missing static Portal worker identity blocks destructive pending request before network send',
  async () => {
    let requests = 0;

    const client =
      new PortalClient({
        baseUrl:
          'https://example.invalid',

        pendingPath:
          '/api/application/pending',

        healthPath:
          '/api/novaflow/v1/ping',

        workerServerName:
          null,

        timeoutMs:
          1000,

        maxResponseBytes:
          1024,

        accessToken:
          'test-token',

        requestFn:
          async () => {
            requests += 1;

            throw new Error(
              'must not be called',
            );
          },
      });

    await assert.rejects(
      client.fetchPendingOne(),
      /static worker Server-Name is not configured/i,
    );

    assert.equal(
      requests,
      0,
    );
  },
);

test(
  'missing safe health route does not make any network request',
  async () => {
    let requests = 0;

    const client =
      new PortalClient({
        baseUrl:
          'https://example.invalid',

        pendingPath:
          '/api/application/pending',

        healthPath:
          null,

        workerServerName:
          'gw.dataimpulse.com',

        timeoutMs:
          1000,

        maxResponseBytes:
          1024,

        accessToken:
          'test-token',

        requestFn:
          async () => {
            requests += 1;

            throw new Error(
              'must not be called',
            );
          },
      });

    const result =
      await client
        .healthCheck();

    assert.equal(
      result.status,
      PORTAL_HEALTH_STATES
        .HEALTH_ROUTE_NOT_CONFIGURED,
    );

    assert.equal(
      result.safeToConsume,
      false,
    );

    assert.equal(
      requests,
      0,
    );
  },
);