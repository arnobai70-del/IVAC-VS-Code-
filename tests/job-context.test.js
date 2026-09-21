import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  JobContext,
} from '../src/jobs/job-context.js';

function createFixture() {
  const job = {
    id:
      'job-1',

    applicationId:
      'app-1',
  };

  const allocation = {
    allocationId:
      'alloc-1',

    jobId:
      'job-1',

    proxyId:
      'proxy-1',

    ip:
      '203.0.113.151',

    port:
      8080,
  };

  const dispatcher = {};

  const cookieJar = {
    clear() {},
  };

  const session = {
    jobId:
      'job-1',

    allocationId:
      'alloc-1',
  };

  return {
    job,
    allocation,
    dispatcher,
    cookieJar,
    session,
  };
}

test('job context owns isolated mutable workflow state', () => {
  const fixture =
    createFixture();

  const context =
    new JobContext(
      fixture,
    );

  context.setCurrentStep(
    'login',
  );

  context.setResponse(
    'login',
    {
      requestId:
        'req-1',
    },
  );

  context.setOtpWatch({
    watchId:
      'watch-1',

    phone:
      '01700000000',

    capturedAt:
      '2026-09-21T18:00:00.000Z',

    baselineFingerprints: [
      'old-row',
    ],
  });

  context.setOtp({
    code:
      '123456',
  });

  context.setDocuments([
    {
      id:
        'doc-1',
    },
  ]);

  context.setRetryState({
    attempt:
      2,

    lastErrorCode:
      'NETWORK_TIMEOUT',
  });

  assert.equal(
    context.currentStep,
    'login',
  );

  assert.deepEqual(
    context.getResponse(
      'login',
    ),
    {
      requestId:
        'req-1',
    },
  );

  assert.equal(
    context.otp.code,
    '123456',
  );

  assert.equal(
    context.otpWatch.phone,
    '01700000000',
  );

  assert.equal(
    context.retryState.attempt,
    2,
  );
});

test('job context rejects allocation from another job', () => {
  const fixture =
    createFixture();

  fixture.allocation = {
    ...fixture.allocation,

    jobId:
      'job-other',
  };

  assert.throws(
    () => {
      new JobContext(
        fixture,
      );
    },

    (error) => (
      error.code
      === ERROR_CODES
        .SESSION_ALLOCATION_MISMATCH
    ),
  );
});

test('job context clones and freezes per-job workflow input', () => {
  const fixture =
    createFixture();

  const sourceInput = {
    phone:
      '01700000000',

    credentials: {
      password:
        'secret',
    },

    documents: [
      {
        id:
          'document-1',
      },
    ],
  };

  const context =
    new JobContext({
      ...fixture,

      input:
        sourceInput,
    });

  sourceInput.credentials.password =
    'changed-outside';

  sourceInput.documents[0].id =
    'changed-document';

  assert.equal(
    context.input
      .credentials.password,
    'secret',
  );

  assert.equal(
    context.input
      .documents[0].id,
    'document-1',
  );

  assert.equal(
    Object.isFrozen(
      context.input,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      context.input.credentials,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      context.input.documents,
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(
      context.input.documents[0],
    ),
    true,
  );
});