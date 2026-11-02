import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

// Native camera that reads text live from the video and compares the card picture with all cards
// (modules/text-recognizer/ios/CardScannerView.swift).
// Missing on the web; the scanner then falls back to taking photos.

export type ImageHit = { id: string; score: number };
export type LiveTextEvent = NativeSyntheticEvent<{ text: string; image?: ImageHit[]; ms: number }>;
type Props = ViewProps & { active?: boolean; torch?: boolean; onText?: (e: LiveTextEvent) => void };

export const LiveCamera: ComponentType<Props> | null = requireOptionalNativeModule('CardScanner')
  ? requireNativeView<Props>('CardScanner')
  : null;
