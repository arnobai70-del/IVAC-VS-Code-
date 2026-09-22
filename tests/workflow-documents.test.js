import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkflowEngine,
} from '../src/workflow/engine.js';

function createDocument(
  id,
  name,
) {
  return {
    id,

    name,

    contentType:
      'application/pdf',

    sizeBytes:
      24,

    sha256:
      id,

    sourceOrigin:
      'https://portal.example.test',

    sourcePath:
      `/${name}`,

    buffer:
      Buffer.from(
        `%PDF-1.7\n${id}\n%%EOF\n`,
        'ascii',
      ),
  };
}

function createContext() {
  return {
    input: {
      documents: [
        '/passport.pdf',
        '/visa.pdf',
      ],

      applicationId:
        'app-1',
    },

    job: {
      id:
        'job-1',

      applicationId:
        'app-1',
    },

    allocation: {
      allocationId:
        'allocation-1',

      jobId:
        'job-1',

      proxyId:
        'proxy-1',

      ip:
        '203.0.113.20',

      port:
        8080,
    },

    session: {
      sessionId:
        'session-1',

      jobId:
        'job-1',

      allocationId:
        'allocation-1',

      proxyId:
        'proxy-1',

      assignedIp:
        '203.0.113.20',

      port:
        8080,
    },

    responses: {},

    otp: {},

    documents: [],

    documentUploads: {},

    currentStep:
      null,

    setCurrentStep(
      stepId,
    ) {
      this.currentStep =
        stepId;
    },

    setResponse(
      stepId,
      value,
    ) {
      this.responses[
        stepId
      ] =
        value;
    },

    hasResponse(
      stepId,
    ) {
      return Object.prototype
        .hasOwnProperty
        .call(
          this.responses,
          stepId,
        );
    },

    getResponse(
      stepId,
    ) {
      return this.responses[
        stepId
      ];
    },

    setDocuments(
      documents,
    ) {
      this.documents =
        documents;
    },

    getDocumentUpload(
      stepId,
      documentId,
    ) {
      return this
        .documentUploads[
          `${stepId}:${documentId}`
        ]
        ?? null;
    },

    setDocumentUpload(
      stepId,
      documentId,
      value,
    ) {
      this.documentUploads[
        `${stepId}:${documentId}`
      ] =
        structuredClone(
          value,
        );
    },
  };
}

function createOtpService() {
  return {
    async prepareForJobContext() {
      throw new Error(
        'unused',
      );
    },

    async waitForJobContext() {
      throw new Error(
        'unused',
      );
    },
  };
}

const workflow = {
  version:
    1,

  name:
    'document-flow',

  enabled:
    true,

  steps: [
    {
      id:
        'prepare_documents',

      type:
        'documents.prepare',

      sources:
        '{{input.documents}}',
    },

    {
      id:
        'upload_documents',

      type:
        'documents.upload',

      route:
        'documents/upload',

      fieldName:
        'file',

      headers: {
        Accept:
          'application/json',
      },

      fields: {
        application_id:
          '{{job.applicationId}}',
      },

      expect: {
        statuses: [
          200,
        ],

        response:
          'json',
      },
    },
  ],
};

test(
  'Portal documents are automatically prepared and uploaded one by one',
  async () => {
    let uploadCalls =
      0;

    const documentService = {
      async prepareForJobContext({
        jobContext,
        sources,
      }) {
        assert.deepEqual(
          sources,
          [
            '/passport.pdf',
            '/visa.pdf',
          ],
        );

        const documents = [
          createDocument(
            'hash-passport',
            'passport.pdf',
          ),

          createDocument(
            'hash-visa',
            'visa.pdf',
          ),
        ];

        jobContext.setDocuments(
          documents,
        );

        return {
          count:
            2,

          totalBytes:
            documents.reduce(
              (
                total,
                document,
              ) =>
                total
                + document.sizeBytes,
              0,
            ),

          documents:
            documents.map(
              ({
                buffer,
                ...metadata
              }) => {
                void buffer;

                return metadata;
              },
            ),
        };
      },
    };

    const targetHttpClient = {
      async requestStep() {
        throw new Error(
          'unused',
        );
      },

      async uploadPdf({
        document,
        fieldName,
        fields,
      }) {
        uploadCalls +=
          1;

        assert.equal(
          fieldName,
          'file',
        );

        assert.equal(
          fields
            .application_id,
          'app-1',
        );

        assert.equal(
          Buffer.isBuffer(
            document.buffer,
          ),
          true,
        );

        return {
          statusCode:
            200,

          data: {
            uploaded:
              document.id,
          },
        };
      },
    };

    const context =
      createContext();

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createOtpService(),

        documentService,

        targetHttpClient,
      });

    const result =
      await engine.execute({
        workflow,

        jobContext:
          context,
      });

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      uploadCalls,
      2,
    );

    assert.equal(
      context.responses
        .upload_documents
        .uploadedCount,
      2,
    );

    assert.equal(
      context.currentStep,
      null,
    );
  },
);

test(
  'successful document upload is reused on same-context workflow retry',
  async () => {
    const uploadCalls =
      new Map();

    let prepareCalls =
      0;

    let failVisaOnce =
      true;

    const preparedDocuments = [
      createDocument(
        'hash-passport',
        'passport.pdf',
      ),

      createDocument(
        'hash-visa',
        'visa.pdf',
      ),
    ];

    const documentService = {
      async prepareForJobContext({
        jobContext,
      }) {
        prepareCalls +=
          1;

        jobContext.setDocuments(
          preparedDocuments,
        );

        return {
          count:
            2,

          totalBytes:
            48,

          documents:
            preparedDocuments.map(
              ({
                buffer,
                ...metadata
              }) => {
                void buffer;

                return metadata;
              },
            ),
        };
      },
    };

    const targetHttpClient = {
      async requestStep() {
        throw new Error(
          'unused',
        );
      },

      async uploadPdf({
        document,
      }) {
        uploadCalls.set(
          document.id,
          (
            uploadCalls.get(
              document.id,
            )
            ?? 0
          ) + 1,
        );

        if (
          document.id
          === 'hash-visa'
          && failVisaOnce
        ) {
          failVisaOnce =
            false;

          const error =
            new Error(
              'temporary upload failure',
            );

          error.code =
            'NETWORK_TIMEOUT';

          error.retryable =
            true;

          throw error;
        }

        return {
          statusCode:
            200,

          data: {
            uploaded:
              document.id,
          },
        };
      },
    };

    const context =
      createContext();

    const engine =
      new WorkflowEngine({
        maxSteps:
          10,

        otpService:
          createOtpService(),

        documentService,

        targetHttpClient,
      });

    /*
     * First attempt:
     *
     * - prepare_documents completes;
     * - passport upload succeeds and receives a per-document
     *   completion marker;
     * - visa upload fails;
     * - upload_documents itself has no completed response marker.
     */
    await assert.rejects(
      engine.execute({
        workflow,

        jobContext:
          context,
      }),
      (
        error,
      ) => (
        error.code
        === 'NETWORK_TIMEOUT'
      ),
    );

    assert.equal(
      prepareCalls,
      1,
    );

    assert.equal(
      context.hasResponse(
        'prepare_documents',
      ),
      true,
    );

    assert.equal(
      context.hasResponse(
        'upload_documents',
      ),
      false,
    );

    assert.equal(
      context.currentStep,
      'upload_documents',
    );

    assert.ok(
      context.getDocumentUpload(
        'upload_documents',
        'hash-passport',
      ),
    );

    assert.equal(
      context.getDocumentUpload(
        'upload_documents',
        'hash-visa',
      ),
      null,
    );

    /*
     * Same-context retry:
     *
     * - completed prepare_documents step is skipped;
     * - upload_documents re-enters;
     * - passport is reused from its existing marker;
     * - only missing visa is sent again.
     */
    const result =
      await engine.execute({
        workflow,

        jobContext:
          context,
      });

    assert.equal(
      result.status,
      'COMPLETED',
    );

    assert.equal(
      prepareCalls,
      1,
    );

    assert.equal(
      uploadCalls.get(
        'hash-passport',
      ),
      1,
    );

    assert.equal(
      uploadCalls.get(
        'hash-visa',
      ),
      2,
    );

    assert.equal(
      context.responses
        .upload_documents
        .uploadedCount,
      2,
    );

    assert.equal(
      context.responses
        .upload_documents
        .uploads[0]
        .document
        .id,
      'hash-passport',
    );

    assert.equal(
      context.responses
        .upload_documents
        .uploads[0]
        .reused,
      true,
    );

    assert.equal(
      context.responses
        .upload_documents
        .uploads[1]
        .document
        .id,
      'hash-visa',
    );

    assert.equal(
      context.responses
        .upload_documents
        .uploads[1]
        .reused,
      false,
    );

    assert.equal(
      context.currentStep,
      null,
    );
  },
);