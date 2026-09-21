import {
  request,
} from 'undici';

import {
  NetworkTimeoutError,
  RateLimitError,
  Remote5xxError,
  SessionClosedError,
  SessionError,
} from '../core/errors.js';

function isTimeoutError(error) {
  return (
    error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.code === 'UND_ERR_CONNECT_TIMEOUT'
    || error?.code === 'UND_ERR_HEADERS_TIMEOUT'
    || error?.code === 'UND_ERR_BODY_TIMEOUT'
  );
}

function getSetCookieHeaders(
  headers,
) {
  if (!headers) {
    return [];
  }

  if (
    typeof headers.getSetCookie
    === 'function'
  ) {
    return headers.getSetCookie();
  }

  const value =
    headers['set-cookie']
    ?? headers['Set-Cookie'];

  if (!value) {
    return [];
  }

  return Array.isArray(value)
    ? value
    : [value];
}

async function readBodyLimited(
  body,
  maxResponseBytes,
) {
  if (!body) {
    return Buffer.alloc(0);
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of body) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    totalBytes +=
      buffer.length;

    if (
      totalBytes > maxResponseBytes
    ) {
      body.destroy?.();

      throw new SessionError(
        'HTTP response exceeded configured size limit.',
      );
    }

    chunks.push(buffer);
  }

  return Buffer.concat(
    chunks,
  );
}

function buildHeaders(
  baseHeaders,
  cookieHeader,
) {
  const headers = {
    ...baseHeaders,
  };

  if (cookieHeader) {
    headers.Cookie =
      cookieHeader;
  }

  return headers;
}

export class JobHttpClient {
  constructor({
    session,
    requestFn = request,
    defaultTimeoutMs = 15000,
    maxResponseBytes = 5 * 1024 * 1024,
  }) {
    if (!session) {
      throw new TypeError(
        'session is required.',
      );
    }

    this.session =
      session;

    this.requestFn =
      requestFn;

    this.defaultTimeoutMs =
      defaultTimeoutMs;

    this.maxResponseBytes =
      maxResponseBytes;
  }

  assertOpen() {
    if (this.session.closed) {
      throw new SessionClosedError();
    }

    if (!this.session.dispatcher) {
      throw new SessionError(
        'Session dispatcher is unavailable.',
      );
    }
  }

  async request(
    url,
    {
      method = 'GET',
      headers = {},
      body,
      timeoutMs =
        this.defaultTimeoutMs,
      maxResponseBytes =
        this.maxResponseBytes,
      maxRedirections = 0,
    } = {},
  ) {
    this.assertOpen();

    const cookieHeader =
      this.session.cookieJar
        .getCookieHeader(url);

    const requestHeaders =
      buildHeaders(
        headers,
        cookieHeader,
      );

    let response;

    try {
      response =
        await this.requestFn(
          url,
          {
            method,
            headers:
              requestHeaders,

            body,

            dispatcher:
              this.session.dispatcher,

            signal:
              AbortSignal.timeout(
                timeoutMs,
              ),

            maxRedirections,
          },
        );
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new NetworkTimeoutError(
          'Job HTTP request timed out.',
          {
            cause: error,
          },
        );
      }

      throw new SessionError(
        'Job HTTP request failed.',
        {
          cause: error,
          retryable: true,
        },
      );
    }

    const setCookies =
      getSetCookieHeaders(
        response.headers,
      );

    this.session.cookieJar
      .setCookies(
        setCookies,
        url,
      );

    if (
      response.statusCode === 429
    ) {
      await response.body?.dump?.();

      throw new RateLimitError();
    }

    if (
      response.statusCode >= 500
    ) {
      await response.body?.dump?.();

      throw new Remote5xxError();
    }

    const rawBody =
      await readBodyLimited(
        response.body,
        maxResponseBytes,
      );

    return {
      statusCode:
        response.statusCode,

      headers:
        response.headers,

      body:
        rawBody,
    };
  }

  async requestJson(
    url,
    options = {},
  ) {
    const response =
      await this.request(
        url,
        options,
      );

    if (
      response.body.length === 0
    ) {
      return {
        ...response,
        json: null,
      };
    }

    let json;

    try {
      json =
        JSON.parse(
          response.body.toString(
            'utf8',
          ),
        );
    } catch (error) {
      throw new SessionError(
        'Job HTTP response is not valid JSON.',
        {
          cause: error,
          retryable: false,
        },
      );
    }

    return {
      ...response,
      json,
    };
  }
}