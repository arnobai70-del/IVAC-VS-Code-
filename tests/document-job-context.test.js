import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JobContext,
} from '../src/jobs/job-context.js';

function createContext(
  jobId,
) {
  return new JobContext({
    job: {
      id:
        jobId,
    },

    allocation: {
      allocationId:
        `allocation-${jobId}`,

      jobId,

      proxyId:
        `proxy-${jobId}`,

      ip:
        '203.0.113.50',

      port:
        8080,
    },

    dispatcher: {},

    cookieJar: {
      clear() {},
    },

    session: {
      jobId,

      allocationId:
        `allocation-${jobId}`,
    },
  });
}

test('PDF buffers are copied into the requesting job context and remain isolated', () => {
  const sourceBuffer =
    Buffer.from(
      '%PDF-1.7\nA\n%%EOF\n',
      'ascii',
    );

  const first =
    createContext(
      'job-1',
    );

  const second =
    createContext(
      'job-2',
    );

  first.setDocuments([
    {
      id:
        'pdf-a',

      name:
        'a.pdf',

      buffer:
        sourceBuffer,
    },
  ]);

  sourceBuffer[0] =
    0x58;

  assert.equal(
    first.documents[0]
      .buffer
      .toString(
        'ascii',
        0,
        5,
      ),
    '%PDF-',
  );

  assert.equal(
    second.documents
      .length,
    0,
  );

  first.setDocumentUpload(
    'upload',
    'pdf-a',
    {
      statusCode:
        200,
    },
  );

  assert.equal(
    first.getDocumentUpload(
      'upload',
      'pdf-a',
    ).statusCode,
    200,
  );

  assert.equal(
    second.getDocumentUpload(
      'upload',
      'pdf-a',
    ),
    null,
  );
});