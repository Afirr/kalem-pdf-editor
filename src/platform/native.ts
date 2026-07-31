import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ExportResult } from './index';

// 32KB'lık parçalar hâlinde: String.fromCharCode(...bytes) tek seferde büyük
// PDF'lerde argüman limitini (~65536) aşıp "Maximum call stack size exceeded"
// hatası verir.
function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function exportPdf(bytes: Uint8Array<ArrayBuffer>, suggestedName: string): Promise<ExportResult> {
  const written = await Filesystem.writeFile({
    path: suggestedName,
    data: toBase64(bytes),
    directory: Directory.Cache,
  });
  await Share.share({
    title: suggestedName,
    url: written.uri,
    dialogTitle: "PDF'i paylaş / kaydet",
  });
  return { ok: true, method: 'share' };
}
