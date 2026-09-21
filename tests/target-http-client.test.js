import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  TargetHttpClient,
} from '../src/workflow/target-http-client.js';

test('target client keeps workflow route under configured API base path and uses job HTTP client', async () => {
  let receivedUrl =
    null;

  let receivedOptions =
    null;

  const client =
    new TargetHttpClient({
      baseUrl:
        'https://api.example.test/iams/api/v1',

      timeoutMs:
        15000,

      jobHttpClient: {
        async request(
          url,
          options,
        ) {
          receivedUrl =
            url;

          receivedOptions =
            options;

          return {
            statusCode:
              200,

            headers: {
              'content-type':
                'application/json',
            },

            body:
              Buffer.from(
                '{"ok":true}',
              ),
          };
        },
      },
    });

  const response =
    await client.requestStep({
      stepId:
        'example',

      method:
        'POST',

      route:
        '/auth/example',

      headers: {
        Accept:
          'application/json',
      },

      body: {
        value:
          'test',
      },

      expect: {
        statuses: [
          200,
        ],

        response:
          'json',
      },
    });

  assert.equal(
    receivedUrl,
    'https://api.example.test/iams/api/v1/auth/example',
  );

  assert.equal(
    receivedOptions
      .maxRedirections,
    0,
  );

  assert.equal(
    receivedOptions
      .timeoutMs,
    15000,
  );

  assert.equal(
    JSON.parse(
      receivedOptions.body,
    ).value,
    'test',
  );

  assert.equal(
    response.data.ok,
    true,
  );
});

test('absolute target route is rejected instead of creating an external request', async () => {
  let requestCalls =
    0;

  const client =
    new TargetHttpClient({
      baseUrl:
        'https://api.example.test/iams/api/v1',

      timeoutMs:
        15000,

      jobHttpClient: {
        async request() {
          requestCalls += 1;

          throw new Error(
            'must not execute',
          );
        },
      },
    });

  await assert.rejects(
    () =>
      client.requestStep({
        stepId:
          'unsafe',

        method:
          'GET',

        route:
          'https://other.example.test/steal',

        headers: {},

        expect: {
          statuses: [
            200,
          ],

          response:
            'json',
        },
      }),

    (error) =>
      error.code
      === ERROR_CODES
        .WORKFLOW_STEP_ERROR,
  );

  assert.equal(
    requestCalls,
    0,
  );
});

test('workflow cannot inject Cookie or proxy authorization headers', async () => {
  const client =
    new TargetHttpClient({
      baseUrl:
        'https://api.example.test/iams/api/v1',

      timeoutMs:
        15000,

      jobHttpClient: {
        async request() {
          throw new Error(
            'must not execute',
          );
        },
      },
    });

  await assert.rejects(
    () =>
      client.requestStep({
        stepId:
          'cookie-injection',

        method:
          'GET',

        route:
          'example',

        headers: {
          Cookie:
            'session=foreign',
        },

        expect: {
          statuses: [
            200,
          ],

          response:
            'json',
        },
      }),

    (error) =>
      error.code
      === ERROR_CODES
        .WORKFLOW_STEP_ERROR,
  );
});

test('TEST M: anti-bot challenge stops target execution for manual handling', async () => {
  const client =
    new TargetHttpClient({
      baseUrl:
        'https://api.example.test/iams/api/v1',

      timeoutMs:
        15000,

      jobHttpClient: {
        async request() {
          return {
            statusCode:
              403,

            headers: {
              'content-type':
                'text/html',
            },

            body:
              Buffer.from(
                '<html><div class="cf-turnstile"></div></html>',
              ),
          };
        },
      },
    });

  await assert.rejects(
    () =>
      client.requestStep({
        stepId:
          'challenge',

        method:
          'GET',

        route:
          'example',

        headers: {},

        expect: {
          statuses: [
            200,
          ],

          response:
            'json',
        },
      }),

    (error) =>
      error.code
      === ERROR_CODES
        .MANUAL_CHALLENGE_REQUIRED,
  );
});