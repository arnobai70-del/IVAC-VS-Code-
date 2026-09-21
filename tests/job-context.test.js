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