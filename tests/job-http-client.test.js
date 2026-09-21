import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  CookieJar,
} from '../src/session/cookie-jar.js';

import {
  JobHttpClient,
} from '../src/session/job-http-client.js';

function createBody(value) {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        value,
        'utf8',
      );
    },

    async dump() {},
  };
}

function createSession() {
  return {
    jobId: 'job-1',
    allocationId: 'allocation-1',
    proxyId: 'proxy-1',
    assignedIp: '203.0.113.191',
    port: 8080,
    dispatcher: {
      id: 'dispatcher-1',
    },
    cookieJar:
      new CookieJar(),
    closed: false,
  };
}

test('per-job HTTP client always uses the job dispatcher', async () => {
  const session =
    createSession();

  let receivedDispatcher =
    null;

  const client =
    new JobHttpClient({
      session,

      requestFn:
        async (
          url,
          options,
        ) => {
          assert.equal(
            url,
            'https://example.test/data',
          );

          receivedDispatcher =
            options.dispatcher;

          return {
            statusCode: 200,
            headers: {},
            body:
              createBody(
                '{"ok":true}',
              ),
          };
        },
    });

  const response =
    await client.requestJson(
      'https://example.test/data',
    );

  assert.equal(
    receivedDispatcher,
    session.dispatcher,
  );

  assert.equal(
    response.json.ok,
    true,
  );
});

test('cookies from one response remain inside that job session', async () => {
  const session =
    createSession();

  let requestCount = 0;

  const client =
    new JobHttpClient({
      session,

      requestFn:
        async (
          url,
          options,
        ) => {
          requestCount += 1;

          if (requestCount === 1) {
            assert.equal(
              options.headers.Cookie,
              undefined,
            );

            return {
              statusCode: 200,

              headers: {
                'set-cookie': [
                  'session=abc123; Path=/; HttpOnly',
                ],
              },

              body:
                createBody(
                  '{"first":true}',
                ),
            };
          }

          assert.equal(
            options.headers.Cookie,
            'session=abc123',
          );

          return {
            statusCode: 200,
            headers: {},
            body:
              createBody(
                '{"second":true}',
              ),
          };
        },
    });

  await client.requestJson(
    'https://example.test/start',
  );

  const second =
    await client.requestJson(
      'https://example.test/next',
    );

  assert.equal(
    second.json.second,
    true,
  );
});

test('closed session cannot issue HTTP requests', async () => {
  const session =
    createSession();

  session.closed = true;

  const client =
    new JobHttpClient({
      session,

      requestFn:
        async () => {
          throw new Error(
            'must not be called',
          );
        },
    });

  await assert.rejects(
    () =>
      client.request(
        'https://example.test/',
      ),

    (error) => (
      error.code
      === ERROR_CODES.SESSION_CLOSED
    ),
  );
});

test('HTTP 429 is structured as retryable rate limit error', async () => {
  const session =
    createSession();

  const client =
    new JobHttpClient({
      session,

      requestFn:
        async () => ({
          statusCode: 429,
          headers: {},
          body: {
            async dump() {},
          },
        }),
    });

  await assert.rejects(
    () =>
      client.request(
        'https://example.test/',
      ),

    (error) => (
      error.code
      === ERROR_CODES.HTTP_429
      && error.retryable === true
    ),
  );
});