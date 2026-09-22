import assert from 'node:assert/strict';

import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  TargetHttpClient,
} from '../src/workflow/target-http-client.js';


function createClient({
  contract,
  requestFn,
}) {
  return new TargetHttpClient({
    baseUrl:
      'https://api.example.test/iams/api/v1',

    timeoutMs:
      15000,

    contract,

    jobHttpClient: {
      request:
        requestFn,
    },
  });
}


function createDocument() {
  return {
    id:
      'document-1',

    name:
      'example.pdf',

    contentType:
      'application/pdf',

    sizeBytes:
      24,

    sha256:
      'safe-test-hash',

    sourceOrigin:
      'https://portal.example.test',

    sourcePath:
      '/example.pdf',

    buffer:
      Buffer.from(
        '%PDF-1.7\nexample\n%%EOF\n',
        'ascii',
      ),
  };
}


test(
  'verified path does not authorize a different HTTP method',
  async () => {
    let requestCalls =
      0;

    const contract = {
      version:
        1,

      status:
        'VERIFIED',

      verified:
        true,

      endpoints: [
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
    };

    const client =
      createClient({
        contract,

        async requestFn() {
          requestCalls += 1;

          throw new Error(
            'network request must not execute',
          );
        },
      });

    await assert.rejects(
      () =>
        client.requestStep({
          stepId:
            'wrong-method',

          method:
            'GET',

          route:
            '/example',

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
            .WORKFLOW_STEP_ERROR
        &&
        /HTTP method is not present for this route/
          .test(
            error.message,
          ),
    );

    assert.equal(
      requestCalls,
      0,
    );
  },
);


test(
  'verified method and path pair executes through the job HTTP client',
  async () => {
    let requestCalls =
      0;

    let receivedMethod =
      null;

    let receivedUrl =
      null;

    const contract = {
      version:
        1,

      status:
        'VERIFIED',

      verified:
        true,

      endpoints: [
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
    };

    const client =
      createClient({
        contract,

        async requestFn(
          url,
          options,
        ) {
          requestCalls += 1;

          receivedMethod =
            options.method;

          receivedUrl =
            url;

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
      });

    const result =
      await client.requestStep({
        stepId:
          'correct-method',

        method:
          'post',

        route:
          '/example',

        headers: {},

        body: {
          value:
            'safe-test',
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
      requestCalls,
      1,
    );

    assert.equal(
      receivedMethod,
      'POST',
    );

    assert.equal(
      receivedUrl,
      'https://api.example.test/iams/api/v1/example',
    );

    assert.equal(
      result.data.ok,
      true,
    );
  },
);


test(
  'PDF upload requires POST verification for the exact target path',
  async () => {
    let requestCalls =
      0;

    const contract = {
      version:
        1,

      status:
        'VERIFIED',

      verified:
        true,

      endpoints: [
        {
          name:
            'document-read-only',

          method:
            'GET',

          path:
            '/documents/upload',

          verified:
            true,
        },
      ],
    };

    const client =
      createClient({
        contract,

        async requestFn() {
          requestCalls += 1;

          throw new Error(
            'network request must not execute',
          );
        },
      });

    await assert.rejects(
      () =>
        client.uploadPdf({
          stepId:
            'upload-document',

          route:
            '/documents/upload',

          headers: {},

          fieldName:
            'file',

          fields: {},

          document:
            createDocument(),

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
            .WORKFLOW_STEP_ERROR
        &&
        /HTTP method is not present for this route/
          .test(
            error.message,
          ),
    );

    assert.equal(
      requestCalls,
      0,
    );
  },
);