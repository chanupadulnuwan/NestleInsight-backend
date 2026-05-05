type CsvCell = string | number | boolean | Date | null | undefined;

export type CsvColumn<T extends Record<string, unknown>> = {
  key: keyof T | string;
  header: string;
  value?: (row: T) => CsvCell;
};

function normalizeCsvCell(value: CsvCell) {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

function escapeCsvCell(value: CsvCell) {
  const normalized = normalizeCsvCell(value);

  if (
    normalized.includes(',') ||
    normalized.includes('"') ||
    normalized.includes('\n') ||
    normalized.includes('\r')
  ) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
) {
  const headerLine = columns.map((column) => escapeCsvCell(column.header)).join(',');
  const dataLines = rows.map((row) =>
    columns
      .map((column) => {
        const value = column.value
          ? column.value(row)
          : (row[column.key as keyof T] as CsvCell);
        return escapeCsvCell(value);
      })
      .join(','),
  );

  return [headerLine, ...dataLines].join('\r\n');
}
