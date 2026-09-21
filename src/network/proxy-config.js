import {
  existsSync,
  readFileSync,
} from 'node:fs';

import {
  isIP,
} from 'node:net';

import {
  z,
} from 'zod';

import {
  ProxyConfigurationError,
} from '../core/errors.js';

const optionalTextSchema = z.preprocess(
  (value) => {
    if (
      typeof value === 'string'
      && value.trim() === ''
    ) {
      return undefined;
    }

    return value;
  },
  z.string().trim().min(1).optional(),
);

const proxySchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'Proxy id contains unsupported characters.',
    ),

  ip: z
    .string()
    .trim()
    .refine(
      (value) => isIP(value) !== 0,
      'Proxy IP must be a valid IPv4 or IPv6 address.',
    ),

  port: z
    .number()
    .int()
    .min(1)
    .max(65535),

  protocol: z
    .enum([
      'http',
      'https',
    ])
    .default('http'),

  enabled: z
    .boolean()
    .default(true),

  username: optionalTextSchema,
  password: optionalTextSchema,
  label: optionalTextSchema,
});

const proxyDocumentSchema = z
  .object({
    version: z.literal(1),
    proxies: z.array(proxySchema),
  })
  .superRefine((value, context) => {
    const ids = new Set();
    const endpoints = new Set();

    value.proxies.forEach((proxy, index) => {
      if (ids.has(proxy.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            'proxies',
            index,
            'id',
          ],
          message: `Duplicate proxy id: ${proxy.id}`,
        });
      }

      ids.add(proxy.id);

      const endpointKey =
        `${proxy.ip}:${proxy.port}`;

      if (endpoints.has(endpointKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            'proxies',
            index,
          ],
          message:
            `Duplicate proxy endpoint: ${endpointKey}`,
        });
      }

      endpoints.add(endpointKey);

      const hasUsername =
        typeof proxy.username === 'string';

      const hasPassword =
        typeof proxy.password === 'string';

      if (hasUsername !== hasPassword) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            'proxies',
            index,
          ],
          message:
            'Proxy username and password must either both be set or both be omitted.',
        });
      }
    });
  });

export function validateProxyConfig(value) {
  const result =
    proxyDocumentSchema.safeParse(value);

  if (!result.success) {
    throw new ProxyConfigurationError(
      'Proxy configuration is invalid.',
      {
        details: result.error.issues.map(
          (issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }),
        ),
      },
    );
  }

  return result.data;
}

export function loadProxyConfig({
  filePath,
  required = false,
} = {}) {
  if (!filePath) {
    throw new ProxyConfigurationError(
      'Proxy configuration file path is required.',
    );
  }

  if (!existsSync(filePath)) {
    if (required) {
      throw new ProxyConfigurationError(
        'Proxy configuration file does not exist.',
      );
    }

    return {
      sourceExists: false,
      proxies: [],
    };
  }

  let raw;

  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ProxyConfigurationError(
      'Unable to read proxy configuration file.',
      {
        cause: error,
      },
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProxyConfigurationError(
      'Proxy configuration contains invalid JSON.',
      {
        cause: error,
      },
    );
  }

  const validated =
    validateProxyConfig(parsed);

  return {
    sourceExists: true,
    proxies: validated.proxies,
  };
}