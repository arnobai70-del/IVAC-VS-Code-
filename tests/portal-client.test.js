import assert from 'node:assert/strict';

import {
  createServer,
} from 'node:http';

import test from 'node:test';

import {
  PortalClient,
  PORTAL_HEALTH_STATES,
} from '../src/portal/portal-client.js';

async function startServer(handler) {
  const server =
    createServer(handler);

  await new Promise(
    (resolve, reject) => {
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

async function closeServer(server) {
  await new Promise(
    (resolve, reject) => {
      server.close(
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        },
      );
    },
  );
}

test('TEST K: Portal health check never consumes pending applications', async () => {
  let healthRequests = 0;
  let pendingRequests = 0;

  const {
    server,
    baseUrl,
  } = await startServer(
    (request, response) => {
      if (
        request.url === '/health'
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
            ok: true,
          }),
        );

        return;
      }

      if (
        request.url
        === '/api/application/pending'
      ) {
        pendingRequests += 1;

        response.writeHead(204);
        response.end();
        return;
      }

      response.writeHead(404);
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
          '/health',

        timeoutMs: 2000,
        maxResponseBytes: 1024,
        accessToken:
          'test-token',
      });

    const result =
      await client.healthCheck();

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
    await closeServer(server);
  }
});

test('pending request sends assigned IP in Server-Name and no request body', async () => {
  let receivedBody = '';

  const {
    server,
    baseUrl,
  } = await startServer(
    (request, response) => {
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
            request.headers['server-name'],
            '203.0.113.100',
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
              id: 'app-1',
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
          '/health',

        timeoutMs: 2000,
        maxResponseBytes: 1024,
        accessToken:
          'test-token',
      });

    const result =
      await client.fetchPendingOne({
        serverName:
          '203.0.113.100',
      });

    assert.deepEqual(
      result,
      {
        id: 'app-1',
      },
    );

    assert.equal(
      receivedBody,
      '',
    );
  } finally {
    await closeServer(server);
  }
});

test('missing safe health route does not make any network request', async () => {
  let requests = 0;

  const client =
    new PortalClient({
      baseUrl:
        'https://example.invalid',

      pendingPath:
        '/api/application/pending',

      healthPath: null,

      timeoutMs: 1000,
      maxResponseBytes: 1024,
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
    await client.healthCheck();

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
});