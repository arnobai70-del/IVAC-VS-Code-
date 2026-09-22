import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJobDocumentService,
} from '../src/runtime/job-document-service.js';

function createJobHttpClient() {
  return {
    async request() {
      throw new Error(
        'Network request was not expected in this test.',
      );
    },
  };
}

function createClientConfig() {
  return {
    baseUrl:
      'https://portal.example',

    allowedOrigins: [
      'https://portal.example',
      'https://cdn.example',
    ],

    timeoutMs:
      15000,

    maxFileBytes:
      5 * 1024 * 1024,

    portalAccessToken:
      'test-token',
  };
}

function createServiceConfig() {
  return {
    maxCount:
      5,

    maxFileBytes:
      5 * 1024 * 1024,

    maxTotalBytes:
      20 * 1024 * 1024,
  };
}

test(
  'document pipeline uses the exact supplied per-job HTTP client',
  () => {
    const jobHttpClient =
      createJobHttpClient();

    const pipeline =
      createJobDocumentService({
        jobHttpClient,

        client:
          createClientConfig(),

        service:
          createServiceConfig(),
      });

    assert.equal(
      pipeline
        .documentClient
        .jobHttpClient,
      jobHttpClient,
    );

    assert.equal(
      pipeline
        .documentService
        .documentClient,
      pipeline.documentClient,
    );
  },
);

test(
  'document client receives verified source restrictions and limits',
  () => {
    const pipeline =
      createJobDocumentService({
        jobHttpClient:
          createJobHttpClient(),

        client:
          createClientConfig(),

        service:
          createServiceConfig(),
      });

    assert.equal(
      pipeline
        .documentClient
        .baseUrl
        .origin,
      'https://portal.example',
    );

    assert.equal(
      pipeline
        .documentClient
        .portalOrigin,
      'https://portal.example',
    );

    assert.deepEqual(
      Array.from(
        pipeline
          .documentClient
          .allowedOrigins,
      ),
      [
        'https://portal.example',
        'https://cdn.example',
      ],
    );

    assert.equal(
      pipeline
        .documentClient
        .timeoutMs,
      15000,
    );

    assert.equal(
      pipeline
        .documentClient
        .maxFileBytes,
      5 * 1024 * 1024,
    );

    assert.equal(
      pipeline
        .documentClient
        .portalAccessToken,
      'test-token',
    );
  },
);

test(
  'document service receives configured validation bounds',
  () => {
    const pipeline =
      createJobDocumentService({
        jobHttpClient:
          createJobHttpClient(),

        client:
          createClientConfig(),

        service:
          createServiceConfig(),
      });

    assert.equal(
      pipeline
        .documentService
        .maxCount,
      5,
    );

    assert.equal(
      pipeline
        .documentService
        .maxFileBytes,
      5 * 1024 * 1024,
    );

    assert.equal(
      pipeline
        .documentService
        .maxTotalBytes,
      20 * 1024 * 1024,
    );
  },
);

test(
  'missing portal access token remains null',
  () => {
    const client =
      createClientConfig();

    client.portalAccessToken =
      null;

    const pipeline =
      createJobDocumentService({
        jobHttpClient:
          createJobHttpClient(),

        client,

        service:
          createServiceConfig(),
      });

    assert.equal(
      pipeline
        .documentClient
        .portalAccessToken,
      null,
    );
  },
);

test(
  'factory rejects missing or invalid per-job HTTP client',
  () => {
    assert.throws(
      () => {
        createJobDocumentService({
          jobHttpClient:
            null,

          client:
            createClientConfig(),

          service:
            createServiceConfig(),
        });
      },
      /jobHttpClient with request\(\) is required/,
    );

    assert.throws(
      () => {
        createJobDocumentService({
          jobHttpClient: {},

          client:
            createClientConfig(),

          service:
            createServiceConfig(),
        });
      },
      /jobHttpClient with request\(\) is required/,
    );
  },
);

test(
  'factory rejects empty allowed origins',
  () => {
    const client =
      createClientConfig();

    client.allowedOrigins = [];

    assert.throws(
      () => {
        createJobDocumentService({
          jobHttpClient:
            createJobHttpClient(),

          client,

          service:
            createServiceConfig(),
        });
      },
      /client\.allowedOrigins must be a non-empty array/,
    );
  },
);

test(
  'factory rejects invalid document limits',
  () => {
    const service =
      createServiceConfig();

    service.maxCount = 0;

    assert.throws(
      () => {
        createJobDocumentService({
          jobHttpClient:
            createJobHttpClient(),

          client:
            createClientConfig(),

          service,
        });
      },
      /service\.maxCount must be a positive integer/,
    );
  },
);

test(
  'factory rejects invalid client limits',
  () => {
    const client =
      createClientConfig();

    client.maxFileBytes = 0;

    assert.throws(
      () => {
        createJobDocumentService({
          jobHttpClient:
            createJobHttpClient(),

          client,

          service:
            createServiceConfig(),
        });
      },
      /client\.maxFileBytes must be a positive integer/,
    );
  },
);

test(
  'returned pipeline is frozen',
  () => {
    const pipeline =
      createJobDocumentService({
        jobHttpClient:
          createJobHttpClient(),

        client:
          createClientConfig(),

        service:
          createServiceConfig(),
      });

    assert.equal(
      Object.isFrozen(
        pipeline,
      ),
      true,
    );
  },
);