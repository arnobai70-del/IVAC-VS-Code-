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
    of Object.entries(headers)
  ) {
    if (
      key.toLowerCase()
      !== target
    ) {
      continue;
    }

    if (
      Array.isArray(value)
    ) {
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

const bodyMarkers = [
  'cf-chl-',
  'challenge-platform',
  'cf-turnstile',
  'turnstile',
  'g-recaptcha',
  'recaptcha',
  'hcaptcha',
  'h-captcha',
  'checking your browser',
  'verify you are human',
  'just a moment',
];

const locationMarkers = [
  'challenge',
  'captcha',
  'verify',
  'turnstile',
  'recaptcha',
  'hcaptcha',
  '/cdn-cgi/',
];

export function detectManualChallenge({
  statusCode,
  headers,
  body,
}) {
  const location =
    getHeader(
      headers,
      'location',
    )
      ?.toLowerCase()
    ?? '';

  if (
    statusCode >= 300
    && statusCode < 400
    && locationMarkers.some(
      (marker) =>
        location.includes(
          marker,
        ),
    )
  ) {
    return {
      detected: true,
      reason:
        'challenge_redirect',
    };
  }

  const contentType =
    getHeader(
      headers,
      'content-type',
    )
      ?.toLowerCase()
    ?? '';

  const mayContainHtml =
    contentType.includes(
      'text/html',
    )
    || contentType.includes(
      'application/xhtml+xml',
    )
    || !contentType;

  if (
    mayContainHtml
    && body
    && body.length > 0
  ) {
    const text =
      body
        .subarray(
          0,
          250_000,
        )
        .toString('utf8')
        .toLowerCase();

    if (
      bodyMarkers.some(
        (marker) =>
          text.includes(
            marker,
          ),
      )
    ) {
      return {
        detected: true,
        reason:
          'challenge_html',
      };
    }
  }

  return {
    detected: false,
    reason: null,
  };
}