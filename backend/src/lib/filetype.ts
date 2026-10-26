import path from 'node:path'

export interface Detected { mime: string; ext: string }

/**
 * Content-based file type detection (magic bytes). The client-supplied MIME type and extension are NOT trusted.
 * SVG and HTML are deliberately not allowed (script execution risk).
 */
export function detectFileType(buf: Buffer, originalName: string): Detected | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b)
  if (startsWith(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: '.jpg' }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', ext: '.png' }
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') return { mime: 'image/gif', ext: '.gif' }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: '.webp' }
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' }
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    const ext = path.extname(originalName).toLowerCase()
    const office: Record<string, string> = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    if (office[ext]) return { mime: office[ext], ext }
  }
  return null
}

export const INLINE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'])

export function safeDownloadName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'
}
