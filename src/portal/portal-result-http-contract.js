import {
  request,
} from 'undici';

import {
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  PortalResultDeliveryUncertainError,
  PortalResultResponseError,
} from '../results/final-result-errors.js';

import {
  PORTAL_RESULT_DELIVERY_CERTAINTY,
} from './portal-result-client.js';

function deliveryDetails(
  deliveryCertainty,
  extra = {},
) {
  return {
    deliveryCertainty,
    ...extra,
  };
}

function notSentError(
  message,
) {
  return new PortalResultResponseError(
    message,
    {
      details:
        deliveryDetails(
          PORTAL_RESULT_DELIVERY_CERTAINTY
            .NOT_SENT,
        ),
    },
  );
}

function rejectedError(
  message,
  statusCode,
) {
  return new PortalResultResponseError(
    message,
    {
      details:
        deliveryDetails(
          PORTAL_RESULT_DELIVERY_CERTAINTY
            .REJECTED,
          {
            statusCode,
          },
        ),
    },
  );
}

function uncertainError(
  message,
  {
    cause,
    statusCode,
  } = {},
) {
  return new PortalResultDeliveryUncertainError(
    message,
    {
      cause,

      details:
        deliveryDetails(
          PORTAL_RESULT_DELIVERY_CERTAINTY
            .UNCERTAIN,
          {
            ...(
              statusCode === undefined
                ? {}
                : {
                    statusCode,
                  }
            ),
          },
        ),
    },
  );
}

function isTimeoutError(
  error,
) {
  return (
    error?.name
      === 'TimeoutError'
    || error?.name
      === 'AbortError'
    || error?.code
      === 'UND_ERR_CONNECT_TIMEOUT'
    || error?.code
      === 'UND_ERR_HEADERS_TIMEOUT'
    || error?.code
      === 'UND_ERR_BODY_TIMEOUT'
  );
}

function normalizeApplicationId(
  value,
) {
  if (
    typeof value === 'number'
    && Number.isSafeInteger(
      value,
    )
    && value > 0
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    const trimmed =
      value.trim();

    if (
      /^[1-9]\d*$/.test(
        trimmed,
      )
    ) {
      const numeric =
        Number(
          trimmed,
        );

      if (
        Number.isSafeInteger(
          numeric,
        )
      ) {
        return numeric;
      }
    }
  }

  return null;
}

function normalizeMessage(
  value,
) {
  if (
    typeof value !== 'string'
  ) {
    return null;
  }

  const trimmed =
    value.trim();

  if (
    trimmed === ''
  ) {
    return null;
  }

  /*
   * Keep result delivery deliberately bounded.
   *
   * No raw response/result data is forwarded.
   */
  return trimmed
    .slice(
      0,
      1000,
    );
}

function portalStatusFor(
  result,
) {
  if (
    result.terminalState
      === JOB_STATES.COMPLETED
    && result.outcome
      === 'SUCCESS'
  ) {
    return 'completed';
  }

  if (
    result.terminalState
      === JOB_STATES.FAILED_FINAL
  ) {
    return 'failed';
  }

  throw notSentError(
    'Portal final-result delivery requires an explicit terminal result.',
  );
}

function buildStatusPath(
  template,
  applicationId,
) {
  return template.replace(
    '{application}',
    encodeURIComponent(
      String(
        applicationId,
      ),
    ),
  );
}

async function readBodyLimited(
  body,
  maxResponseBytes,
) {
  if (!body) {
    return '';
  }

  const chunks = [];
  let totalBytes = 0;

  for await (
    const chunk
    of body
  ) {
    const buffer =
      Buffer.isBuffer(
        chunk,
      )
        ? chunk
        : Buffer.from(
            chunk,
          );

    totalBytes +=
      buffer.length;

    if (
      totalBytes
      > maxResponseBytes
    ) {
      body.destroy?.();

      throw uncertainError(
        'Portal final-result acknowledgement exceeded the configured size limit.',
      );
    }

    chunks.push(
      buffer,
    );
  }

  return Buffer
    .concat(
      chunks,
    )
    .toString(
      'utf8',
    );
}

async function discardBody(
  body,
) {
  if (!body) {
    return;
  }

  if (
    typeof body.dump
      === 'function'
  ) {
    await body.dump();

    return;
  }

  for await (
    const ignored
    of body
  ) {
    void ignored;
  }
}

function parseAcknowledgement(
  rawText,
) {
  if (
    typeof rawText !== 'string'
    || rawText.trim() === ''
  ) {
    return null;
  }

  let payload;

  try {
    payload =
      JSON.parse(
        rawText,
      );
  } catch {
    return null;
  }

  if (
    payload === null
    || typeof payload !== 'object'
    || Array.isArray(
      payload,
    )
    || payload.data === null
    || typeof payload.data !== 'object'
    || Array.isArray(
      payload.data,
    )
  ) {
    return null;
  }

  return payload.data;
}

export class PortalResultHttpContract {
  constructor({
    baseUrl,
    statusPathTemplate,
    workerServerName,
    accessToken,
    timeoutMs,
    maxResponseBytes,
    requestFn = request,
  }) {
    this.baseUrl =
      baseUrl;

    this.statusPathTemplate =
      statusPathTemplate;

    this.workerServerName =
      typeof workerServerName
        === 'string'
        ? workerServerName.trim()
        : '';

    this.accessToken =
      typeof accessToken
        === 'string'
        ? accessToken.trim()
        : '';

    this.timeoutMs =
      timeoutMs;

    this.maxResponseBytes =
      maxResponseBytes;

    this.requestFn =
      requestFn;
  }

  get supportsIdempotentReplay() {
    /*
     * Verified production Portal status endpoint has no remote
     * idempotency-key contract or duplicate-response guarantee.
     */
    return false;
  }

  async send({
    result,
  }) {
    if (
      !this.workerServerName
    ) {
      throw notSentError(
        'Portal worker Server-Name is not configured.',
      );
    }

    if (
      !this.accessToken
    ) {
      throw notSentError(
        'Portal API access token is not configured.',
      );
    }

    const applicationId =
      normalizeApplicationId(
        result.applicationId,
      );

    if (
      applicationId === null
    ) {
      throw notSentError(
        'Portal final-result delivery requires the numeric Portal Application ID.',
      );
    }

    const status =
      portalStatusFor(
        result,
      );

    const message =
      normalizeMessage(
        result.message,
      );

    const payload = {
      status,

      ...(
        message === null
          ? {}
          : {
              message,
            }
      ),
    };

    /*
     * Intentionally excluded:
     *
     * - OTP
     * - password
     * - cookies/tokens
     * - raw workflow data
     * - result.data
     * - local idempotency key
     * - proxy IP
     * - payment status
     * - invoice fields
     */
    const path =
      buildStatusPath(
        this.statusPathTemplate,
        applicationId,
      );

    let response;

    try {
      response =
        await this.requestFn(
          new URL(
            path,
            this.baseUrl,
          ).toString(),
          {
            method:
              'POST',

            headers: {
              Accept:
                'application/json',

              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${this.accessToken}`,

              'Server-Name':
                this.workerServerName,
            },

            body:
              JSON.stringify(
                payload,
              ),

            signal:
              AbortSignal.timeout(
                this.timeoutMs,
              ),

            maxRedirections:
              0,
          },
        );
    } catch (error) {
      throw uncertainError(
        isTimeoutError(
          error,
        )
          ? 'Portal final-result request timed out and delivery certainty is unknown.'
          : 'Portal final-result request failed after send initiation and delivery certainty is unknown.',
        {
          cause:
            error,
        },
      );
    }

    const statusCode =
      response.statusCode;

    /*
     * Verified explicit rejections prove that the requested
     * update was not accepted by the Portal contract.
     */
    if (
      statusCode === 401
      || statusCode === 403
      || statusCode === 422
    ) {
      await discardBody(
        response.body,
      );

      throw rejectedError(
        `Portal rejected the final-result update with HTTP ${statusCode}.`,
        statusCode,
      );
    }

    /*
     * Redirects are not valid API acknowledgements and may have
     * involved an intermediary. Treat them conservatively.
     */
    if (
      statusCode >= 300
      && statusCode < 400
    ) {
      await discardBody(
        response.body,
      );

      throw uncertainError(
        `Portal final-result request returned unexpected HTTP ${statusCode}; delivery certainty is unknown.`,
        {
          statusCode,
        },
      );
    }

    /*
     * A 5xx response does not prove whether the remote mutation
     * happened before the server failed.
     */
    if (
      statusCode >= 500
    ) {
      await discardBody(
        response.body,
      );

      throw uncertainError(
        `Portal final-result request returned HTTP ${statusCode}; delivery certainty is unknown.`,
        {
          statusCode,
        },
      );
    }

    if (
      statusCode < 200
      || statusCode >= 300
    ) {
      await discardBody(
        response.body,
      );

      throw rejectedError(
        `Portal rejected the final-result update with HTTP ${statusCode}.`,
        statusCode,
      );
    }

    let rawText;

    try {
      rawText =
        await readBodyLimited(
          response.body,
          this.maxResponseBytes,
        );
    } catch (error) {
      if (
        error?.details
          ?.deliveryCertainty
        === PORTAL_RESULT_DELIVERY_CERTAINTY
          .UNCERTAIN
      ) {
        throw error;
      }

      throw uncertainError(
        'Portal final-result acknowledgement could not be read completely.',
        {
          cause:
            error,
          statusCode,
        },
      );
    }

    const acknowledgement =
      parseAcknowledgement(
        rawText,
      );

    /*
     * HTTP success alone is insufficient.
     *
     * Production acknowledgement must prove the exact Portal
     * application, requested terminal status, and worker identity.
     */
    if (!acknowledgement) {
      throw uncertainError(
        'Portal final-result response did not contain a valid acknowledgement object.',
        {
          statusCode,
        },
      );
    }

    const acknowledgedId =
      normalizeApplicationId(
        acknowledgement.id,
      );

    if (
      acknowledgedId
      !== applicationId
    ) {
      throw uncertainError(
        'Portal final-result acknowledgement returned a different application ID.',
        {
          statusCode,
        },
      );
    }

    if (
      acknowledgement.status
      !== status
    ) {
      throw uncertainError(
        'Portal final-result acknowledgement returned a different terminal status.',
        {
          statusCode,
        },
      );
    }

    if (
      acknowledgement.server_name
      !== this.workerServerName
    ) {
      throw uncertainError(
        'Portal final-result acknowledgement returned a different Server-Name.',
        {
          statusCode,
        },
      );
    }

    return {
      accepted:
        true,

      statusCode,
    };
  }
}