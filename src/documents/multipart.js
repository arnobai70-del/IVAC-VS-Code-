import {
  randomBytes,
} from 'node:crypto';

import {
  DocumentUploadError,
} from './document-errors.js';

const FIELD_NAME_PATTERN =
  /^[A-Za-z0-9_.-]{1,100}$/;

function validateFieldName(
  value,
) {
  if (
    typeof value !== 'string'
    || !FIELD_NAME_PATTERN.test(
      value,
    )
  ) {
    throw new DocumentUploadError(
      'Multipart field name contains unsupported characters.',
    );
  }

  return value;
}

function escapeFilename(
  value,
) {
  if (
    typeof value !== 'string'
    || value.length === 0
  ) {
    throw new DocumentUploadError(
      'PDF upload filename is required.',
    );
  }

  if (
    /[\r\n]/.test(
      value,
    )
  ) {
    throw new DocumentUploadError(
      'PDF upload filename contains unsafe characters.',
    );
  }

  return value
    .replace(
      /\\/g,
      '\\\\',
    )
    .replace(
      /"/g,
      '\\"',
    );
}

function normalizeFieldValue(
  value,
) {
  if (
    value === null
  ) {
    return '';
  }

  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return String(
      value,
    );
  }

  throw new DocumentUploadError(
    'Multipart extra field must resolve to a scalar value.',
  );
}

export function buildPdfMultipart({
  fieldName,
  filename,
  pdfBuffer,
  fields = {},
}) {
  validateFieldName(
    fieldName,
  );

  if (
    !Buffer.isBuffer(
      pdfBuffer,
    )
    || pdfBuffer.length === 0
  ) {
    throw new DocumentUploadError(
      'PDF upload buffer is missing.',
    );
  }

  const safeFilename =
    escapeFilename(
      filename,
    );

  const boundary =
    `----ivac-${randomBytes(
      16,
    ).toString('hex')}`;

  const chunks = [];

  for (
    const [
      name,
      rawValue,
    ]
    of Object.entries(
      fields,
    )
  ) {
    validateFieldName(
      name,
    );

    const value =
      normalizeFieldValue(
        rawValue,
      );

    chunks.push(
      Buffer.from(
        [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="${name}"\r\n`,
          '\r\n',
          value,
          '\r\n',
        ].join(''),
        'utf8',
      ),
    );
  }

  chunks.push(
    Buffer.from(
      [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="${fieldName}"; filename="${safeFilename}"\r\n`,
        'Content-Type: application/pdf\r\n',
        '\r\n',
      ].join(''),
      'utf8',
    ),
  );

  chunks.push(
    pdfBuffer,
  );

  chunks.push(
    Buffer.from(
      `\r\n--${boundary}--\r\n`,
      'utf8',
    ),
  );

  return {
    boundary,

    contentType:
      `multipart/form-data; boundary=${boundary}`,

    body:
      Buffer.concat(
        chunks,
      ),
  };
}