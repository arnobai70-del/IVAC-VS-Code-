import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  FINAL_RESULT_OUTCOMES,
  normalizeFinalResult,
} from '../src/results/final-result.js';

import {
  FINAL_RESULT_ERROR_CODES,
} from '../src/results/final-result-errors.js';

test(
  'final result normalization is deterministic and derives terminal state',
  () => {
    const first =
      normalizeFinalResult({
        jobId:
          'job-1',

        applicationId:
          'app-1',

        outcome:
          FINAL_RESULT_OUTCOMES
            .SUCCESS,

        code:
          'OK',

        message:
          'Completed',

        data: {
          reference:
            'ref-1',

          nested: {
            b: 2,
            a: 1,
          },
        },
      });

    const second =
      normalizeFinalResult({
        jobId:
          'job-1',

        applicationId:
          'app-1',

        outcome:
          FINAL_RESULT_OUTCOMES
            .SUCCESS,

        code:
          'OK',

        message:
          'Completed',

        data: {
          nested: {
            a: 1,
            b: 2,
          },

          reference:
            'ref-1',
        },
      });

    assert.equal(
      first.terminalState,
      JOB_STATES.COMPLETED,
    );

    assert.equal(
      first.payloadHash,
      second.payloadHash,
    );

    assert.equal(
      first.idempotencyKey,
      second.idempotencyKey,
    );

    assert.equal(
      first.canonicalPayload,
      second.canonicalPayload,
    );
  },
);

test(
  'failure final result derives FAILED_FINAL',
  () => {
    const result =
      normalizeFinalResult({
        jobId:
          'job-2',

        applicationId:
          'app-2',

        outcome:
          FINAL_RESULT_OUTCOMES
            .FAILURE,

        code:
          'TARGET_REJECTED',

        message:
          'Target rejected request.',
      });

    assert.equal(
      result.terminalState,
      JOB_STATES.FAILED_FINAL,
    );
  },
);

test(
  'final result rejects secret and OTP fields recursively',
  () => {
    assert.throws(
      () => {
        normalizeFinalResult({
          jobId:
            'job-secret',

          applicationId:
            'app-secret',

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            publicReference:
              'ref',

            nested: {
              otpCode:
                '123456',
            },
          },
        });
      },

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .VALIDATION_ERROR
      ),
    );

    assert.throws(
      () => {
        normalizeFinalResult({
          jobId:
            'job-password',

          applicationId:
            'app-password',

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            Password:
              'secret',
          },
        });
      },

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .VALIDATION_ERROR
      ),
    );
  },
);

test(
  'final result rejects binary data',
  () => {
    assert.throws(
      () => {
        normalizeFinalResult({
          jobId:
            'job-binary',

          applicationId:
            'app-binary',

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            fileData:
              Buffer.from(
                '%PDF-1.7',
              ),
          },
        });
      },

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .VALIDATION_ERROR
      ),
    );
  },
);

test(
  'final result rejects encoded PDF-like payload fields and unsafe prototype keys',
  () => {
    assert.throws(
      () => {
        normalizeFinalResult({
          jobId:
            'job-pdf-string',

          applicationId:
            'app-pdf-string',

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            pdfBase64:
              'JVBERi0xLjc=',
          },
        });
      },

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .VALIDATION_ERROR
      ),
    );

    const unsafe =
      JSON.parse(
        '{"__proto__":{"polluted":true}}',
      );

    assert.throws(
      () => {
        normalizeFinalResult({
          jobId:
            'job-proto',

          applicationId:
            'app-proto',

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data:
            unsafe,
        });
      },

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .VALIDATION_ERROR
      ),
    );

    assert.equal(
      {}.polluted,
      undefined,
    );
  },
);

test(
  'same logical result creates the same idempotency key regardless of object key order',
  () => {
    const first =
      normalizeFinalResult({
        jobId:
          'job-order',

        applicationId:
          'app-order',

        outcome:
          FINAL_RESULT_OUTCOMES
            .SUCCESS,

        data: {
          z: 3,
          a: 1,

          m: {
            y: 2,
            x: 1,
          },
        },
      });

    const second =
      normalizeFinalResult({
        jobId:
          'job-order',

        applicationId:
          'app-order',

        outcome:
          FINAL_RESULT_OUTCOMES
            .SUCCESS,

        data: {
          a: 1,

          m: {
            x: 1,
            y: 2,
          },

          z: 3,
        },
      });

    assert.equal(
      first.idempotencyKey,
      second.idempotencyKey,
    );

    assert.equal(
      first.payloadHash,
      second.payloadHash,
    );
  },
);

test(
  'final result rejects sensitive values embedded in message text',
  () => {
    const sensitiveMessages = [
      'password=super-secret',
      'OTP: 123456',
      'Authorization: Bearer abcdefghijklmnop',
      'token=abcdefghijk',
      'Cookie: session=abcdef',
      '%PDF-1.7 document data',
      'JVBERi0xLjcKJc',
    ];

    for (
      const message
      of sensitiveMessages
    ) {
      assert.throws(
        () => {
          normalizeFinalResult({
            jobId:
              'job-sensitive-message',

            applicationId:
              'app-sensitive-message',

            outcome:
              FINAL_RESULT_OUTCOMES
                .FAILURE,

            message,
          });
        },

        (error) => (
          error.code
          === FINAL_RESULT_ERROR_CODES
            .VALIDATION_ERROR
        ),
      );
    }
  },
);

test(
  'final result rejects sensitive values embedded inside nested data strings',
  () => {
    assert.throws(
      () => {
        normalizeFinalResult({
          jobId:
            'job-sensitive-data',

          applicationId:
            'app-sensitive-data',

          outcome:
            FINAL_RESULT_OUTCOMES
              .SUCCESS,

          data: {
            note:
              'access_token=abcdefghijklmnop',
          },
        });
      },

      (error) => (
        error.code
        === FINAL_RESULT_ERROR_CODES
          .VALIDATION_ERROR
      ),
    );
  },
);

test(
  'safe descriptive text does not trigger secret-value detection',
  () => {
    const result =
      normalizeFinalResult({
        jobId:
          'job-safe-message',

        applicationId:
          'app-safe-message',

        outcome:
          FINAL_RESULT_OUTCOMES
            .FAILURE,

        code:
          'OTP_REQUEST_FAILED',

        message:
          'OTP request failed before a code was received.',

        data: {
          reason:
            'Password field was rejected by validation.',

          note:
            'Token was unavailable.',
        },
      });

    assert.equal(
      result.code,
      'OTP_REQUEST_FAILED',
    );

    assert.equal(
      result.message,
      'OTP request failed before a code was received.',
    );

    assert.equal(
      result.data.reason,
      'Password field was rejected by validation.',
    );
  },
);