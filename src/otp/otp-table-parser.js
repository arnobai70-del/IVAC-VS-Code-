import {
  createHash,
} from 'node:crypto';

import {
  load,
} from 'cheerio';

import {
  OtpResponseError,
} from '../core/errors.js';

function normalizeWhitespace(value) {
  return String(
    value ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value) {
  return normalizeWhitespace(
    value,
  ).toLowerCase();
}

export function normalizePhoneNumber(
  value,
) {
  const raw =
    normalizeWhitespace(
      value,
    );

  if (!raw) {
    return null;
  }

  const digits =
    raw.replace(
      /\D/g,
      '',
    );

  if (!digits) {
    return null;
  }

  /*
   * Normalize common Bangladesh representations:
   *
   * +88017XXXXXXXX
   * 88017XXXXXXXX
   * 017XXXXXXXX
   * 17XXXXXXXX
   *
   * Unusual values are retained as digits so matching
   * remains exact rather than guessing.
   */
  if (
    digits.length === 13
    && digits.startsWith('8801')
  ) {
    return `0${digits.slice(3)}`;
  }

  if (
    digits.length === 10
    && digits.startsWith('1')
  ) {
    return `0${digits}`;
  }

  return digits;
}

function createFingerprint({
  phone,
  code,
  createdAt,
}) {
  return createHash(
    'sha256',
  )
    .update(
      [
        phone ?? '',
        code ?? '',
        createdAt ?? '',
      ].join('\u0000'),
    )
    .digest('hex');
}

function getCellTexts(
  $,
  row,
) {
  return $(row)
    .children(
      'th, td',
    )
    .map(
      (
        index,
        element,
      ) => {
        void index;

        return normalizeWhitespace(
          $(element).text(),
        );
      },
    )
    .get();
}

function findColumnIndexes(
  headerTexts,
  columns,
) {
  const normalized =
    headerTexts.map(
      normalizeHeader,
    );

  const phoneIndex =
    normalized.indexOf(
      normalizeHeader(
        columns.phone,
      ),
    );

  const codeIndex =
    normalized.indexOf(
      normalizeHeader(
        columns.code,
      ),
    );

  const createdAtIndex =
    normalized.indexOf(
      normalizeHeader(
        columns.createdAt,
      ),
    );

  if (
    phoneIndex === -1
    || codeIndex === -1
    || createdAtIndex === -1
  ) {
    return null;
  }

  return {
    phoneIndex,
    codeIndex,
    createdAtIndex,
  };
}

export class OtpTableParser {
  constructor({
    tableSelector,
    columns,
    maxRows,
  }) {
    this.tableSelector =
      tableSelector;

    this.columns =
      columns;

    this.maxRows =
      maxRows;
  }

  parse(html) {
    if (
      typeof html !== 'string'
    ) {
      throw new TypeError(
        'OTP table HTML must be a string.',
      );
    }

    const $ =
      load(html);

    const tables =
      $(this.tableSelector)
        .toArray();

    let selectedTable =
      null;

    let selectedRows =
      null;

    let columnIndexes =
      null;

    let headerRowIndex =
      -1;

    for (const table of tables) {
      const rows =
        $(table)
          .find('tr')
          .toArray();

      for (
        let index = 0;
        index < rows.length;
        index += 1
      ) {
        const headerTexts =
          getCellTexts(
            $,
            rows[index],
          );

        const indexes =
          findColumnIndexes(
            headerTexts,
            this.columns,
          );

        if (!indexes) {
          continue;
        }

        selectedTable =
          table;

        selectedRows =
          rows;

        columnIndexes =
          indexes;

        headerRowIndex =
          index;

        break;
      }

      if (selectedTable) {
        break;
      }
    }

    if (
      !selectedTable
      || !selectedRows
      || !columnIndexes
    ) {
      throw new OtpResponseError(
        'Expected OTP table columns were not found.',
      );
    }

    const records = [];

    for (
      let index =
        headerRowIndex + 1;

      index <
        selectedRows.length;

      index += 1
    ) {
      const cells =
        getCellTexts(
          $,
          selectedRows[index],
        );

      if (
        cells.length === 0
      ) {
        continue;
      }

      const rawPhone =
        cells[
          columnIndexes
            .phoneIndex
        ]
        ?? '';

      const rawCode =
        cells[
          columnIndexes
            .codeIndex
        ]
        ?? '';

      const rawCreatedAt =
        cells[
          columnIndexes
            .createdAtIndex
        ]
        ?? '';

      const phone =
        normalizePhoneNumber(
          rawPhone,
        );

      const code =
        normalizeWhitespace(
          rawCode,
        );

      const createdAt =
        normalizeWhitespace(
          rawCreatedAt,
        );

      if (!phone) {
        continue;
      }

      if (
        code.length > 128
      ) {
        throw new OtpResponseError(
          'OTP table contained an unexpectedly long OTP value.',
        );
      }

      const record = {
        phone,
        code:
          code || null,
        createdAt:
          createdAt || null,
      };

      records.push({
        ...record,

        fingerprint:
          createFingerprint(
            record,
          ),
      });

      if (
        records.length
        > this.maxRows
      ) {
        throw new OtpResponseError(
          'OTP table exceeded the configured row limit.',
        );
      }
    }

    return records;
  }
}