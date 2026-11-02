import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

// Native camera that reads text live from the video (modules/text-recognizer/ios/CardScannerView.swift).
// Missing on the web; the scanner then falls back to taking photos.

export type LiveTextEvent = NativeSyntheticEvent<{ text: string; ms: number }>;
type Props = ViewProps & { active?: boolean; torch?: boolean; onText?: (e: LiveTextEvent) => void };

export const LiveCamera: ComponentType<Props> | null = requireOptionalNativeModule('CardScanner')
  ? requireNativeView<Props>('CardScanner')
  : null;
