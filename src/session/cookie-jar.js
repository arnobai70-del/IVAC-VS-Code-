function normalizeDomain(hostname) {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
}

function domainMatches(
  hostname,
  cookieDomain,
) {
  const host =
    hostname.toLowerCase();

  const domain =
    cookieDomain.toLowerCase();

  return (
    host === domain
    || host.endsWith(`.${domain}`)
  );
}

function pathMatches(
  requestPath,
  cookiePath,
) {
  if (requestPath === cookiePath) {
    return true;
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }

  if (cookiePath.endsWith('/')) {
    return true;
  }

  return (
    requestPath[cookiePath.length]
    === '/'
  );
}

function defaultCookiePath(pathname) {
  if (
    !pathname
    || !pathname.startsWith('/')
    || pathname === '/'
  ) {
    return '/';
  }

  const lastSlash =
    pathname.lastIndexOf('/');

  if (lastSlash <= 0) {
    return '/';
  }

  return pathname.slice(
    0,
    lastSlash,
  );
}

function parseSetCookie(
  rawCookie,
  requestUrl,
) {
  const url =
    new URL(requestUrl);

  const parts =
    rawCookie
      .split(';')
      .map((part) => part.trim());

  const first =
    parts.shift();

  if (!first) {
    return null;
  }

  const separator =
    first.indexOf('=');

  if (separator <= 0) {
    return null;
  }

  const name =
    first
      .slice(0, separator)
      .trim();

  const value =
    first
      .slice(separator + 1)
      .trim();

  if (!name) {
    return null;
  }

  const cookie = {
    name,
    value,

    domain:
      normalizeDomain(
        url.hostname,
      ),

    hostOnly: true,

    path:
      defaultCookiePath(
        url.pathname,
      ),

    secure: false,
    httpOnly: false,
    sameSite: null,
    expiresAt: null,
  };

  for (const attribute of parts) {
    const attributeSeparator =
      attribute.indexOf('=');

    const rawName =
      attributeSeparator === -1
        ? attribute
        : attribute.slice(
            0,
            attributeSeparator,
          );

    const rawValue =
      attributeSeparator === -1
        ? ''
        : attribute.slice(
            attributeSeparator + 1,
          );

    const attributeName =
      rawName
        .trim()
        .toLowerCase();

    const attributeValue =
      rawValue.trim();

    switch (attributeName) {
      case 'domain': {
        if (!attributeValue) {
          break;
        }

        const domain =
          normalizeDomain(
            attributeValue,
          );

        if (
          !domainMatches(
            url.hostname,
            domain,
          )
        ) {
          return null;
        }

        cookie.domain = domain;
        cookie.hostOnly = false;
        break;
      }

      case 'path': {
        cookie.path =
          attributeValue.startsWith('/')
            ? attributeValue
            : '/';

        break;
      }

      case 'secure':
        cookie.secure = true;
        break;

      case 'httponly':
        cookie.httpOnly = true;
        break;

      case 'samesite':
        cookie.sameSite =
          attributeValue || null;
        break;

      case 'max-age': {
        const seconds =
          Number.parseInt(
            attributeValue,
            10,
          );

        if (Number.isFinite(seconds)) {
          cookie.expiresAt =
            Date.now()
            + seconds * 1000;
        }

        break;
      }

      case 'expires': {
        if (
          cookie.expiresAt !== null
        ) {
          break;
        }

        const expiresAt =
          Date.parse(
            attributeValue,
          );

        if (
          Number.isFinite(expiresAt)
        ) {
          cookie.expiresAt =
            expiresAt;
        }

        break;
      }

      default:
        break;
    }
  }

  return cookie;
}

export class CookieJar {
  constructor() {
    this.cookies =
      new Map();
  }

  get size() {
    this.removeExpired();

    return this.cookies.size;
  }

  makeKey(cookie) {
    return [
      cookie.domain,
      cookie.path,
      cookie.name,
    ].join('|');
  }

  removeExpired() {
    const now =
      Date.now();

    for (
      const [key, cookie]
      of this.cookies.entries()
    ) {
      if (
        cookie.expiresAt !== null
        && cookie.expiresAt <= now
      ) {
        this.cookies.delete(key);
      }
    }
  }

  setCookie(
    rawCookie,
    requestUrl,
  ) {
    const cookie =
      parseSetCookie(
        rawCookie,
        requestUrl,
      );

    if (!cookie) {
      return false;
    }

    const key =
      this.makeKey(cookie);

    if (
      cookie.expiresAt !== null
      && cookie.expiresAt <= Date.now()
    ) {
      this.cookies.delete(key);

      return true;
    }

    this.cookies.set(
      key,
      cookie,
    );

    return true;
  }

  setCookies(
    rawCookies,
    requestUrl,
  ) {
    for (const rawCookie of rawCookies) {
      this.setCookie(
        rawCookie,
        requestUrl,
      );
    }
  }

  getCookieHeader(requestUrl) {
    this.removeExpired();

    const url =
      new URL(requestUrl);

    const isSecure =
      url.protocol === 'https:';

    const matches = [];

    for (
      const cookie
      of this.cookies.values()
    ) {
      if (
        cookie.secure
        && !isSecure
      ) {
        continue;
      }

      if (
        cookie.hostOnly
        && url.hostname.toLowerCase()
          !== cookie.domain
      ) {
        continue;
      }

      if (
        !cookie.hostOnly
        && !domainMatches(
          url.hostname,
          cookie.domain,
        )
      ) {
        continue;
      }

      if (
        !pathMatches(
          url.pathname || '/',
          cookie.path,
        )
      ) {
        continue;
      }

      matches.push(cookie);
    }

    matches.sort(
      (left, right) =>
        right.path.length
        - left.path.length,
    );

    if (matches.length === 0) {
      return null;
    }

    return matches
      .map(
        (cookie) =>
          `${cookie.name}=${cookie.value}`,
      )
      .join('; ');
  }

  clear() {
    this.cookies.clear();
  }
}