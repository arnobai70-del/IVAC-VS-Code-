import {
  ManualChallengeRequiredError,
  WorkflowStepError,
} from '../core/errors.js';

import {
  buildPdfMultipart,
} from '../documents/multipart.js';

import {
  detectManualChallenge,
} from './challenge-detector.js';

const forbiddenHeaderNames =
  new Set([
    'host',
    'content-length',
    'transfer-encoding',
    'connection',
    'proxy-authorization',
    'proxy-connection',
    'cookie',
  ]);

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

function validateHeaders(
  headers,
) {
  const output = {};

  for (
    const [
      name,
      value,
    ]
    of Object.entries(
      headers
      ?? {},
    )
  ) {
    const normalizedName =
      name.trim()
        .toLowerCase();

    if (!normalizedName) {
      throw new WorkflowStepError(
        'Workflow HTTP header name cannot be empty.',
      );
    }

    if (
      forbiddenHeaderNames.has(
        normalizedName,
      )
    ) {
      throw new WorkflowStepError(
        `Workflow is not allowed to control the ${name} header.`,
      );
    }

    output[
      name
    ] =
      String(
        value,
      );
  }

  return output;
}

function ensureJsonContentType(
  headers,
  stepId,
) {
  const contentType =
    getHeader(
      headers,
      'content-type',
    );

  if (!contentType) {
    return;
  }

  const normalized =
    contentType
      .toLowerCase();

  if (
    !normalized.includes(
      'application/json',
    )
    && !normalized.includes(
      '+json',
    )
  ) {
    throw new WorkflowStepError(
      `Workflow step ${stepId} expected JSON but received ${contentType}.`,
    );
  }
}

function parseExpectedResponse({
  response,
  expect,
  stepId,
}) {
  if (
    expect.response
    === 'empty'
  ) {
    return {
      statusCode:
        response.statusCode,

      data:
        null,
    };
  }

  if (
    expect.response
    === 'text'
  ) {
    return {
      statusCode:
        response.statusCode,

      data:
        response.body
          .toString(
            'utf8',
          ),
    };
  }

  ensureJsonContentType(
    response.headers,
    stepId,
  );

  if (
    response.body.length
    === 0
  ) {
    return {
      statusCode:
        response.statusCode,

      data:
        null,
    };
  }

  let data;

  try {
    data =
      JSON.parse(
        response.body
          .toString(
            'utf8',
          ),
      );
  } catch (error) {
    throw new WorkflowStepError(
      `Workflow step ${stepId} returned invalid JSON.`,
      {
        cause: error,

        details: {
          stepId,

          statusCode:
            response.statusCode,
        },
      },
    );
  }

  return {
    statusCode:
      response.statusCode,

    data,
  };
}

export class TargetHttpClient {
  constructor({
    baseUrl,
    jobHttpClient,
    timeoutMs,
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

    this.jobHttpClient =
      jobHttpClient;

    this.timeoutMs =
      timeoutMs;

    this.basePath =
      `${
        this.baseUrl.pathname
          .replace(
            /\/+$/,
            '',
          )
      }/`;
  }

  buildUrl(
    route,
  ) {
    if (
      typeof route !== 'string'
      || route.trim() === ''
    ) {
      throw new WorkflowStepError(
        'Workflow HTTP route must be a non-empty string.',
      );
    }

    const normalizedRoute =
      route.trim();

    if (
      normalizedRoute.includes(
        '://',
      )
      || normalizedRoute
        .startsWith('//')
      || normalizedRoute
        .includes('\\')
    ) {
      throw new WorkflowStepError(
        'Workflow HTTP route must remain relative to the configured target API.',
      );
    }

    const relativeRoute =
      normalizedRoute
        .replace(
          /^\/+/,
          '',
        );

    const resolved =
      new URL(
        `${
          this.basePath
        }${relativeRoute}`,
        this.baseUrl.origin,
      );

    if (
      resolved.origin
      !== this.baseUrl.origin
      || !resolved.pathname
        .startsWith(
          this.basePath,
        )
    ) {
      throw new WorkflowStepError(
        'Workflow HTTP route escaped the configured target API base path.',
      );
    }

    return resolved.toString();
  }

  validateResponse({
    response,
    expect,
    stepId,
  }) {
    const challenge =
      detectManualChallenge({
        statusCode:
          response.statusCode,

        headers:
          response.headers,

        body:
          response.body,
      });

    if (
      challenge.detected
    ) {
      throw new ManualChallengeRequiredError(
        `Workflow step ${stepId} encountered a human-verification challenge.`,
        {
          details: {
            stepId,

            statusCode:
              response.statusCode,

            reason:
              challenge.reason,
          },
        },
      );
    }

    if (
      !expect.statuses.includes(
        response.statusCode,
      )
    ) {
      throw new WorkflowStepError(
        `Workflow step ${stepId} received unexpected HTTP ${response.statusCode}.`,
        {
          details: {
            stepId,

            statusCode:
              response.statusCode,
          },
        },
      );
    }

    return parseExpectedResponse({
      response,
      expect,
      stepId,
    });
  }

  async requestStep({
    stepId,
    method,
    route,
    headers = {},
    body,
    expect,
  }) {
    const url =
      this.buildUrl(
        route,
      );

    const requestHeaders =
      validateHeaders(
        headers,
      );

    let requestBody;

    if (
      body !== undefined
    ) {
      if (
        method === 'GET'
        || method === 'HEAD'
      ) {
        throw new WorkflowStepError(
          `Workflow step ${stepId} cannot attach a body to ${method}.`,
        );
      }

      requestBody =
        JSON.stringify(
          body,
        );

      const hasContentType =
        Object.keys(
          requestHeaders,
        )
          .some(
            (name) =>
              name.toLowerCase()
              === 'content-type',
          );

      if (
        !hasContentType
      ) {
        requestHeaders[
          'Content-Type'
        ] =
          'application/json';
      }
    }

    const response =
      await this.jobHttpClient
        .request(
          url,
          {
            method,

            headers:
              requestHeaders,

            body:
              requestBody,

            timeoutMs:
              this.timeoutMs,

            maxRedirections:
              0,
          },
        );

    return this.validateResponse({
      response,
      expect,
      stepId,
    });
  }

  async uploadPdf({
    stepId,
    route,
    headers = {},
    fieldName,
    fields = {},
    document,
    expect,
  }) {
    const url =
      this.buildUrl(
        route,
      );

    const requestHeaders =
      validateHeaders(
        headers,
      );

    const suppliedContentType =
      Object.keys(
        requestHeaders,
      )
        .some(
          (name) =>
            name.toLowerCase()
            === 'content-type',
        );

    if (
      suppliedContentType
    ) {
      throw new WorkflowStepError(
        `Workflow step ${stepId} cannot manually set Content-Type for multipart PDF upload.`,
      );
    }

    if (
      !document
      || typeof document
        !== 'object'
      || !Buffer.isBuffer(
        document.buffer,
      )
    ) {
      throw new WorkflowStepError(
        `Workflow step ${stepId} received an invalid prepared document.`,
      );
    }

    const multipart =
      buildPdfMultipart({
        fieldName,

        filename:
          document.name,

        pdfBuffer:
          document.buffer,

        fields,
      });

    requestHeaders[
      'Content-Type'
    ] =
      multipart.contentType;

    const response =
      await this.jobHttpClient
        .request(
          url,
          {
            method:
              'POST',

            headers:
              requestHeaders,

            body:
              multipart.body,

            timeoutMs:
              this.timeoutMs,

            maxRedirections:
              0,
          },
        );

    return this.validateResponse({
      response,
      expect,
      stepId,
    });
  }
}