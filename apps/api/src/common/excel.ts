import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface ExcelColumn<T> {
  header: string;
  key: string;
  width?: number;
  /** money: 숫자 셀 + #,##0 / rate: 0.0% / date: 날짜 셀 / text */
  type?: 'money' | 'rate' | 'date' | 'text' | 'int';
  value: (row: T) => unknown;
}

/**
 * 실제 숫자·날짜 셀로 저장되는 엑셀 생성. 금액 열은 하단에 SUM 수식 합계행을 넣는다.
 */
export async function buildExcel<T>(opts: { sheet: string; title: string; subtitle?: string; columns: ExcelColumn<T>[]; rows: T[] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SS-ERP';
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheet, { views: [{ state: 'frozen', ySplit: 3 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });

  ws.mergeCells(1, 1, 1, opts.columns.length);
  ws.getCell(1, 1).value = opts.title;
  ws.getCell(1, 1).font = { size: 14, bold: true };
  ws.mergeCells(2, 1, 2, opts.columns.length);
  ws.getCell(2, 1).value = opts.subtitle ?? `출력일시 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
  ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF5B6573' } };

  const header = ws.getRow(3);
  opts.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B4C6F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getColumn(i + 1).width = c.width ?? 14;
  });
  header.height = 20;

  opts.rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    opts.columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = c.value(r);
      if (v === null || v === undefined || v === '') return;
      switch (c.type) {
        case 'money':
          cell.value = Number(v);
          cell.numFmt = '#,##0;[Red]△#,##0';
          break;
        case 'int':
          cell.value = Number(v);
          cell.numFmt = '#,##0';
          break;
        case 'rate':
          cell.value = Number(v);
          cell.numFmt = '0.0%';
          break;
        case 'date':
          cell.value = new Date(String(v) + 'T00:00:00Z');
          cell.numFmt = 'yyyy-mm-dd';
          break;
        default:
          cell.value = String(v);
      }
    });
  });

  const last = 3 + opts.rows.length;
  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(1).value = `합계 (${opts.rows.length}건)`;
  totalRow.font = { bold: true };
  opts.columns.forEach((c, ci) => {
    if (c.type === 'money' && opts.rows.length) {
      const col = ws.getColumn(ci + 1).letter;
      const cell = totalRow.getCell(ci + 1);
      cell.value = { formula: `SUM(${col}4:${col}${last})` } as ExcelJS.CellFormulaValue;
      cell.numFmt = '#,##0;[Red]△#,##0';
    }
    totalRow.getCell(ci + 1).border = { top: { style: 'double' } };
  });
  return wb;
}

export async function sendExcel(res: Response, wb: ExcelJS.Workbook, filename: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  const buf = await wb.xlsx.writeBuffer();
  res.end(Buffer.from(buf));
}
