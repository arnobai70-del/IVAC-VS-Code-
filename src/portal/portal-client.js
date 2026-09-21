import {
  isIP,
} from 'node:net';

import {
  request,
} from 'undici';

import {
  ConfigError,
  PortalAuthError,
  PortalNetworkError,
  PortalResponseError,
  RateLimitError,
  Remote5xxError,
} from '../core/errors.js';

export const PORTAL_HEALTH_STATES = Object.freeze({
  API_AUTHENTICATED:
    'API_AUTHENTICATED',

  API_REACHABLE:
    'API_REACHABLE',

  AUTH_FAILED:
    'AUTH_FAILED',

  FORBIDDEN:
    'FORBIDDEN',

  REDIRECTED_TO_LOGIN:
    'REDIRECTED_TO_LOGIN',

  SERVER_ERROR:
    'SERVER_ERROR',

  UNREACHABLE:
    'UNREACHABLE',

  AUTH_NOT_CONFIGURED:
    'AUTH_NOT_CONFIGURED',

  HEALTH_ROUTE_NOT_CONFIGURED:
    'HEALTH_ROUTE_NOT_CONFIGURED',
});

async function discardBody(body) {
  if (!body) {
    return;
  }

  if (typeof body.dump === 'function') {
    await body.dump();
    return;
  }

  for await (const ignored of body) {
    void ignored;
  }
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

  for await (const chunk of body) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    totalBytes += buffer.length;

    if (totalBytes > maxResponseBytes) {
      body.destroy?.();

      throw new PortalResponseError(
        'Portal response exceeded the configured size limit.',
      );
    }

    chunks.push(buffer);
  }

  return Buffer
    .concat(chunks)
    .toString('utf8');
}

function isTimeoutError(error) {
  return (
    error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.code === 'UND_ERR_CONNECT_TIMEOUT'
    || error?.code === 'UND_ERR_HEADERS_TIMEOUT'
    || error?.code === 'UND_ERR_BODY_TIMEOUT'
  );
}

export class PortalClient {
  constructor({
    baseUrl,
    pendingPath,
    healthPath,
    timeoutMs,
    maxResponseBytes,
    accessToken,
    requestFn = request,
  }) {
    if (
      healthPath !== null
      && healthPath === pendingPath
    ) {
      throw new ConfigError(
        'Portal health route must not be the destructive pending endpoint.',
      );
    }

    this.baseUrl = baseUrl;
    this.pendingPath = pendingPath;
    this.healthPath = healthPath;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes =
      maxResponseBytes;
    this.accessToken =
      accessToken;
    this.requestFn =
      requestFn;
  }

  buildUrl(path) {
    return new URL(
      path,
      this.baseUrl,
    ).toString();
  }

  getCommonHeaders() {
    return {
      Accept: 'application/json',
      'Content-Type':
        'application/json',
      Authorization:
        `Bearer ${this.accessToken}`,
    };
  }

  async healthCheck() {
    if (!this.healthPath) {
      return {
        status:
          PORTAL_HEALTH_STATES
            .HEALTH_ROUTE_NOT_CONFIGURED,

        reachable: false,
        authenticated: false,
        safeToConsume: false,
      };
    }

    if (!this.accessToken) {
      return {
        status:
          PORTAL_HEALTH_STATES
            .AUTH_NOT_CONFIGURED,

        reachable: false,
        authenticated: false,
        safeToConsume: false,
      };
    }

    try {
      const response =
        await this.requestFn(
          this.buildUrl(
            this.healthPath,
          ),
          {
            method: 'GET',

            headers:
              this.getCommonHeaders(),

            signal:
              AbortSignal.timeout(
                this.timeoutMs,
              ),

            maxRedirections: 0,
          },
        );

      const statusCode =
        response.statusCode;

      await discardBody(
        response.body,
      );

      if (
        statusCode >= 200
        && statusCode < 300
      ) {
        return {
          status:
            PORTAL_HEALTH_STATES
              .API_AUTHENTICATED,

          reachable: true,
          authenticated: true,
          safeToConsume: true,
          statusCode,
        };
      }

      if (statusCode === 401) {
        return {
          status:
            PORTAL_HEALTH_STATES
              .AUTH_FAILED,

          reachable: true,
          authenticated: false,
          safeToConsume: false,
          statusCode,
        };
      }

      if (statusCode === 403) {
        return {
          status:
            PORTAL_HEALTH_STATES
              .FORBIDDEN,

          reachable: true,
          authenticated: false,
          safeToConsume: false,
          statusCode,
        };
      }

      if (
        statusCode >= 300
        && statusCode < 400
      ) {
        return {
          status:
            PORTAL_HEALTH_STATES
              .REDIRECTED_TO_LOGIN,

          reachable: true,
          authenticated: false,
          safeToConsume: false,
          statusCode,
        };
      }

      if (statusCode >= 500) {
        return {
          status:
            PORTAL_HEALTH_STATES
              .SERVER_ERROR,

          reachable: true,
          authenticated: false,
          safeToConsume: false,
          statusCode,
        };
      }

      return {
        status:
          PORTAL_HEALTH_STATES
            .API_REACHABLE,

        reachable: true,
        authenticated: false,
        safeToConsume: false,
        statusCode,
      };
    } catch (error) {
      return {
        status:
          PORTAL_HEALTH_STATES
            .UNREACHABLE,

        reachable: false,
        authenticated: false,
        safeToConsume: false,

        timeout:
          isTimeoutError(error),
      };
    }
  }

  async fetchPendingOne({
    serverName,
  }) {
    if (!this.accessToken) {
      throw new PortalAuthError(
        'Portal access token is not configured.',
      );
    }

    if (
      typeof serverName !== 'string'
      || isIP(serverName) === 0
    ) {
      throw new ConfigError(
        'Portal Server-Name must be the assigned IPv4 or IPv6 address.',
      );
    }

    let response;

    try {
      response =
        await this.requestFn(
          this.buildUrl(
            this.pendingPath,
          ),
          {
            method: 'GET',

            headers: {
              ...this.getCommonHeaders(),

              'Server-Name':
                serverName,
            },

            signal:
              AbortSignal.timeout(
                this.timeoutMs,
              ),

            maxRedirections: 0,
          },
        );
    } catch (error) {
      throw new PortalNetworkError(
        isTimeoutError(error)
          ? 'Portal pending request timed out.'
          : 'Portal pending request could not be completed.',
        {
          cause: error,
        },
      );
    }

    const statusCode =
      response.statusCode;

    if (statusCode === 204) {
      await discardBody(
        response.body,
      );

      return null;
    }

    if (statusCode === 401) {
      await discardBody(
        response.body,
      );

      throw new PortalAuthError(
        'Portal rejected the configured access token.',
      );
    }

    if (statusCode === 403) {
      await discardBody(
        response.body,
      );

      throw new PortalAuthError(
        'Portal forbids access to the pending endpoint.',
      );
    }

    if (
      statusCode >= 300
      && statusCode < 400
    ) {
      await discardBody(
        response.body,
      );

      throw new PortalAuthError(
        'Portal pending request was redirected instead of returning an API response.',
      );
    }

    if (statusCode === 429) {
      await discardBody(
        response.body,
      );

      throw new RateLimitError(
        'Portal rate limited the pending request.',
      );
    }

    if (statusCode >= 500) {
      await discardBody(
        response.body,
      );

      throw new Remote5xxError(
        'Portal returned a server error for the pending request.',
      );
    }

    if (
      statusCode < 200
      || statusCode >= 300
    ) {
      await discardBody(
        response.body,
      );

      throw new PortalResponseError(
        `Portal pending request returned HTTP ${statusCode}.`,
      );
    }

    const rawText =
      await readBodyLimited(
        response.body,
        this.maxResponseBytes,
      );

    if (rawText.trim() === '') {
      return null;
    }

    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new PortalResponseError(
        'Portal pending response is not valid JSON.',
        {
          cause: error,
        },
      );
    }
  }
}