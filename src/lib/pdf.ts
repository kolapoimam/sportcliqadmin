import { jsPDF } from 'jspdf'
import regularUrl from '@/assets/fonts/PlusJakartaSans_400Regular.ttf?url'
import boldUrl from '@/assets/fonts/PlusJakartaSans_700Bold.ttf?url'

async function toBase64(url: string) {
  const buf = await (await fetch(url)).arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** A jsPDF document with Plus Jakarta Sans loaded (falls back to Helvetica if the font fails to load). */
export async function createPdf() {
  const doc = new jsPDF()
  try {
    const [regular, bold] = await Promise.all([toBase64(regularUrl), toBase64(boldUrl)])
    doc.addFileToVFS('PlusJakartaSans-Regular.ttf', regular)
    doc.addFont('PlusJakartaSans-Regular.ttf', 'PlusJakartaSans', 'normal')
    doc.addFileToVFS('PlusJakartaSans-Bold.ttf', bold)
    doc.addFont('PlusJakartaSans-Bold.ttf', 'PlusJakartaSans', 'bold')
    doc.setFont('PlusJakartaSans', 'normal')
  } catch (e) {
    console.error('Could not load PDF font, using default', e)
  }
  return doc
}

/** Writes lines with 10px spacing, adding pages as needed. */
export function pdfWriter(doc: jsPDF) {
  let y = 20
  const font = doc.getFont().fontName
  const line = (text: string, opts: { bold?: boolean; size?: number; indent?: number } = {}) => {
    if (y > 280) {
      doc.addPage()
      y = 20
    }
    doc.setFont(font, opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size ?? 11)
    doc.text(text, 15 + (opts.indent ?? 0), y)
    y += 10
  }
  const gap = () => (y += 4)
  return { line, gap }
}
