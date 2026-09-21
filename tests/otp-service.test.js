import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  OtpMatcher,
} from '../src/otp/otp-matcher.js';

import {
  OtpService,
} from '../src/otp/otp-service.js';

function createRecord({
  phone =
    '01700000000',

  code,

  fingerprint,
}) {
  return {
    phone,
    code,
    createdAt:
      '2026-09-21 18:00:00',
    fingerprint,
  };
}

function createService({
  recordSnapshots,
  pollIntervalMs = 1000,
  timeoutMs = 5000,
}) {
  let now =
    0;

  let calls =
    0;

  const snapshots =
    [...recordSnapshots];

  const service =
    new OtpService({
      otpClient: {
        async fetchTableHtml() {
          return 'ignored-by-test-parser';
        },
      },

      otpTableParser: {
        parse() {
          const value =
            snapshots[calls]
            ?? snapshots.at(-1)
            ?? [];

          calls += 1;

          return value;
        },
      },

      otpMatcher:
        new OtpMatcher(),

      pollIntervalMs,
      timeoutMs,

      nowFn() {
        return now;
      },

      async sleepFn(
        milliseconds,
      ) {
        now +=
          milliseconds;
      },
    });

  return {
    service,

    getCalls() {
      return calls;
    },

    getNow() {
      return now;
    },
  };
}

test('baseline capture prevents an old same-phone OTP from being reused', async () => {
  const oldRecord =
    createRecord({
      code:
        '111111',

      fingerprint:
        'old',
    });

  const newRecord =
    createRecord({
      code:
        '654321',

      fingerprint:
        'new',
    });

  const fixture =
    createService({
      recordSnapshots: [
        [
          oldRecord,
        ],

        [
          oldRecord,
        ],

        [
          oldRecord,
          newRecord,
        ],
      ],
    });

  const watch =
    await fixture.service
      .captureBaseline({
        phone:
          '01700000000',
      });

  const result =
    await fixture.service
      .waitForOtp({
        watch,
      });

  assert.equal(
    result.code,
    '654321',
  );

  assert.equal(
    result.polls,
    2,
  );

  assert.equal(
    fixture.getCalls(),
    3,
  );
});

test('TEST G: OTP polling stops at configured timeout', async () => {
  const fixture =
    createService({
      recordSnapshots: [
        [],
        [],
        [],
        [],
      ],

      pollIntervalMs:
        1000,

      timeoutMs:
        2500,
    });

  const watch =
    await fixture.service
      .captureBaseline({
        phone:
          '01700000000',
      });

  await assert.rejects(
    () =>
      fixture.service
        .waitForOtp({
          watch,
        }),

    (error) => (
      error.code
        === ERROR_CODES
          .OTP_TIMEOUT
      && error.retryable
        === true
    ),
  );

  /*
   * One fetch was baseline capture.
   * Polls happen at t=0, 1000, 2000.
   * At t=2500 polling terminates.
   */
  assert.equal(
    fixture.getCalls(),
    4,
  );

  assert.equal(
    fixture.getNow(),
    2500,
  );
});

test('OTP watch and matched value attach only to requesting job context', async () => {
  const oldRecord =
    createRecord({
      code:
        '111111',

      fingerprint:
        'old-context',
    });

  const newRecord =
    createRecord({
      code:
        '987654',

      fingerprint:
        'new-context',
    });

  const fixture =
    createService({
      recordSnapshots: [
        [
          oldRecord,
        ],

        [
          oldRecord,
          newRecord,
        ],
      ],
    });

  let storedWatch =
    null;

  let storedOtp =
    null;

  let watchCleared =
    false;

  const jobContext = {
    otpWatch:
      null,

    setOtpWatch(watch) {
      storedWatch = {
        ...watch,

        baselineFingerprints: [
          ...watch
            .baselineFingerprints,
        ],
      };

      this.otpWatch =
        storedWatch;
    },

    clearOtp() {
      storedOtp = {};
    },

    setOtp(value) {
      storedOtp = {
        ...value,
      };
    },

    clearOtpWatch() {
      watchCleared =
        true;

      this.otpWatch =
        null;
    },
  };

  await fixture.service
    .prepareForJobContext({
      jobContext,

      phone:
        '01700000000',
    });

  assert.ok(
    storedWatch,
  );

  const result =
    await fixture.service
      .waitForJobContext({
        jobContext,
      });

  assert.equal(
    result.code,
    '987654',
  );

  assert.equal(
    storedOtp.code,
    '987654',
  );

  assert.equal(
    watchCleared,
    true,
  );
});