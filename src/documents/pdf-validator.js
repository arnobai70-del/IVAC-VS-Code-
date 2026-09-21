import {
  createHash,
} from 'node:crypto';

import {
  DocumentValidationError,
} from './document-errors.js';

const PDF_HEADER =
  Buffer.from(
    '%PDF-',
    'ascii',
  );

const PDF_EOF =
  Buffer.from(
    '%%EOF',
    'ascii',
  );

function normalizeContentType(
  value,
) {
  if (
    typeof value !== 'string'
  ) {
    return null;
  }

  return value
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function sanitizePdfFilename(
  value,
  fallback,
) {
  const raw =
    typeof value === 'string'
      ? value.trim()
      : '';

  let filename =
    raw || fallback;

  filename =
    filename
      .replace(
        /[\r\n]/g,
        '',
      )
      .replace(
        /[^A-Za-z0-9._-]+/g,
        '_',
      )
      .replace(
        /^_+|_+$/g,
        '',
      );

  if (
    filename.length === 0
  ) {
    filename =
      fallback;
  }

  if (
    !filename
      .toLowerCase()
      .endsWith('.pdf')
  ) {
    filename =
      `${filename}.pdf`;
  }

  if (
    filename.length > 160
  ) {
    filename =
      `${
        filename.slice(
          0,
          156,
        )
      }.pdf`;
  }

  return filename;
}

export function validatePdf({
  buffer,
  contentType,
  filename,
  maxFileBytes,
  sourceOrigin,
  sourcePath,
}) {
  if (
    !Buffer.isBuffer(
      buffer,
    )
  ) {
    throw new DocumentValidationError(
      'Downloaded document is not a binary buffer.',
    );
  }

  if (
    buffer.length === 0
  ) {
    throw new DocumentValidationError(
      'Downloaded PDF is empty.',
    );
  }

  if (
    buffer.length
    > maxFileBytes
  ) {
    throw new DocumentValidationError(
      'Downloaded PDF exceeds the configured per-file size limit.',
    );
  }

  const normalizedContentType =
    normalizeContentType(
      contentType,
    );

  if (
    normalizedContentType
    !== 'application/pdf'
  ) {
    throw new DocumentValidationError(
      'Downloaded document did not return Content-Type application/pdf.',
    );
  }

  if (
    buffer.length
      < PDF_HEADER.length
    || !buffer
      .subarray(
        0,
        PDF_HEADER.length,
      )
      .equals(
        PDF_HEADER,
      )
  ) {
    throw new DocumentValidationError(
      'Downloaded document does not contain a valid PDF header.',
    );
  }

  const tail =
    buffer.subarray(
      Math.max(
        0,
        buffer.length - 4096,
      ),
    );

  if (
    !tail.includes(
      PDF_EOF,
    )
  ) {
    throw new DocumentValidationError(
      'Downloaded document does not contain a PDF EOF marker.',
    );
  }

  const sha256 =
    createHash(
      'sha256',
    )
      .update(
        buffer,
      )
      .digest(
        'hex',
      );

  return {
    id:
      `pdf-${sha256}`,

    name:
      filename,

    contentType:
      'application/pdf',

    sizeBytes:
      buffer.length,

    sha256,

    sourceOrigin,
    sourcePath,

    /*
     * Make a private per-job copy so the response
     * buffer cannot later be mutated externally.
     */
    buffer:
      Buffer.from(
        buffer,
      ),
  };
}