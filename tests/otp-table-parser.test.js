import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  normalizePhoneNumber,
  OtpTableParser,
} from '../src/otp/otp-table-parser.js';

function createParser() {
  return new OtpTableParser({
    tableSelector:
      'table',

    maxRows:
      100,

    columns: {
      phone:
        'Phone Number',

      code:
        'OTP',

      createdAt:
        'Created At',
    },
  });
}

test('OTP HTML table is parsed by column headers rather than fixed indexes', () => {
  const parser =
    createParser();

  const records =
    parser.parse(`
      <html>
        <body>
          <table>
            <thead>
              <tr>
                <th>Created At</th>
                <th>Phone Number</th>
                <th>OTP</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-09-21 18:00:00</td>
                <td>01700000000</td>
                <td>045557</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `);

  assert.equal(
    records.length,
    1,
  );

  assert.equal(
    records[0].phone,
    '01700000000',
  );

  assert.equal(
    records[0].code,
    '045557',
  );

  assert.equal(
    records[0].createdAt,
    '2026-09-21 18:00:00',
  );

  assert.equal(
    typeof records[0]
      .fingerprint,
    'string',
  );
});

test('OTP parser preserves arbitrary short string OTP values', () => {
  const parser =
    createParser();

  const records =
    parser.parse(`
      <table>
        <tr>
          <th>Phone Number</th>
          <th>OTP</th>
          <th>Created At</th>
        </tr>
        <tr>
          <td>01700000000</td>
          <td>09KHCJ</td>
          <td>2026-09-21 18:01:00</td>
        </tr>
      </table>
    `);

  assert.equal(
    records[0].code,
    '09KHCJ',
  );
});

test('phone normalization accepts common Bangladesh representations', () => {
  assert.equal(
    normalizePhoneNumber(
      '+880 1700-000000',
    ),
    '01700000000',
  );

  assert.equal(
    normalizePhoneNumber(
      '8801700000000',
    ),
    '01700000000',
  );

  assert.equal(
    normalizePhoneNumber(
      '1700000000',
    ),
    '01700000000',
  );
});

test('unexpected OTP table structure fails closed', () => {
  const parser =
    createParser();

  assert.throws(
    () => {
      parser.parse(`
        <table>
          <tr>
            <th>Something Else</th>
          </tr>
        </table>
      `);
    },

    (error) => (
      error.code
      === ERROR_CODES
        .OTP_RESPONSE_ERROR
    ),
  );
});