// What a paper's notes are, shared by the pages and the program (tools.js): plain functions, no window, no gugu.
//
// A paper is a PDF in a chat's folder (or a session's working copy) plus its notes file beside it,
// `<name>.paper.json`, made the first time someone marks it (or when it is imported). The notes file is a live JSON
// file everyone in the chat edits at once; every collection is a map keyed by id, so two people adding at the same
// moment never overwrite each other (guide apps-files).
//
//   { version: 1, pdf: <the PDF's entry id>, meta: { title, authors, year, venue, arxiv, doi, url, abstract },
//     highlights: { <id>: { page, rects: [[x, y, w, h], …], quote, color, by, at } },
//     comments:   { <id>: { on: <highlight id> | null, by, text, at } },
//     cards:      { <id>: { front, back, on: <highlight id> | null, by, at } } }
//
// `page` counts from 1; rects are fractions of the page box (0..1), so they draw at any zoom; `by` is user:<uuid>.

export const VERSION = 1
export const NOTES_SUFFIX = '.paper.json'
export const COLORS = ['yellow', 'green', 'blue', 'pink']
/** Where imported papers go in a chat's folder. */
export const PAPERS_FOLDER = '论文'

/**
 * The notes file's name for a PDF's name: 「a/b/Attention.pdf」 → 「Attention · 笔记.paper.json」, in the same folder. The
 * folder shows names without the suffix an App claims, so the PDF and its notes would read the same without 「· 笔记」.
 * One name in every language: the page and the program find the notes by it.
 */
export function notesNameOf(pdfName) {
  const base = String(pdfName).split('/').pop()
  return `${base.replace(/\.pdf$/i, '')} · 笔记${NOTES_SUFFIX}`
}

/** The place a file lives in, as gugu.files names places: a chat, a project's folder on this computer, a session's working copy. */
export const placeOfEntry = (entry) => (entry.chat ? { chat: entry.chat } : entry.project ? { project: entry.project } : { session: entry.session })

/** The folder a file is in, as `files.create` takes it ('' is the top). */
export function folderOf(entry) {
  const path = entry?.path ?? entry?.name ?? ''
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

export function isPdf(entry) {
  return entry?.type !== 'folder' && (/\.pdf$/i.test(entry?.name ?? '') || entry?.contentType === 'application/pdf')
}

export function isNotes(entry) {
  return entry?.type !== 'folder' && (entry?.name ?? '').endsWith(NOTES_SUFFIX)
}

export function emptyNotes(pdfId, meta = {}) {
  return { version: VERSION, pdf: pdfId, meta, highlights: {}, comments: {}, cards: {} }
}

export const newId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) .replace(/-/g, '').slice(0, 12)

/** Whitespace folded and hyphenated line breaks joined, so a quote copied from a PDF finds the text it came from. */
export function fold(text) {
  return String(text).replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Rects of one selection, merged per line: the text layer gives one rect per span, and a line is many spans. Rects
 * whose vertical middles are within half a line of each other and that touch (or nearly) become one.
 */
export function mergeRects(rects) {
  const sorted = rects.filter(([, , w, h]) => w > 0 && h > 0).sort((a, b) => a[1] + a[3] / 2 - (b[1] + b[3] / 2) || a[0] - b[0])
  const out = []
  for (const r of sorted) {
    const last = out.at(-1)
    if (last) {
      const midA = last[1] + last[3] / 2, midB = r[1] + r[3] / 2
      const sameLine = Math.abs(midA - midB) < Math.min(last[3], r[3]) / 2
      const gap = r[0] - (last[0] + last[2])
      if (sameLine && gap < Math.max(last[3], r[3]) * 1.5) {
        const x = Math.min(last[0], r[0]), y = Math.min(last[1], r[1])
        last[2] = Math.max(last[0] + last[2], r[0] + r[2]) - x
        last[3] = Math.max(last[1] + last[3], r[1] + r[3]) - y
        last[0] = x
        last[1] = y
        continue
      }
    }
    out.push([...r])
  }
  return out.map((r) => r.map((v) => Math.round(v * 10000) / 10000))
}

/**
 * Where a quote sits in a page's text items (pdf.js getTextContent), as rects on that page: the items' characters are
 * joined, each remembering its item; the quote's characters give the items, and the
 * part of each item it covers is taken by its share of the item's characters (a font's widths are not known here).
 * `viewport` is the page at scale 1 (page.getViewport({ scale: 1 })). Null when the quote is not on the page.
 */
export function rectsOfQuote(items, viewport, quote) {
  // Compared with every space taken out, both sides: a PDF splits words, subscripts (「d k」 for d_k) and CJK lines
  // into items at will, and a quote copied from it carries spaces that are not in the items, or lacks ones that are.
  const want = fold(quote).replace(/\s+/g, '').toLowerCase()
  if (!want) return null
  let plain = ''
  const joined = [] // per character of `plain`: [item index, char index in item]
  items.forEach((item, i) => {
    const s = item.str ?? ''
    for (let k = 0; k < s.length; k++) {
      if (/\s/.test(s[k])) continue
      // A word broken at a line's end: 「repre-」 + 「sentation」 is searched as 「representation」.
      if (s[k] === '-' && k === s.length - 1 && item.hasEOL) continue
      plain += s[k].toLowerCase()
      joined.push([i, k])
    }
  })
  const at = plain.indexOf(want)
  if (at < 0) return null
  const spans = new Map() // item index → [first char, last char]
  for (let c = at; c < at + want.length; c++) {
    const [i, k] = joined[c]
    const span = spans.get(i)
    if (!span) spans.set(i, [k, k])
    else span[1] = k
  }
  const rects = []
  for (const [i, [from, to]] of spans) {
    const item = items[i]
    const len = Math.max(1, (item.str ?? '').length)
    const [a, b, , , e, f] = item.transform
    const height = item.height || Math.hypot(a, b)
    const x0 = e + (item.width * from) / len
    const x1 = e + (item.width * Math.min(len, to + 1)) / len
    const [l, t, r, btm] = viewport.convertToViewportRectangle([x0, f - height * 0.2, x1, f + height * 0.85])
    const left = Math.min(l, r), top = Math.min(t, btm)
    rects.push([left / viewport.width, top / viewport.height, Math.abs(r - l) / viewport.width, Math.abs(btm - t) / viewport.height])
  }
  return mergeRects(rects)
}

/** An arXiv id, a DOI or a link to either, as `{ arxiv }` / `{ doi }` / `{ url }` (a PDF anywhere else); null when none. */
export function parseRef(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  const arxiv = /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?(?:\.pdf)?\/?$/i.exec(s)
  if (arxiv && (/arxiv/i.test(s) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(s))) return { arxiv: arxiv[1] }
  const doi = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s]+)$/i.exec(s)
  if (doi) {
    const d = doi[1].replace(/[.,;]$/, '')
    const ax = /^10\.48550\/arxiv\.(.+)$/i.exec(d)
    return ax ? { arxiv: ax[1] } : { doi: d }
  }
  if (/^https:\/\/\S+$/i.test(s)) return { url: s }
  return null
}

/** A file name for a paper: its title, cut and cleaned, or the id it came from. */
export function fileNameOf(meta, ref) {
  const title = (meta?.title ?? '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  const id = ref.arxiv ?? ref.doi?.replace(/\//g, '_') ?? 'paper'
  return `${title || id}.pdf`
}
