import assert from 'node:assert/strict';

import {
  Writable,
} from 'node:stream';

import test from 'node:test';

import {
  createLogger,
} from '../src/core/logger.js';

function createCaptureStream() {
  let output = '';

  const stream =
    new Writable({
      write(
        chunk,
        encoding,
        callback,
      ) {
        void encoding;

        output +=
          chunk.toString();

        callback();
      },
    });

  return {
    stream,

    getOutput() {
      return output;
    },
  };
}

test('logger redacts sensitive fields including OTP values', async () => {
  const capture =
    createCaptureStream();

  const logger =
    createLogger({
      level:
        'info',

      service:
        'logger-test',

      destination:
        capture.stream,
    });

  logger.info(
    {
      password:
        'password-secret',

      authorization:
        'Bearer auth-secret',

      token:
        'token-secret',

      nested: {
        otp: {
          code:
            '654321',
        },

        otpCode:
          '123456',
      },

      safeField:
        'visible-value',
    },
    'redaction test',
  );

  await new Promise(
    (resolve) => {
      setImmediate(resolve);
    },
  );

  const output =
    capture.getOutput();

  assert.equal(
    output.includes(
      'password-secret',
    ),
    false,
  );

  assert.equal(
    output.includes(
      'auth-secret',
    ),
    false,
  );

  assert.equal(
    output.includes(
      'token-secret',
    ),
    false,
  );

  assert.equal(
    output.includes(
      '654321',
    ),
    false,
  );

  assert.equal(
    output.includes(
      '123456',
    ),
    false,
  );

  assert.equal(
    output.includes(
      'visible-value',
    ),
    true,
  );
});