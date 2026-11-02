/**
 * Pure formatting utilities for durations (HH:MM:SS) and UTC ISO 8601 dates.
 */

export function formatDurationHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}

export function formatDurationHuman(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}ч ${minutes}м ${seconds}с`;
  }
  if (minutes > 0) {
    return `${minutes}м ${seconds}с`;
  }
  return `${seconds}с`;
}

export function formatIsoShort(isoStr: string | null): string {
  if (!isoStr) return '—';
  // Formats 2026-11-02T08:00:00.000Z -> 2026-11-02 08:00:00 UTC
  return `${isoStr.slice(0, 10)} ${isoStr.slice(11, 19)} UTC`;
}

export function getTodayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDaysOffsetUtcDate(daysOffset: number): string {
  const d = new Date(Date.now() + daysOffset * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
