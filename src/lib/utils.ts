import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00.000';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');
  const msStr = ms.toString().padStart(3, '0');

  if (h > 0) {
    const hStr = h.toString().padStart(2, '0');
    return `${hStr}:${mStr}:${sStr}.${msStr}`;
  }
  return `${mStr}:${sStr}.${msStr}`;
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateVTT(subtitles: any[]): string {
  let vtt = 'WEBVTT\n\n';
  subtitles.forEach((sub, index) => {
    vtt += `${index + 1}\n`;
    vtt += `${formatTimeForVTT(sub.start)} --> ${formatTimeForVTT(sub.end)}\n`;
    vtt += `${sub.text}\n\n`;
  });
  return vtt;
}

export function generateSRT(subtitles: any[]): string {
  let srt = '';
  subtitles.forEach((sub, index) => {
    srt += `${index + 1}\n`;
    srt += `${formatTimeForSRT(sub.start)} --> ${formatTimeForSRT(sub.end)}\n`;
    srt += `${sub.text}\n\n`;
  });
  return srt;
}

function formatTimeForVTT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatTimeForSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
