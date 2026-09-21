import {
  ManualChallengeRequiredError,
} from '../core/errors.js';

import {
  detectManualChallenge,
} from '../workflow/challenge-detector.js';

import {
  DocumentSourceError,
  DocumentValidationError,
} from './document-errors.js';

function getHeader(
  headers,
  name,
) {
  if (!headers) {
    return null;
  }

  if (
    typeof headers.get
    === 'function'
  ) {
    return headers.get(
      name,
    );
  }

  const target =
    name.toLowerCase();

  for (
    const [
      key,
      value,
    ]
    of Object.entries(
      headers,
    )
  ) {
    if (
      key.toLowerCase()
      !== target
    ) {
      continue;
    }

    if (
      Array.isArray(
        value,
      )
    ) {
      return value.join(
        ', ',
      );
    }

    if (
      value === null
      || value === undefined
    ) {
      return null;
    }

    return String(
      value,
    );
  }

  return null;
}

function toSafeSourceMetadata(
  url,
) {
  return {
    origin:
      url.origin,

    pathname:
      url.pathname,
  };
}

export class DocumentClient {
  constructor({
    baseUrl,
    allowedOrigins,
    timeoutMs,
    maxFileBytes,
    portalAccessToken = null,
    jobHttpClient,
  }) {
    if (
      !jobHttpClient
      || typeof jobHttpClient
        .request
        !== 'function'
    ) {
      throw new TypeError(
        'jobHttpClient with request() is required.',
      );
    }

    this.baseUrl =
      new URL(
        baseUrl,
      );

    this.portalOrigin =
      this.baseUrl.origin;

    this.allowedOrigins =
      new Set(
        allowedOrigins.map(
          (value) =>
            new URL(
              value,
            ).origin,
        ),
      );

    this.timeoutMs =
      timeoutMs;

    this.maxFileBytes =
      maxFileBytes;

    this.portalAccessToken =
      portalAccessToken;

    this.jobHttpClient =
      jobHttpClient;
  }

  resolveSourceUrl(
    value,
  ) {
    if (
      typeof value !== 'string'
      || value.trim() === ''
    ) {
      throw new DocumentSourceError(
        'Document URL must be a non-empty string.',
      );
    }

    let url;

    try {
      url =
        new URL(
          value.trim(),
          this.baseUrl,
        );
    } catch (error) {
      throw new DocumentSourceError(
        'Document URL is invalid.',
        {
          cause: error,
        },
      );
    }

    if (
      url.protocol !== 'https:'
    ) {
      throw new DocumentSourceError(
        'Document URL must use HTTPS.',
      );
    }

    if (
      url.username
      || url.password
    ) {
      throw new DocumentSourceError(
        'Document URL must not contain embedded credentials.',
      );
    }

    if (
      !this.allowedOrigins.has(
        url.origin,
      )
    ) {
      throw new DocumentSourceError(
        'Document URL origin is not allowlisted.',
        {
          details:
            toSafeSourceMetadata(
              url,
            ),
        },
      );
    }

    url.hash = '';

    return url;
  }

  async download(
    sourceUrl,
  ) {
    const url =
      this.resolveSourceUrl(
        sourceUrl,
      );

    const headers = {
      Accept:
        'application/pdf',
    };

    /*
     * The Portal bearer token is sent only back to the
     * configured Portal origin. It is never forwarded
     * to another allowlisted storage/CDN origin.
     */
    if (
      this.portalAccessToken
      && url.origin
        === this.portalOrigin
    ) {
      headers.Authorization =
        `Bearer ${this.portalAccessToken}`;
    }

    const response =
      await this.jobHttpClient
        .request(
          url.toString(),
          {
            method:
              'GET',

            headers,

            timeoutMs:
              this.timeoutMs,

            maxResponseBytes:
              this.maxFileBytes,

            maxRedirections:
              0,
          },
        );

    const body =
      Buffer.isBuffer(
        response.body,
      )
        ? response.body
        : Buffer.from(
            response.body
            ?? '',
          );

    const challenge =
      detectManualChallenge({
        statusCode:
          response.statusCode,

        headers:
          response.headers,

        body,
      });

    if (
      challenge.detected
    ) {
      throw new ManualChallengeRequiredError(
        'Document source returned a human-verification challenge.',
        {
          details: {
            reason:
              challenge.reason,

            ...toSafeSourceMetadata(
              url,
            ),
          },
        },
      );
    }

    if (
      response.statusCode >= 300
      && response.statusCode < 400
    ) {
      throw new DocumentSourceError(
        'Document source returned a redirect; automatic redirect following is disabled.',
        {
          details: {
            statusCode:
              response.statusCode,

            ...toSafeSourceMetadata(
              url,
            ),
          },
        },
      );
    }

    if (
      response.statusCode < 200
      || response.statusCode >= 300
    ) {
      throw new DocumentSourceError(
        `Document source returned HTTP ${response.statusCode}.`,
        {
          details: {
            statusCode:
              response.statusCode,

            ...toSafeSourceMetadata(
              url,
            ),
          },
        },
      );
    }

    const declaredLength =
      Number(
        getHeader(
          response.headers,
          'content-length',
        ),
      );

    if (
      Number.isFinite(
        declaredLength,
      )
      && declaredLength
        > this.maxFileBytes
    ) {
      throw new DocumentValidationError(
        'Document exceeds the configured per-file size limit.',
      );
    }

    return {
      sourceOrigin:
        url.origin,

      sourcePath:
        url.pathname,

      contentType:
        getHeader(
          response.headers,
          'content-type',
        ),

      body,
    };
  }
}