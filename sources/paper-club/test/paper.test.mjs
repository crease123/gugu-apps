// The pure parts the page and the program share: references, rects, quotes, and the review schedule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeRects, notesNameOf, folderOf, parseRef, placeOfEntry, rectsOfQuote } from '../app/lib/paper.js'
import { mastery, schedule, isDue, MASTERED_DAYS } from '../app/lib/review.js'
import { into, placed, sameWork } from '../app/lib/importer.js'

test('parseRef reads arXiv ids, DOIs and links', () => {
  assert.deepEqual(parseRef('2310.06825'), { arxiv: '2310.06825' })
  assert.deepEqual(parseRef('https://arxiv.org/abs/2310.06825v2'), { arxiv: '2310.06825' })
  assert.deepEqual(parseRef('https://arxiv.org/pdf/1706.03762.pdf'), { arxiv: '1706.03762' })
  assert.deepEqual(parseRef('arXiv:hep-th/9711200'), { arxiv: 'hep-th/9711200' })
  assert.deepEqual(parseRef('10.1038/nature14539'), { doi: '10.1038/nature14539' })
  assert.deepEqual(parseRef('https://doi.org/10.48550/arXiv.1706.03762'), { arxiv: '1706.03762' })
  assert.deepEqual(parseRef('https://example.org/a.pdf'), { url: 'https://example.org/a.pdf' })
  assert.equal(parseRef('attention'), null)
  assert.equal(parseRef('http://example.org/a.pdf'), null)
})

test('a notes file sits beside its PDF', () => {
  assert.equal(notesNameOf('论文/Attention Is All You Need.pdf'), 'Attention Is All You Need · 笔记.paper.json')
  assert.equal(folderOf({ path: '论文/2026/a.pdf' }), '论文/2026')
  assert.equal(folderOf({ name: 'a.pdf' }), '')
})

test('rects of one line merge, of two lines stay apart', () => {
  const merged = mergeRects([[0.1, 0.1, 0.1, 0.02], [0.205, 0.1005, 0.1, 0.02], [0.1, 0.2, 0.3, 0.02]])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[0], [0.1, 0.1, 0.205, 0.0205])
})

const viewport = { width: 600, height: 800, convertToViewportRectangle: ([x0, y0, x1, y1]) => [x0, 800 - y0, x1, 800 - y1] }
const item = (str, x, y, width, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, hasEOL })

test('a quote is found across items, spaces and a hyphen at a line end', () => {
  const items = [item('we compute the dot prod-', 100, 700, 240, true), item('ucts of d', 100, 686, 90), item('k', 190, 683, 6)]
  const rects = rectsOfQuote(items, viewport, 'dot products of dk')
  assert.ok(rects?.length === 2, JSON.stringify(rects))
  assert.equal(rectsOfQuote(items, viewport, 'not there'), null)
})

test('SM-2: right answers spread out, a miss starts over and counts', () => {
  const now = Date.parse('2026-10-19T00:00:00Z')
  let s = schedule(undefined, 4, now)
  assert.equal(s.interval, 1)
  s = schedule(s, 4, now)
  assert.equal(s.interval, 6)
  s = schedule(s, 5, now)
  assert.ok(s.interval >= 15)
  const missed = schedule(s, 1, now)
  assert.equal(missed.interval, 0)
  assert.equal(missed.lapses, 1)
  assert.equal(missed.log.length, 4)
  assert.ok(isDue(missed, now + 11 * 60 * 1000))
  assert.ok(!isDue(s, now + 24 * 3600 * 1000))
})

test('mastery is per concept, over each card\'s interval', () => {
  const cards = { a: { concept: 'x' }, b: { concept: 'x' }, c: { concept: 'y' } }
  const result = Object.fromEntries(mastery(cards, { a: { interval: MASTERED_DAYS }, b: { interval: 0 } }).map((c) => [c.concept, c.mastery]))
  assert.deepEqual(result, { x: 0.5, y: 0 })
})

test('the same work by arXiv id or DOI', () => {
  assert.ok(sameWork({ arxiv: '1706.03762v7' }, { arxiv: '1706.03762' }))
  assert.ok(sameWork({ doi: '10.1/ABC' }, { doi: '10.1/abc' }))
  assert.ok(!sameWork({ title: 'a' }, { title: 'a' }))
})

test('a file\'s place: a chat, a project\'s folder on this computer, a session\'s working copy', () => {
  assert.deepEqual(placeOfEntry({ id: 'x', chat: 'c-1' }), { chat: 'c-1' })
  assert.deepEqual(placeOfEntry({ id: '论文/a.pdf', project: 'p-1' }), { project: 'p-1' })
  assert.deepEqual(placeOfEntry({ id: '论文/a.pdf', session: 's-1' }), { session: 's-1' })
})

test('into a folder: a chat names it beside the name, a folder on this computer in the path', () => {
  assert.deepEqual(placed({ chat: 'c-1' }, '论文', 'a.pdf'), { chat: 'c-1', name: 'a.pdf', folder: '论文' })
  assert.deepEqual(placed({ project: 'p-1' }, '论文', 'a.pdf'), { project: 'p-1', name: '论文/a.pdf' })
  assert.deepEqual(placed({ session: 's-1' }, '', 'a.pdf'), { session: 's-1', name: 'a.pdf' })
  const file = new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' })
  assert.deepEqual(into({ chat: 'c-1' }, '论文', file)[0], { chat: 'c-1', folder: '论文' })
  const [place, named] = into({ project: 'p-1' }, '论文', file)
  assert.deepEqual(place, { project: 'p-1' })
  assert.equal(named.name, '论文/a.pdf')
})
