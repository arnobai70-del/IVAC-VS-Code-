import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  OtpClient,
} from '../src/otp/otp-client.js';

test('OTP client uses existing per-job HTTP client with GET and no body', async () => {
  let receivedUrl =
    null;

  let receivedOptions =
    null;

  const client =
    new OtpClient({
      baseUrl:
        'https://otp.example.test',

      tablePath:
        '/otp_table',

      maxResponseBytes:
        4096,

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
                'text/html; charset=utf-8',
            },

            body:
              Buffer.from(
                '<html><body>ok</body></html>',
              ),
          };
        },
      },
    });

  const html =
    await client
      .fetchTableHtml();

  assert.equal(
    receivedUrl,
    'https://otp.example.test/otp_table',
  );

  assert.equal(
    receivedOptions.method,
    'GET',
  );

  assert.equal(
    receivedOptions.body,
    undefined,
  );

  assert.equal(
    receivedOptions
      .maxRedirections,
    0,
  );

  assert.equal(
    html,
    '<html><body>ok</body></html>',
  );
});

test('OTP challenge page requires manual handling and is never bypassed', async () => {
  const client =
    new OtpClient({
      baseUrl:
        'https://otp.example.test',

      tablePath:
        '/otp_table',

      maxResponseBytes:
        4096,

      jobHttpClient: {
        async request() {
          return {
            statusCode:
              200,

            headers: {
              'content-type':
                'text/html',
            },

            body:
              Buffer.from(
                '<html><body><div class="cf-turnstile"></div></body></html>',
              ),
          };
        },
      },
    });

  await assert.rejects(
    () =>
      client
        .fetchTableHtml(),

    (error) => (
      error.code
      === ERROR_CODES
        .MANUAL_CHALLENGE_REQUIRED
    ),
  );
});

test('OTP redirect requires manual inspection', async () => {
  const client =
    new OtpClient({
      baseUrl:
        'https://otp.example.test',

      tablePath:
        '/otp_table',

      maxResponseBytes:
        4096,

      jobHttpClient: {
        async request() {
          return {
            statusCode:
              302,

            headers: {
              location:
                '/challenge',
            },

            body:
              Buffer.alloc(0),
          };
        },
      },
    });

  await assert.rejects(
    () =>
      client
        .fetchTableHtml(),

    (error) => (
      error.code
      === ERROR_CODES
        .MANUAL_CHALLENGE_REQUIRED
    ),
  );
});