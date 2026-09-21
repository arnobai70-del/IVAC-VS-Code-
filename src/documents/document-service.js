"https://mrboss.live/path/file.pdf"
import {
  DocumentSourceError,
  DocumentValidationError,
} from './document-errors.js';

import {
  sanitizePdfFilename,
  validatePdf,
} from './pdf-validator.js';

function normalizeSources(
  value,
) {
  const sources =
    Array.isArray(value)
      ? value
      : (
          value === null
          || value === undefined
        )
        ? []
        : [
            value,
          ];

  return sources.map(
    (
      source,
      index,
    ) => {
      if (
        typeof source === 'string'
      ) {
        return {
          url:
            source,

          name:
            null,

          index,
        };
      }

      if (
        !source
        || typeof source
          !== 'object'
        || Array.isArray(
          source,
        )
      ) {
        throw new DocumentSourceError(
          `Portal document entry ${index} has an unsupported shape.`,
        );
      }

      if (
        typeof source.url
          !== 'string'
        || source.url.trim()
          === ''
      ) {
        throw new DocumentSourceError(
          `Portal document entry ${index} is missing a URL.`,
        );
      }

      if (
        source.name !== undefined
        && source.name !== null
        && typeof source.name
          !== 'string'
      ) {
        throw new DocumentSourceError(
          `Portal document entry ${index} has an invalid name.`,
        );
      }

      return {
        url:
          source.url,

        name:
          source.name
          ?? null,

        index,
      };
    },
  );
}

function filenameFromPath(
  sourcePath,
  index,
) {
  let candidate =
    '';

  try {
    const parts =
      sourcePath
        .split('/')
        .filter(Boolean);

    candidate =
      decodeURIComponent(
        parts.at(-1)
        ?? '',
      );
  } catch {
    candidate =
      '';
  }

  return sanitizePdfFilename(
    candidate,
    `document-${index + 1}.pdf`,
  );
}

function publicDocumentMetadata(
  document,
) {
  return {
    id:
      document.id,

    name:
      document.name,

    contentType:
      document.contentType,

    sizeBytes:
      document.sizeBytes,

    sha256:
      document.sha256,

    sourceOrigin:
      document.sourceOrigin,

    sourcePath:
      document.sourcePath,
  };
}

export class DocumentService {
  constructor({
    documentClient,
    maxCount,
    maxFileBytes,
    maxTotalBytes,
  }) {
    if (
      !documentClient
      || typeof documentClient
        .download
        !== 'function'
    ) {
      throw new TypeError(
        'documentClient with download() is required.',
      );
    }

    this.documentClient =
      documentClient;

    this.maxCount =
      maxCount;

    this.maxFileBytes =
      maxFileBytes;

    this.maxTotalBytes =
      maxTotalBytes;
  }

  async prepareForJobContext({
    jobContext,
    sources,
  }) {
    if (
      !jobContext
      || typeof jobContext
        .setDocuments
        !== 'function'
    ) {
      throw new TypeError(
        'A valid jobContext is required.',
      );
    }

    const normalizedSources =
      normalizeSources(
        sources,
      );

    if (
      normalizedSources.length
      === 0
    ) {
      throw new DocumentValidationError(
        'Portal application contains no PDF documents.',
      );
    }

    if (
      normalizedSources.length
      > this.maxCount
    ) {
      throw new DocumentValidationError(
        `Portal application contains more than ${this.maxCount} documents.`,
      );
    }

    const documents = [];

    const seenHashes =
      new Set();

    let totalBytes =
      0;

    for (
      const source
      of normalizedSources
    ) {
      const downloaded =
        await this.documentClient
          .download(
            source.url,
          );

      const fallbackName =
        filenameFromPath(
          downloaded.sourcePath,
          source.index,
        );

      const filename =
        sanitizePdfFilename(
          source.name,
          fallbackName,
        );

      const document =
        validatePdf({
          buffer:
            downloaded.body,

          contentType:
            downloaded.contentType,

          filename,

          maxFileBytes:
            this.maxFileBytes,

          sourceOrigin:
            downloaded.sourceOrigin,

          sourcePath:
            downloaded.sourcePath,
        });

      totalBytes +=
        document.sizeBytes;

      if (
        totalBytes
        > this.maxTotalBytes
      ) {
        throw new DocumentValidationError(
          'Combined PDF size exceeds the configured per-job total size limit.',
        );
      }

      if (
        seenHashes.has(
          document.sha256,
        )
      ) {
        throw new DocumentValidationError(
          'Duplicate PDF content was supplied for the same job.',
        );
      }

      seenHashes.add(
        document.sha256,
      );

      documents.push(
        document,
      );
    }

    jobContext.setDocuments(
      documents,
    );

    return {
      count:
        documents.length,

      totalBytes,

      documents:
        documents.map(
          publicDocumentMetadata,
        ),
    };
  }
}