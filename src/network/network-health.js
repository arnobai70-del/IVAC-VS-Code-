import {
  request,
} from 'undici';

import {
  ERROR_CODES,
} from '../core/errors.js';

function getSafeFailureLabel(error) {
  if (!(error instanceof Error)) {
    return 'NetworkError';
  }

  const code =
    typeof error.code === 'string'
      ? error.code
      : null;

  if (code) {
    return `${error.name}:${code}`;
  }

  return error.name || 'NetworkError';
}

function isTimeoutError(error) {
  return (
    error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.code
      === 'UND_ERR_CONNECT_TIMEOUT'
    || error?.code
      === 'UND_ERR_HEADERS_TIMEOUT'
    || error?.code
      === 'UND_ERR_BODY_TIMEOUT'
  );
}

export class NetworkHealthService {
  constructor({
    proxyPool,
    dispatcherPool,
    requestFn = request,
  }) {
    this.proxyPool = proxyPool;
    this.dispatcherPool =
      dispatcherPool;
    this.requestFn = requestFn;
  }

  async testProxy(
    proxyId,
    {
      url,
      timeoutMs,
      cooldownMs,
    },
  ) {
    if (!url) {
      throw new TypeError(
        'Network health test URL is required.',
      );
    }

    const dispatcher =
      await this.dispatcherPool
        .getForProxy(
          proxyId,
          {
            allowDisabled: true,
          },
        );

    const startedAt =
      process.hrtime.bigint();

    try {
      const response =
        await this.requestFn(
          url,
          {
            method: 'GET',
            dispatcher,

            signal:
              AbortSignal.timeout(
                timeoutMs,
              ),

            maxRedirections: 0,
          },
        );

      if (response.body?.dump) {
        await response.body.dump();
      }

      const latencyMs =
        Number(
          process.hrtime.bigint()
          - startedAt,
        ) / 1_000_000;

      if (
        response.statusCode < 200
        || response.statusCode >= 400
      ) {
        throw Object.assign(
          new Error(
            'Proxy health probe returned an unsuccessful HTTP status.',
          ),
          {
            code:
              `HTTP_${response.statusCode}`,
          },
        );
      }

      const proxy =
        this.proxyPool
          .recordHealthSuccess(
            proxyId,
            {
              latencyMs,
            },
          );

      return {
        ok: true,
        proxyId,
        statusCode:
          response.statusCode,
        latencyMs:
          Math.round(latencyMs),
        proxy,
      };
    } catch (error) {
      const proxy =
        this.proxyPool
          .recordHealthFailure(
            proxyId,
            {
              errorMessage:
                getSafeFailureLabel(
                  error,
                ),

              cooldownMs,
            },
          );

      return {
        ok: false,
        proxyId,

        errorCode:
          isTimeoutError(error)
            ? ERROR_CODES.NETWORK_TIMEOUT
            : ERROR_CODES.PROXY_UNAVAILABLE,

        proxy,
      };
    }
  }
}