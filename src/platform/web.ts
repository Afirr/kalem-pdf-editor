// main.js'in eski download()'ındaki Blob + <a download> mantığının birebir
// taşınmış hâli — davranış değişmez.
import type { ExportResult } from './index';

export async function exportPdf(bytes: Uint8Array<ArrayBuffer>, suggestedName: string): Promise<ExportResult> {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { ok: true, method: 'download' };
}
