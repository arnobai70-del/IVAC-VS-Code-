import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  TargetHttpClient,
} from '../src/workflow/target-http-client.js';

function documentFixture() {
  return {
    id:
      'pdf-example',

    name:
      'passport.pdf',

    contentType:
      'application/pdf',

    sizeBytes:
      24,

    sha256:
      'abc',

    sourceOrigin:
      'https://portal.example.test',

    sourcePath:
      '/passport.pdf',

    buffer:
      Buffer.from(
        '%PDF-1.7\nexample\n%%EOF\n',
        'ascii',
      ),
  };
}

test('prepared PDF is uploaded as multipart through the same job HTTP client', async () => {
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
                '{"uploaded":true}',
              ),
          };
        },
      },
    });

  const result =
    await client.uploadPdf({
      stepId:
        'upload_pdf',

      route:
        'documents/upload',

      headers: {
        Accept:
          'application/json',
      },

      fieldName:
        'file',

      fields: {
        application_id:
          'app-1',
      },

      document:
        documentFixture(),

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
    'https://api.example.test/iams/api/v1/documents/upload',
  );

  assert.equal(
    receivedOptions.method,
    'POST',
  );

  assert.equal(
    receivedOptions
      .maxRedirections,
    0,
  );

  assert.equal(
    receivedOptions
      .headers
      ['Content-Type']
      .startsWith(
        'multipart/form-data; boundary=',
      ),
    true,
  );

  assert.equal(
    Buffer.isBuffer(
      receivedOptions.body,
    ),
    true,
  );

  const multipartText =
    receivedOptions.body
      .toString(
        'latin1',
      );

  assert.equal(
    multipartText.includes(
      'name="file"; filename="passport.pdf"',
    ),
    true,
  );

  assert.equal(
    multipartText.includes(
      'Content-Type: application/pdf',
    ),
    true,
  );

  assert.equal(
    multipartText.includes(
      '%PDF-1.7',
    ),
    true,
  );

  assert.equal(
    result.data.uploaded,
    true,
  );
});

test('workflow cannot manually override multipart Content-Type', async () => {
  let calls =
    0;

  const client =
    new TargetHttpClient({
      baseUrl:
        'https://api.example.test/iams/api/v1',

      timeoutMs:
        15000,

      jobHttpClient: {
        async request() {
          calls += 1;

          throw new Error(
            'must not run',
          );
        },
      },
    });

  await assert.rejects(
    () =>
      client.uploadPdf({
        stepId:
          'upload_pdf',

        route:
          'documents/upload',

        headers: {
          'Content-Type':
            'multipart/form-data; boundary=attacker',
        },

        fieldName:
          'file',

        document:
          documentFixture(),

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
    calls,
    0,
  );
});

test('challenge during PDF upload requires manual handling', async () => {
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
      client.uploadPdf({
        stepId:
          'upload_pdf',

        route:
          'documents/upload',

        headers: {},

        fieldName:
          'file',

        document:
          documentFixture(),

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