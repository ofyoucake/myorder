import { OrderServerError } from './orderAuth.js';

const invalid = () => { throw new OrderServerError('SERVICE_UNAVAILABLE'); };
const present = value => value !== undefined && value !== null && String(value).length > 0;
const ERROR_TOKENS = {
  ERROR: '#ERROR!', NULL_VALUE: '#NULL!', DIVIDE_BY_ZERO: '#DIV/0!', VALUE: '#VALUE!',
  REF: '#REF!', NAME: '#NAME?', NUM: '#NUM!', N_A: '#N/A',
};

// GridData uses absolute origins and may omit empty cells and trailing rows.
export function decodeOrderGrid(sheet, { startRow, endRow, requireAnchor = false }) {
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow)
    || startRow < 0 || endRow <= startRow || endRow > 20000 || !Array.isArray(sheet?.data)) invalid();
  const values = Array.from({ length: endRow - startRow }, () => Array(13).fill(''));
  const occupiedRows = new Set();
  const seen = new Set();
  if (requireAnchor && !sheet.data.some(block => (block.startRow ?? 0) === startRow && (block.startColumn ?? 0) === 0)) invalid();
  for (const block of sheet.data) {
    const originRow = block.startRow ?? 0;
    const originColumn = block.startColumn ?? 0;
    const rows = block.rowData ?? [];
    if (!Number.isSafeInteger(originRow) || !Number.isSafeInteger(originColumn)
      || originRow < startRow || originRow >= endRow || originColumn < 0 || originColumn >= 13
      || !Array.isArray(rows) || originRow + rows.length > endRow) invalid();
    rows.forEach((row, offset) => {
      const cells = row.values ?? [];
      if (!Array.isArray(cells) || originColumn + cells.length > 13) invalid();
      cells.forEach((cell, columnOffset) => {
        if (!cell || typeof cell !== 'object' || Array.isArray(cell)) invalid();
        const rowIndex = originRow + offset;
        const column = originColumn + columnOffset;
        const key = `${rowIndex}:${column}`;
        if (seen.has(key)) invalid();
        seen.add(key);
        const effective = cell.effectiveValue;
        const errorToken = effective?.errorValue && ERROR_TOKENS[effective.errorValue.type];
        if (effective?.errorValue && !errorToken) invalid();
        values[rowIndex - startRow][column] = effective?.stringValue ?? effective?.numberValue
          ?? effective?.boolValue ?? errorToken ?? '';
        if (column < 12 && (present(values[rowIndex - startRow][column])
          || Object.values(cell.userEnteredValue ?? {}).some(present))) occupiedRows.add(rowIndex);
      });
    });
  }
  return { values, occupiedRows };
}
