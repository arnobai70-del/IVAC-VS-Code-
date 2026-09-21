import {
  PortalResponseError,
} from '../core/errors.js';

const forbiddenPathSegments = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function readPath(
  value,
  path,
) {
  if (!path) {
    return null;
  }

  const segments =
    path.split('.');

  let current = value;

  for (const segment of segments) {
    if (
      forbiddenPathSegments.has(segment)
    ) {
      throw new PortalResponseError(
        'Portal mapping contains an unsafe path.',
      );
    }

    if (
      current === null
      || current === undefined
      || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(
        current,
        segment,
      )
    ) {
      return null;
    }

    current = current[segment];
  }

  return current;
}

function normalizeOptionalText(value) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== 'string'
    && typeof value !== 'number'
  ) {
    throw new PortalResponseError(
      'Portal field expected text-compatible data.',
    );
  }

  const normalized =
    String(value).trim();

  return normalized || null;
}

function normalizeRequiredIdentifier(
  value,
  fieldName,
) {
  const normalized =
    normalizeOptionalText(value);

  if (!normalized) {
    throw new PortalResponseError(
      `Portal application is missing required ${fieldName}.`,
    );
  }

  return normalized;
}

function unwrapSingleApplication(payload) {
  if (
    payload === null
    || payload === undefined
  ) {
    return null;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return null;
    }

    if (payload.length > 1) {
      throw new PortalResponseError(
        'Pending response contained more than one application; bounded destructive intake cannot safely consume this response shape.',
      );
    }

    return payload[0];
  }

  if (typeof payload !== 'object') {
    throw new PortalResponseError(
      'Portal pending response must be an object, an array, or null.',
    );
  }

  return payload;
}

export class PortalMapper {
  constructor(mapping) {
    this.mapping = mapping;
  }

  normalizeApplication(payload) {
    const application =
      unwrapSingleApplication(payload);

    if (!application) {
      return null;
    }

    const applicationId =
      normalizeRequiredIdentifier(
        readPath(
          application,
          this.mapping.applicationId,
        ),
        'applicationId',
      );

    const userId =
      normalizeOptionalText(
        readPath(
          application,
          this.mapping.userId,
        ),
      );

    const phone =
      normalizeOptionalText(
        readPath(
          application,
          this.mapping.phone,
        ),
      );

    const password =
      normalizeOptionalText(
        readPath(
          application,
          this.mapping.password,
        ),
      );

    const passportNumber =
      normalizeOptionalText(
        readPath(
          application,
          this.mapping.passportNumber,
        ),
      );

    const documentsValue =
      readPath(
        application,
        this.mapping.documents,
      );

    let documents = [];

    if (
      documentsValue !== null
      && documentsValue !== undefined
    ) {
      if (!Array.isArray(documentsValue)) {
        throw new PortalResponseError(
          'Portal documents field must be an array when present.',
        );
      }

      documents = documentsValue;
    }

    return Object.freeze({
      applicationId,
      userId,
      phone,
      password,
      passportNumber,
      documents,
    });
  }
}