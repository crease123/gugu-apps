/* global gugu */ // window.gugu: the platform runtime puts it on the page before this module runs.
// 论文共读 — the shelf: the tab that claims no file. Where it is decides what it lists:
// - the App's own page (its icon in the left bar; no chat, no session): the person's library — every paper in every chat
//   they are in (files.search) and in a project's folder on this computer (one person alone, no chat needed), each with
//   where it is, its marks, who is reading it and their own mastery and due cards; an import goes where they pick — a
//   project (gugu.projects, a desktop's) or a chat — and opens in the reader.
// - a chat: that chat's papers, imports go there. (Today a chat's side panel holds only the folder and Apps opened for a
//   file — GroupAppSlot — so this is for when it holds Apps of their own; the code is the same.)
// - a session: the working copy's PDFs.
// An arXiv id, a DOI or a link imports a paper (lib/import-box.js), or a PDF is uploaded. A paper clicked opens right
// here in the same reader a chat's panel uses (reader.html?file=…), with everything it does; its due cards, on Cards.
import { importFailure, importInto, uploadInto } from './lib/import-box.js'
import { isNotes, isPdf, placeOfEntry } from './lib/paper.js'
import { isDue, mastery } from './lib/review.js'
import { fmt, stringsFor } from './lib/strings.js'

const $ = (id) => document.getElementById(id)
const MAX_OPEN = 40 // notes files opened for their counts; past that, a row says only its name
const state = { t: stringsFor(navigator.language), ctx: null, place: null, library: false, entries: [], notes: new Map(), me: null, targets: [], projects: new Map() }
const TARGET_KEY = 'paper-club.target' // the place an import goes, remembered on this screen

async function start() {
  const ctx = await gugu.getContext()
  state.ctx = ctx
  state.t = stringsFor(ctx.locale)
  const t = state.t
  $('ref').placeholder = t.importPlaceholder
  $('ref').setAttribute('aria-label', t.importPlaceholder)
  $('import-go').textContent = t.import
  $('upload').textContent = t.upload
  state.place = ctx.chat ? { chat: ctx.chat.id } : ctx.session ? { session: ctx.session.id } : null
  state.library = !state.place
  if (ctx.session && !ctx.chat) {
    $('import').hidden = true
    $('list-title').hidden = false
    $('list-title').textContent = t.sessionShelf
  }
  if (state.library) {
    $('target').hidden = false
    $('target').setAttribute('aria-label', t.importInto)
    $('target').onchange = () => { remember($('target').value); refresh() }
    $('list-title').textContent = t.library
    // Every chat's folder can change: the list is read again when the page is looked at again.
    gugu.onContextChanged((next) => { if (next.layout?.visible) refresh() })
    return refresh()
  }
  gugu.files.onChanged(state.place, () => refresh())
  gugu.onContextChanged((next) => {
    state.ctx = { ...state.ctx, ...next }
  })
  await refresh()
}

let refreshing = null
async function refresh() {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      state.entries = state.library ? await libraryEntries() : await gugu.files.list(state.place)
      await openNotes()
      draw()
    } catch (error) {
      say(fmt(state.t.failed, { e: error.message }), 'error')
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/**
 * The library: every PDF and notes file in the person's chats, and in the folder of the project picked to keep papers in
 * (a desktop's projects; a phone has none). The places an import may go: those projects, then the chats with papers.
 */
async function libraryEntries() {
  const [pdfs, notes, projects] = await Promise.all([
    gugu.files.search({ suffixes: ['.pdf'], limit: 200 }),
    gugu.files.search({ query: '.paper', suffixes: ['.json'], limit: 200 }),
    typeof gugu.projects?.list === 'function' ? gugu.projects.list().then((r) => r.projects) : null,
  ])
  state.projects = new Map((projects ?? []).map((p) => [p.id, p.name]))
  const chats = new Map()
  for (const e of [...pdfs, ...notes]) if (e.chat && !chats.has(e.chat)) chats.set(e.chat, e.chatName ?? e.chat)
  drawTargets(chats, projects)
  const place = targetPlace()
  const here = place?.project ? (await gugu.files.list(place)).filter((e) => isPdf(e) || isNotes(e)) : []
  return [...here, ...pdfs, ...notes]
}

function drawTargets(chats, projects) {
  const t = state.t
  state.targets = [
    ...(projects ?? []).map((p) => ({ value: `project:${p.id}`, place: { project: p.id }, label: fmt(t.onThisComputer, { name: p.name }) })),
    ...[...chats].map(([id, name]) => ({ value: `chat:${id}`, place: { chat: id }, label: name })),
  ]
  const select = $('target')
  const want = select.value || remembered()
  select.replaceChildren(...state.targets.map((x) => Object.assign(document.createElement('option'), { value: x.value, textContent: x.label })))
  if (state.targets.some((x) => x.value === want)) select.value = want
  $('import').hidden = state.targets.length === 0
  // Where a person alone keeps papers, and why it may not be here: no projects on this device (a phone, an older gugu), or none yet.
  const note = projects === null ? t.noLocalHere : projects.length === 0 ? t.noProject : null
  $('note').hidden = !note
  $('note').textContent = note ?? ''
}

const targetPlace = () => state.targets.find((x) => x.value === $('target').value)?.place ?? null

function remembered() {
  try { return localStorage.getItem(TARGET_KEY) ?? '' } catch { return '' }
}
function remember(value) {
  try { localStorage.setItem(TARGET_KEY, value) } catch { /* a screen that keeps nothing: picked again next time */ }
}

/** Each notes file of the chat, opened live (its counts and readers stay current); ones gone are let go. */
async function openNotes() {
  const want = state.entries.filter(isNotes).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_OPEN)
  const ids = new Set(want.map((e) => e.id))
  for (const [id, f] of state.notes) if (!ids.has(id)) { f.close(); state.notes.delete(id) }
  await Promise.all(
    want.filter((e) => !state.notes.has(e.id)).map(async (entry) => {
      try {
        const f = await gugu.files.open(entry)
        state.notes.set(entry.id, f)
        state.me ??= f.presence.self.userId
        f.onChange(() => draw())
        f.presence.onChange(() => draw())
      } catch (error) {
        // One unreadable notes file costs its row its counts, never the shelf: say which.
        gugu.reportError(`${entry.name}: ${error.message}`)
      }
    }),
  )
}

function notesOf(pdf) {
  for (const f of state.notes.values()) if (f.data.pdf === pdf.id) return f
  return null
}

function draw() {
  const t = state.t
  const pdfs = state.entries.filter(isPdf).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  // The library with nowhere to import into says why in its note alone: no 「paste one above」 under an import bar not there.
  if (!pdfs.length) return empty(state.library ? (state.targets.length ? t.libraryEmpty : null) : state.ctx.chat ? t.shelfEmpty : t.sessionEmpty)
  $('list-title').hidden = false
  $('empty').replaceChildren()
  $('papers').replaceChildren(
    ...pdfs.map((pdf) => {
      const f = notesOf(pdf)
      const meta = f?.data.meta ?? {}
      const li = document.createElement('li')
      li.tabIndex = 0
      li.setAttribute('role', 'button')
      const text = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = meta.title || pdf.name.replace(/\.pdf$/i, '')
      const sub = document.createElement('span')
      const marks = Object.keys(f?.data.highlights ?? {}).length
      const readers = new Set((f?.presence.others ?? []).filter((p) => p.state?.page).map((p) => p.userId)).size
      sub.textContent = [
        meta.year,
        meta.authors?.length ? `${meta.authors[0]}${meta.authors.length > 1 ? ' …' : ''}` : null,
        marks ? fmt(t.marks, { n: marks }) : null,
        readers ? `${readers} ${t.readingNow}` : null,
        state.library ? (pdf.project ? fmt(t.onThisComputer, { name: state.projects.get(pdf.project) ?? pdf.project }) : pdf.chatName) : null,
        due(f) ? fmt(t.dueCount, { n: due(f) }) : null,
      ].filter(Boolean).join(' · ')
      text.append(title, sub)
      li.append(text)
      const cards = f?.data.cards ?? {}
      if (Object.keys(cards).length && state.me) {
        const concepts = mastery(cards, f.data.reviews?.[state.me])
        const total = concepts.reduce((sum, c) => sum + c.mastery * c.cards.length, 0) / Object.keys(cards).length
        const mine = document.createElement('span')
        mine.className = 'mine'
        const bar = document.createElement('progress')
        bar.max = 100
        bar.value = Math.round(total * 100)
        const small = document.createElement('small')
        small.textContent = `${Math.round(total * 100)}%`
        mine.append(bar, small)
        li.append(mine)
      }
      // Read it right here: the same reader as a chat's panel (reader.html), told which file in the address.
      const open = (tab) => { location.href = readerUrl(pdf, tab) }
      if (due(f)) {
        const review = document.createElement('button')
        review.type = 'button'
        review.textContent = `${t.review} · ${due(f)}`
        review.onclick = (e) => { e.stopPropagation(); open('cards') }
        li.append(review)
      }
      li.onclick = () => open()
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }
      return li
    }),
  )
}

/** This person's cards on a paper that are due now. */
function due(f) {
  const cards = Object.keys(f?.data.cards ?? {})
  const mine = f?.data.reviews?.[state.me] ?? {}
  return cards.filter((id) => isDue(mine[id])).length
}

/** The reader for one paper, in this page: its file (and its chat, project or session) in the address, a tab to start on. */
function readerUrl(pdf, tab) {
  const q = new URLSearchParams({ file: pdf.id, ...placeOfEntry(pdf), from: 'shelf', ...(tab ? { tab } : {}) })
  return `reader.html?${q}`
}

function empty(text) {
  $('papers').replaceChildren()
  if (!text) return $('empty').replaceChildren()
  const node = document.createElement('gugu-empty')
  node.setAttribute('icon', 'book-open')
  const strong = document.createElement('strong')
  strong.textContent = text
  node.append(strong)
  $('empty').replaceChildren(node)
}

// ─── import (lib/import-box.js: the one way, shared with the reader's import box) ────

/** Where an import goes: this chat or working copy, or (the library) the place picked. */
const importPlace = () => (state.library ? targetPlace() : state.place)

async function onImport(event) {
  event.preventDefault()
  const input = $('ref').value.trim()
  say(state.t.importing)
  $('import-go').disabled = true
  try {
    const place = importPlace()
    const done = await importInto(place, input)
    say(fmt(state.t.imported, { title: done.title }))
    $('ref').value = ''
    // From the library, the paper opens to be read at once.
    if (state.library && done.pdf) return void (location.href = readerUrl({ id: done.pdf, ...place }))
    await refresh()
  } catch (error) {
    say(importFailure(error, state.t, input), 'error')
  } finally {
    $('import-go').disabled = false
  }
}

async function onUpload() {
  try {
    const entries = await uploadInto(importPlace())
    if (entries.length) {
      say(fmt(state.t.imported, { title: entries.map((e) => e.name).join(', ') }))
      await refresh()
    }
  } catch (error) {
    say(fmt(state.t.failed, { e: error.message }), 'error')
  }
}

function say(text, kind = 'info') {
  const banner = $('banner')
  banner.hidden = !text
  banner.textContent = text ?? ''
  banner.dataset.kind = kind
  banner.setAttribute('role', kind === 'error' ? 'alert' : 'status')
}

$('import').onsubmit = onImport
$('upload').onclick = onUpload
start().catch((error) => {
  say(fmt(state.t.failed, { e: error.message }), 'error')
  gugu.reportError(error.message)
})

