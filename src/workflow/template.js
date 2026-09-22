import {
  WorkflowTemplateError,
} from '../core/errors.js';

const allowedRoots =
  new Set([
    'input',
    'job',
    'allocation',
    'session',
    'runtime',
    'responses',
    'otp',
  ]);

const forbiddenSegments =
  new Set([
    '__proto__',
    'prototype',
    'constructor',
  ]);

const templatePathPattern =
  '[A-Za-z_][A-Za-z0-9_-]*(?:\\.[A-Za-z_][A-Za-z0-9_-]*)*';

const exactTemplatePattern =
  new RegExp(
    `^\\{\\{\\s*(${templatePathPattern})\\s*\\}\\}$`,
  );

const embeddedTemplatePattern =
  new RegExp(
    `\\{\\{\\s*(${templatePathPattern})\\s*\\}\\}`,
    'g',
  );

function resolvePath(
  context,
  path,
) {
  const segments =
    path.split('.');

  const root =
    segments[0];

  if (
    !allowedRoots.has(
      root,
    )
  ) {
    throw new WorkflowTemplateError(
      `Template root is not allowed: ${root}`,
    );
  }

  let current =
    context;

  for (
    const segment
    of segments
  ) {
    if (
      forbiddenSegments.has(
        segment,
      )
    ) {
      throw new WorkflowTemplateError(
        'Template contains an unsafe property path.',
      );
    }

    if (
      current === null
      || current === undefined
      || (
        typeof current !== 'object'
        && typeof current
          !== 'function'
      )
      || !Object.prototype
        .hasOwnProperty.call(
          current,
          segment,
        )
    ) {
      throw new WorkflowTemplateError(
        `Template value is missing: ${path}`,
      );
    }

    current =
      current[segment];
  }

  if (
    typeof current === 'function'
    || typeof current === 'symbol'
  ) {
    throw new WorkflowTemplateError(
      `Template value has an unsupported type: ${path}`,
    );
  }

  return current;
}

function renderString(
  value,
  context,
) {
  const exactMatch =
    value.match(
      exactTemplatePattern,
    );

  if (exactMatch) {
    return resolvePath(
      context,
      exactMatch[1],
    );
  }

  return value.replace(
    embeddedTemplatePattern,
    (
      match,
      path,
    ) => {
      void match;

      const resolved =
        resolvePath(
          context,
          path,
        );

      if (
        resolved === null
        || resolved === undefined
        || typeof resolved
          === 'object'
      ) {
        throw new WorkflowTemplateError(
          `Embedded template must resolve to a scalar value: ${path}`,
        );
      }

      return String(
        resolved,
      );
    },
  );
}

function renderValue(
  value,
  context,
  state,
  depth,
) {
  if (
    depth > 32
  ) {
    throw new WorkflowTemplateError(
      'Workflow template nesting exceeded the safety limit.',
    );
  }

  state.nodes += 1;

  if (
    state.nodes > 10_000
  ) {
    throw new WorkflowTemplateError(
      'Workflow template exceeded the safety node limit.',
    );
  }

  if (
    typeof value === 'string'
  ) {
    return renderString(
      value,
      context,
    );
  }

  if (
    value === null
    || typeof value
      === 'number'
    || typeof value
      === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value
      === 'function'
    || typeof value
      === 'symbol'
    || typeof value
      === 'bigint'
    || value === undefined
  ) {
    throw new WorkflowTemplateError(
      'Workflow template contains an unsupported value type.',
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      (item) =>
        renderValue(
          item,
          context,
          state,
          depth + 1,
        ),
    );
  }

  if (
    typeof value === 'object'
  ) {
    if (
      state.seen.has(
        value,
      )
    ) {
      throw new WorkflowTemplateError(
        'Workflow template contains a circular structure.',
      );
    }

    state.seen.add(
      value,
    );

    const output = {};

    for (
      const [
        key,
        child,
      ]
      of Object.entries(
        value,
      )
    ) {
      if (
        forbiddenSegments.has(
          key,
        )
      ) {
        throw new WorkflowTemplateError(
          'Workflow template object contains an unsafe key.',
        );
      }

      output[key] =
        renderValue(
          child,
          context,
          state,
          depth + 1,
        );
    }

    state.seen.delete(
      value,
    );

    return output;
  }

  throw new WorkflowTemplateError(
    'Workflow template contains an unsupported value.',
  );
}

export function renderTemplate(
  value,
  context,
) {
  return renderValue(
    value,
    context,
    {
      nodes:
        0,

      seen:
        new WeakSet(),
    },
    0,
  );
}