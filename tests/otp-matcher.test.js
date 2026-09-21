import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  OtpMatcher,
} from '../src/otp/otp-matcher.js';

function record({
  phone,
  code,
  createdAt,
  fingerprint,
}) {
  return {
    phone,
    code,
    createdAt,
    fingerprint,
  };
}

test('existing same-phone OTP is excluded by baseline', () => {
  const matcher =
    new OtpMatcher();

  const oldRecord =
    record({
      phone:
        '01700000000',

      code:
        '111111',

      createdAt:
        'old-time',

      fingerprint:
        'old-fingerprint',
    });

  const watch =
    matcher.createWatch(
      [
        oldRecord,
      ],
      {
        phone:
          '01700000000',

        capturedAt:
          '2026-09-21T18:00:00.000Z',
      },
    );

  const result =
    matcher.findNewOtp(
      [
        oldRecord,
      ],
      watch,
    );

  assert.equal(
    result,
    null,
  );
});

test('wrong phone is ignored and one new exact-phone row is accepted', () => {
  const matcher =
    new OtpMatcher();

  const watch =
    matcher.createWatch(
      [],
      {
        phone:
          '+8801700000000',

        capturedAt:
          '2026-09-21T18:00:00.000Z',
      },
    );

  const result =
    matcher.findNewOtp(
      [
        record({
          phone:
            '01800000000',

          code:
            '111111',

          createdAt:
            'new',

          fingerprint:
            'wrong-phone',
        }),

        record({
          phone:
            '01700000000',

          code:
            '654321',

          createdAt:
            'new',

          fingerprint:
            'correct-phone',
        }),
      ],
      watch,
    );

  assert.equal(
    result.code,
    '654321',
  );

  assert.equal(
    result.phone,
    '01700000000',
  );
});

test('multiple new OTP rows for the same phone fail closed', () => {
  const matcher =
    new OtpMatcher();

  const watch =
    matcher.createWatch(
      [],
      {
        phone:
          '01700000000',

        capturedAt:
          '2026-09-21T18:00:00.000Z',
      },
    );

  assert.throws(
    () => {
      matcher.findNewOtp(
        [
          record({
            phone:
              '01700000000',

            code:
              '111111',

            createdAt:
              'one',

            fingerprint:
              'one',
          }),

          record({
            phone:
              '01700000000',

            code:
              '222222',

            createdAt:
              'two',

            fingerprint:
              'two',
          }),
        ],
        watch,
      );
    },

    (error) => (
      error.code
      === ERROR_CODES
        .OTP_RESPONSE_ERROR
    ),
  );
});