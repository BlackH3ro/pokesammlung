import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { BackupData } from './collection';

const stamp = () => new Date().toISOString().slice(0, 10);

// Saves text as a file and opens the share sheet (Files, AirDrop, Mail …). On web it downloads.
export async function shareText(filename: string, text: string, mimeType: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
}

export function exportBackup(data: BackupData) {
  return shareText(`pokesammlung-backup-${stamp()}.json`, JSON.stringify(data), 'application/json');
}

// Lets the user pick a backup file; returns null if cancelled. Throws on a file that isn't a backup.
export async function pickBackup(): Promise<BackupData | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const text = Platform.OS === 'web' ? await (await fetch(asset.uri)).text() : await new File(asset.uri).text();
  const data = JSON.parse(text);
  if (data?.app !== 'pokesammlung' || typeof data.owned !== 'object') throw new Error('Das ist keine Pokésammlung-Sicherung.');
  return data as BackupData;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Semicolon-separated so Excel with German settings opens it directly.
export function toCsv(rows: (string | number)[][]) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n');
}

export { stamp };
