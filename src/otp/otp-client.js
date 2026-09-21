import {
  ManualChallengeRequiredError,
  OtpResponseError,
} from '../core/errors.js';

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
    return headers.get(name);
  }

  const targetName =
    name.toLowerCase();

  for (
    const [
      key,
      value,
    ]
    of Object.entries(headers)
  ) {
    if (
      key.toLowerCase()
      !== targetName
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    if (
      value === null
      || value === undefined
    ) {
      return null;
    }

    return String(value);
  }

  return null;
}

function looksLikeChallengeHtml(
  html,
) {
  const normalized =
    html
      .toLowerCase()
      .slice(
        0,
        250_000,
      );

  const markers = [
    'cf-chl-',
    'challenge-platform',
    'cf-turnstile',
    'turnstile',
    'g-recaptcha',
    'recaptcha',
    'hcaptcha',
    'h-captcha',
    'just a moment',
    'checking your browser',
    'verify you are human',
  ];

  return markers.some(
    (marker) =>
      normalized.includes(
        marker,
      ),
  );
}

export class OtpClient {
  constructor({
    baseUrl,
    tablePath,
    maxResponseBytes,
    jobHttpClient,
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

    this.baseUrl =
      baseUrl;

    this.tablePath =
      tablePath;

    this.maxResponseBytes =
      maxResponseBytes;

    this.jobHttpClient =
      jobHttpClient;
  }

  getTableUrl() {
    return new URL(
      this.tablePath,
      this.baseUrl,
    ).toString();
  }

  async fetchTableHtml() {
    const response =
      await this.jobHttpClient
        .request(
          this.getTableUrl(),
          {
            method:
              'GET',

            headers: {
              Accept:
                'text/html,application/xhtml+xml',
            },

            maxResponseBytes:
              this.maxResponseBytes,

            maxRedirections:
              0,
          },
        );

    if (
      response.statusCode === 403
      || (
        response.statusCode >= 300
        && response.statusCode < 400
      )
    ) {
      throw new ManualChallengeRequiredError(
        'OTP table did not return its expected page; manual inspection is required.',
      );
    }

    if (
      response.statusCode < 200
      || response.statusCode >= 300
    ) {
      throw new OtpResponseError(
        `OTP table returned HTTP ${response.statusCode}.`,
      );
    }

    const contentType =
      getHeader(
        response.headers,
        'content-type',
      );

    if (
      contentType
      && !contentType
        .toLowerCase()
        .includes('text/html')
      && !contentType
        .toLowerCase()
        .includes(
          'application/xhtml+xml',
        )
    ) {
      throw new OtpResponseError(
        'OTP table returned an unexpected content type.',
      );
    }

    const html =
      response.body.toString(
        'utf8',
      );

    if (
      looksLikeChallengeHtml(
        html,
      )
    ) {
      throw new ManualChallengeRequiredError(
        'OTP table returned an anti-bot or human-verification challenge.',
      );
    }

    return html;
  }
}