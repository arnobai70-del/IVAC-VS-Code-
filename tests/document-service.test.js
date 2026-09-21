import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCUMENT_ERROR_CODES,
} from '../src/documents/document-errors.js';

import {
  DocumentService,
} from '../src/documents/document-service.js';

function makePdf(
  label = 'example',
) {
  return Buffer.from(
    `%PDF-1.7\n${label}\n%%EOF\n`,
    'ascii',
  );
}

function createJobContext() {
  return {
    documents: [],

    setDocuments(
      documents,
    ) {
      this.documents =
        documents.map(
          (document) => ({
            ...document,

            buffer:
              Buffer.from(
                document.buffer,
              ),
          }),
        );
    },
  };
}

test('Portal PDF references are downloaded, validated, and attached to one job context', async () => {
  const requested = [];

  const service =
    new DocumentService({
      maxCount:
        5,

      maxFileBytes:
        1024 * 1024,

      maxTotalBytes:
        2 * 1024 * 1024,

      documentClient: {
        async download(
          url,
        ) {
          requested.push(
            url,
          );

          return {
            sourceOrigin:
              'https://portal.example.test',

            sourcePath:
              url,

            contentType:
              'application/pdf; charset=binary',

            body:
              makePdf(
                url,
              ),
          };
        },
      },
    });

  const context =
    createJobContext();

  const result =
    await service
      .prepareForJobContext({
        jobContext:
          context,

        sources: [
          {
            url:
              '/passport.pdf',

            name:
              'passport.pdf',
          },

          '/visa.pdf',
        ],
      });

  assert.equal(
    requested.length,
    2,
  );

  assert.equal(
    result.count,
    2,
  );

  assert.equal(
    context.documents
      .length,
    2,
  );

  assert.equal(
    context.documents[0]
      .contentType,
    'application/pdf',
  );

  assert.equal(
    Buffer.isBuffer(
      context.documents[0]
        .buffer,
    ),
    true,
  );

  assert.equal(
    result.documents[0]
      .buffer,
    undefined,
  );
});

test('non-PDF Content-Type fails closed', async () => {
  const service =
    new DocumentService({
      maxCount:
        5,

      maxFileBytes:
        1024 * 1024,

      maxTotalBytes:
        2 * 1024 * 1024,

      documentClient: {
        async download() {
          return {
            sourceOrigin:
              'https://portal.example.test',

            sourcePath:
              '/fake.pdf',

            contentType:
              'text/html',

            body:
              makePdf(),
          };
        },
      },
    });

  await assert.rejects(
    () =>
      service
        .prepareForJobContext({
          jobContext:
            createJobContext(),

          sources: [
            '/fake.pdf',
          ],
        }),

    (error) =>
      error.code
      === DOCUMENT_ERROR_CODES
        .DOCUMENT_VALIDATION_ERROR,
  );
});

test('invalid PDF signature fails closed', async () => {
  const service =
    new DocumentService({
      maxCount:
        5,

      maxFileBytes:
        1024 * 1024,

      maxTotalBytes:
        2 * 1024 * 1024,

      documentClient: {
        async download() {
          return {
            sourceOrigin:
              'https://portal.example.test',

            sourcePath:
              '/fake.pdf',

            contentType:
              'application/pdf',

            body:
              Buffer.from(
                '<html>not a pdf</html>',
              ),
          };
        },
      },
    });

  await assert.rejects(
    () =>
      service
        .prepareForJobContext({
          jobContext:
            createJobContext(),

          sources: [
            '/fake.pdf',
          ],
        }),

    (error) =>
      error.code
      === DOCUMENT_ERROR_CODES
        .DOCUMENT_VALIDATION_ERROR,
  );
});

test('document count is bounded before downloads begin', async () => {
  let calls =
    0;

  const service =
    new DocumentService({
      maxCount:
        1,

      maxFileBytes:
        1024 * 1024,

      maxTotalBytes:
        2 * 1024 * 1024,

      documentClient: {
        async download() {
          calls += 1;

          throw new Error(
            'must not run',
          );
        },
      },
    });

  await assert.rejects(
    () =>
      service
        .prepareForJobContext({
          jobContext:
            createJobContext(),

          sources: [
            '/one.pdf',
            '/two.pdf',
          ],
        }),

    (error) =>
      error.code
      === DOCUMENT_ERROR_CODES
        .DOCUMENT_VALIDATION_ERROR,
  );

  assert.equal(
    calls,
    0,
  );
});

test('duplicate PDF content for one job is rejected', async () => {
  const body =
    makePdf(
      'same',
    );

  const service =
    new DocumentService({
      maxCount:
        5,

      maxFileBytes:
        1024 * 1024,

      maxTotalBytes:
        2 * 1024 * 1024,

      documentClient: {
        async download(
          url,
        ) {
          return {
            sourceOrigin:
              'https://portal.example.test',

            sourcePath:
              url,

            contentType:
              'application/pdf',

            body:
              Buffer.from(
                body,
              ),
          };
        },
      },
    });

  await assert.rejects(
    () =>
      service
        .prepareForJobContext({
          jobContext:
            createJobContext(),

          sources: [
            '/one.pdf',
            '/two.pdf',
          ],
        }),

    (error) =>
      error.code
      === DOCUMENT_ERROR_CODES
        .DOCUMENT_VALIDATION_ERROR,
  );
});