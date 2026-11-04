import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

// Native camera that reads text live from the video and compares the card picture with all cards
// (modules/text-recognizer/ios/CardScannerView.swift).
// Missing on the web; the scanner then falls back to taking photos.

export type ImageHit = { id: string; score: number };
// `zoom`: the camera's zoom right now; `asianPass`: this frame was read as Japanese.
export type LiveTextEvent = NativeSyntheticEvent<{ text: string; image?: ImageHit[]; ms: number; zoom?: number; asianPass?: boolean }>;
// zoom 0 = automatic; shift −1 … 1 moves the visible part of the picture up / down.
type Props = ViewProps & { active?: boolean; torch?: boolean; zoom?: number; shift?: number; onText?: (e: LiveTextEvent) => void };

export const LiveCamera: ComponentType<Props> | null = requireOptionalNativeModule('CardScanner')
  ? requireNativeView<Props>('CardScanner')
  : null;
