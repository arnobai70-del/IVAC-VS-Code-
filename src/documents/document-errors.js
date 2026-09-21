import {
  AppError,
} from '../core/errors.js';

export const DOCUMENT_ERROR_CODES =
  Object.freeze({
    DOCUMENT_SOURCE_ERROR:
      'DOCUMENT_SOURCE_ERROR',

    DOCUMENT_VALIDATION_ERROR:
      'DOCUMENT_VALIDATION_ERROR',

    DOCUMENT_UPLOAD_ERROR:
      'DOCUMENT_UPLOAD_ERROR',
  });

export class DocumentSourceError
  extends AppError {
  constructor(
    message =
      'Document source is invalid or unavailable.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          DOCUMENT_ERROR_CODES
            .DOCUMENT_SOURCE_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}

export class DocumentValidationError
  extends AppError {
  constructor(
    message =
      'Document failed validation.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          DOCUMENT_ERROR_CODES
            .DOCUMENT_VALIDATION_ERROR,

        retryable:
          false,
      },
    );
  }
}

export class DocumentUploadError
  extends AppError {
  constructor(
    message =
      'Document upload failed.',

    options = {},
  ) {
    super(
      message,
      {
        ...options,

        code:
          DOCUMENT_ERROR_CODES
            .DOCUMENT_UPLOAD_ERROR,

        retryable:
          options.retryable
          ?? false,
      },
    );
  }
}