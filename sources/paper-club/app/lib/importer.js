// Importing one paper into a chat's folder: who it is (lookup.js), its PDF fetched and uploaded, and its notes file made
// beside it with what was found. The one way to import, for the page (the shelf, on a desktop or a phone) and for the
// program (an agent's `import`): they differ only in how they fetch, upload and create — `io`.
import { lookup } from './lookup.js'
import { emptyNotes, fileNameOf, folderOf, notesNameOf } from './paper.js'

export class ImportError extends Error {
  constructor(code, message, meta = null) {
    super(message)
    this.code = code
    this.meta = meta
  }
}

/**
 * `io`: { fetch(url) → Response, upload(file: File) → entry, create(name, folder, data) → entry,
 *         existing(meta) → { entry, notes } | null (the chat has this paper already) }.
 * Resolves `{ pdf, notes, meta, existed }`.
 */
export async function importPaper(ref, io) {
  const { meta, pdfUrl, tried } = await lookup(ref, io.fetch)
  const already = await io.existing(meta)
  if (already) return { ...already, meta, existed: true }
  if (!pdfUrl) throw new ImportError('no-pdf', `No PDF to download for ${meta.title || JSON.stringify(ref)}${tried.length ? ` (${tried.join('; ')})` : ''}`, meta)
  const response = await io.fetch(pdfUrl)
  if (!response.ok) throw new ImportError('fetch', `The PDF at ${pdfUrl} answered HTTP ${response.status}`, meta)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // A landing page in the PDF's place (a paywall, a captcha) is not a paper.
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new ImportError('not-pdf', `${pdfUrl} did not answer with a PDF`, meta)
  const pdf = await io.upload(new File([bytes], fileNameOf(meta, ref), { type: 'application/pdf' }))
  const notes = await io.create(notesNameOf(pdf.name), folderOf(pdf), emptyNotes(pdf.id, meta))
  return { pdf, notes, meta, existed: false }
}

// A chat's folder is a `folder` beside the name; a folder on this computer (a project's, a session's working copy) has
// none: there the path is the file's name.
/** Where `files.create` makes `name` in `folder` of `place`. */
export const placed = (place, folder, name) => (place.chat ? { ...place, name, ...(folder ? { folder } : {}) } : { ...place, name: folder ? `${folder}/${name}` : name })
/** What `files.upload` takes to put `file` in `folder` of `place`. */
export const into = (place, folder, file) =>
  place.chat ? [{ ...place, folder }, file] : [place, new File([file], `${folder}/${file.name}`, { type: file.type })]

/** The chat's notes files whose paper is this one (same arXiv id or DOI). */
export function sameWork(a, b) {
  if (!a || !b) return false
  if (a.arxiv && b.arxiv) return a.arxiv.replace(/v\d+$/, '') === b.arxiv.replace(/v\d+$/, '')
  if (a.doi && b.doi) return a.doi.toLowerCase() === b.doi.toLowerCase()
  return false
}
