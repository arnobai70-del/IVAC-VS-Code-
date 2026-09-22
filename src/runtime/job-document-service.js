import {
  DocumentClient,
} from '../documents/document-client.js';

import {
  DocumentService,
} from '../documents/document-service.js';

function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}

function requireNonEmptyString(
  value,
  name,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function requirePositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}

function requireAllowedOrigins(
  value,
) {
  if (
    !Array.isArray(
      value,
    )
    || value.length === 0
  ) {
    throw new TypeError(
      'client.allowedOrigins must be a non-empty array.',
    );
  }

  return value.map(
    (
      origin,
      index,
    ) => (
      requireNonEmptyString(
        origin,
        `client.allowedOrigins[${index}]`,
      )
    ),
  );
}

function normalizePortalAccessToken(
  value,
) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  return requireNonEmptyString(
    value,
    'client.portalAccessToken',
  );
}

/*
 * Builds the verified PDF document pipeline for one job.
 *
 * The caller supplies the already-created per-job JobHttpClient.
 * This guarantees document downloads share the same dispatcher,
 * IP allocation, and in-memory cookie jar as Target and OTP
 * traffic.
 *
 * Safety boundaries:
 *
 * - no second/direct HTTP client is created;
 * - source URLs remain HTTPS + allowlist constrained;
 * - redirects remain disabled in DocumentClient;
 * - human-verification challenges propagate rather than being
 *   bypassed;
 * - Portal bearer token forwarding remains restricted to the
 *   configured Portal origin by DocumentClient;
 * - PDF count, per-file size, combined size, validation, and
 *   duplicate detection remain owned by DocumentService;
 * - PDF binary remains memory-only in JobContext;
 * - this factory does not persist or log tokens, cookies, PDFs,
 *   passwords, OTPs, or Portal payloads.
 *
 * The options are deliberately expressed in terms of the
 * existing DocumentClient/DocumentService constructors. Mapping
 * application config into these options belongs to the later
 * bootstrap integration step after the real config contract is
 * inspected.
 */
export function createJobDocumentService({
  jobHttpClient,
  client,
  service,
}) {
  if (
    !jobHttpClient
    || typeof jobHttpClient
      .request !== 'function'
  ) {
    throw new TypeError(
      'jobHttpClient with request() is required.',
    );
  }

  requireObject(
    client,
    'client',
  );

  requireObject(
    service,
    'service',
  );

  const documentClient =
    new DocumentClient({
      baseUrl:
        requireNonEmptyString(
          client.baseUrl,
          'client.baseUrl',
        ),

      allowedOrigins:
        requireAllowedOrigins(
          client.allowedOrigins,
        ),

      timeoutMs:
        requirePositiveInteger(
          client.timeoutMs,
          'client.timeoutMs',
        ),

      maxFileBytes:
        requirePositiveInteger(
          client.maxFileBytes,
          'client.maxFileBytes',
        ),

      portalAccessToken:
        normalizePortalAccessToken(
          client.portalAccessToken,
        ),

      jobHttpClient,
    });

  const documentService =
    new DocumentService({
      documentClient,

      maxCount:
        requirePositiveInteger(
          service.maxCount,
          'service.maxCount',
        ),

      maxFileBytes:
        requirePositiveInteger(
          service.maxFileBytes,
          'service.maxFileBytes',
        ),

      maxTotalBytes:
        requirePositiveInteger(
          service.maxTotalBytes,
          'service.maxTotalBytes',
        ),
    });

  return Object.freeze({
    documentClient,
    documentService,
  });
}