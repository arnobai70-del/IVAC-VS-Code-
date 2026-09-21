import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  DocumentClient,
} from '../src/documents/document-client.js';

import {
  DOCUMENT_ERROR_CODES,
} from '../src/documents/document-errors.js';

function pdfBuffer() {
  return Buffer.from(
    '%PDF-1.7\nexample\n%%EOF\n',
    'ascii',
  );
}

test('Portal PDF download uses existing per-job HTTP client and does not follow redirects', async () => {
  let receivedUrl =
    null;

  let receivedOptions =
    null;

  const client =
    new DocumentClient({
      baseUrl:
        'https://portal.example.test',

      allowedOrigins: [
        'https://portal.example.test',
      ],

      timeoutMs:
        15000,

      maxFileBytes:
        1024 * 1024,

      portalAccessToken:
        'portal-token',

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
                'application/pdf',

              'content-length':
                String(
                  pdfBuffer()
                    .length,
                ),
            },

            body:
              pdfBuffer(),
          };
        },
      },
    });

  const result =
    await client.download(
      '/documents/passport.pdf',
    );

  assert.equal(
    receivedUrl,
    'https://portal.example.test/documents/passport.pdf',
  );

  assert.equal(
    receivedOptions.method,
    'GET',
  );

  assert.equal(
    receivedOptions
      .maxRedirections,
    0,
  );

  assert.equal(
    receivedOptions
      .Authorization,
    undefined,
  );

  assert.equal(
    receivedOptions
      .headers
      .Authorization,
    'Bearer portal-token',
  );

  assert.equal(
    result.contentType,
    'application/pdf',
  );
});

test('Portal token is never forwarded to another allowlisted origin', async () => {
  let receivedHeaders =
    null;

  const client =
    new DocumentClient({
      baseUrl:
        'https://portal.example.test',

      allowedOrigins: [
        'https://portal.example.test',
        'https://storage.example.test',
      ],

      timeoutMs:
        15000,

      maxFileBytes:
        1024 * 1024,

      portalAccessToken:
        'portal-token',

      jobHttpClient: {
        async request(
          url,
          options,
        ) {
          void url;

          receivedHeaders =
            options.headers;

          return {
            statusCode:
              200,

            headers: {
              'content-type':
                'application/pdf',
            },

            body:
              pdfBuffer(),
          };
        },
      },
    });

  await client.download(
    'https://storage.example.test/file.pdf',
  );

  assert.equal(
    receivedHeaders
      .Authorization,
    undefined,
  );
});

test('document client rejects non-allowlisted origin before any network request', async () => {
  let calls =
    0;

  const client =
    new DocumentClient({
      baseUrl:
        'https://portal.example.test',

      allowedOrigins: [
        'https://portal.example.test',
      ],

      timeoutMs:
        15000,

      maxFileBytes:
        1024 * 1024,

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
      client.download(
        'https://evil.example.test/file.pdf',
      ),

    (error) =>
      error.code
      === DOCUMENT_ERROR_CODES
        .DOCUMENT_SOURCE_ERROR,
  );

  assert.equal(
    calls,
    0,
  );
});

test('document challenge stops safely instead of bypassing verification', async () => {
  const client =
    new DocumentClient({
      baseUrl:
        'https://portal.example.test',

      allowedOrigins: [
        'https://portal.example.test',
      ],

      timeoutMs:
        15000,

      maxFileBytes:
        1024 * 1024,

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
      client.download(
        '/file.pdf',
      ),

    (error) =>
      error.code
      === ERROR_CODES
        .MANUAL_CHALLENGE_REQUIRED,
  );
});