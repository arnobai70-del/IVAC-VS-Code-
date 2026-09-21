import {
  randomUUID,
} from 'node:crypto';

import {
  OtpResponseError,
} from '../core/errors.js';

import {
  normalizePhoneNumber,
} from './otp-table-parser.js';

function requirePhone(phone) {
  const normalized =
    normalizePhoneNumber(
      phone,
    );

  if (!normalized) {
    throw new OtpResponseError(
      'A valid phone number is required for OTP matching.',
    );
  }

  return normalized;
}

export class OtpMatcher {
  createWatch(
    records,
    {
      phone,
      capturedAt,
    },
  ) {
    if (!Array.isArray(records)) {
      throw new TypeError(
        'OTP records must be an array.',
      );
    }

    const normalizedPhone =
      requirePhone(
        phone,
      );

    const baselineFingerprints =
      Array.from(
        new Set(
          records
            .filter(
              (record) =>
                record.phone
                === normalizedPhone,
            )
            .map(
              (record) =>
                record.fingerprint,
            ),
        ),
      );

    return Object.freeze({
      watchId:
        randomUUID(),

      phone:
        normalizedPhone,

      capturedAt,

      baselineFingerprints:
        Object.freeze(
          baselineFingerprints,
        ),
    });
  }

  findNewOtp(
    records,
    watch,
  ) {
    if (!Array.isArray(records)) {
      throw new TypeError(
        'OTP records must be an array.',
      );
    }

    if (
      !watch
      || typeof watch !== 'object'
      || !watch.phone
      || !Array.isArray(
        watch.baselineFingerprints,
      )
    ) {
      throw new TypeError(
        'A valid OTP watch is required.',
      );
    }

    const baseline =
      new Set(
        watch.baselineFingerprints,
      );

    const candidateMap =
      new Map();

    for (const record of records) {
      if (
        record.phone
        !== watch.phone
      ) {
        continue;
      }

      if (
        baseline.has(
          record.fingerprint,
        )
      ) {
        continue;
      }

      if (!record.code) {
        continue;
      }

      candidateMap.set(
        record.fingerprint,
        record,
      );
    }

    const candidates =
      Array.from(
        candidateMap.values(),
      );

    if (
      candidates.length === 0
    ) {
      return null;
    }

    if (
      candidates.length > 1
    ) {
      throw new OtpResponseError(
        'Multiple new OTP rows matched the same phone; refusing to guess.',
      );
    }

    const candidate =
      candidates[0];

    return {
      phone:
        candidate.phone,

      code:
        candidate.code,

      createdAt:
        candidate.createdAt,

      fingerprint:
        candidate.fingerprint,
    };
  }
}