// Web vs Capacitor-native dışa aktarma seçimi. web.ts main.js'in eski
// Blob+<a download> davranışını birebir korur; native.ts Capacitor
// Filesystem+Share ile iOS/Android'de "Kaydet/Paylaş" akışını sağlar.
import { Capacitor } from '@capacitor/core';
import * as web from './web';
import * as native from './native';

export interface ExportResult {
  ok: boolean;
  method: 'download' | 'share';
}

export const exportPdf: (bytes: Uint8Array<ArrayBuffer>, suggestedName: string) => Promise<ExportResult> =
  Capacitor.isNativePlatform() ? native.exportPdf : web.exportPdf;
