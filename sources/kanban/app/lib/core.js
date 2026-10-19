// 看板's board, as data: the operations every writer goes through, the order keys, and how a task's status reads on a
// card. No Node, no DOM: tools.js (the one writer, Node) and the pages (the browser) import the same file.

export const BOARD_VERSION = 1

/** The four columns a new board starts with. `role` names one for the tools; its title is the page's to word. */
export const DEFAULT_COLUMNS = [
  { id: 'todo', role: 'todo' },
  { id: 'doing', role: 'doing' },
  { id: 'review', role: 'review' },
  { id: 'done', role: 'done' },
]

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * A key strictly between `a` and `b` (either may be null: no bound), compared as plain strings. Fractional keys, so a
 * move writes one card and never renumbers its neighbours: there is no server here to rebalance float positions later.
 */
export function keyBetween(a, b) {
  if (a !== null && b !== null && a >= b) throw new Error(`order keys out of order: ${a} >= ${b}`)
  return midpoint(a ?? '', b)
}

function midpoint(a, b) {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da] + midpoint(a.slice(1), null)
}

/** Ties (two writers picked the same key) sort by id, the same way everywhere. */
export const byOrder = (x, y) => (x.order < y.order ? -1 : x.order > y.order ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0)

export function emptyBoard() {
  const columns = {}
  let order = null
  for (const c of DEFAULT_COLUMNS) {
    order = keyBetween(order, null)
    columns[c.id] = { id: c.id, role: c.role, title: null, order }
  }
  return { version: BOARD_VERSION, rev: 0, columns, cards: {}, comments: {} }
}

export const columnsInOrder = (board) => Object.values(board.columns).sort(byOrder)
export const cardsIn = (board, column) => Object.values(board.cards).filter((c) => c.column === column).sort(byOrder)

/** What people and agents call a starting column, in the languages the page words it in. */
const ROLE_NAMES = {
  todo: ['todo', 'to do', '待办'],
  doing: ['doing', 'in progress', '进行中'],
  review: ['review', '待验收'],
  done: ['done', '完成'],
}

/** A column by id, by its title, or by a starting column's name (todo / 待办 …), ignoring case. */
export function findColumn(board, name) {
  const text = String(name ?? '').trim().toLowerCase()
  if (!text) return null
  const all = columnsInOrder(board)
  return (
    all.find((c) => c.id === text) ??
    all.find((c) => (c.title ?? '').toLowerCase() === text) ??
    all.find((c) => c.role && c.title === null && ROLE_NAMES[c.role].includes(text)) ??
    null
  )
}

const LINK_KINDS = {
  task: ['session'],
  file: ['session', 'path'],
  project: ['project', 'path'],
  chatfile: ['file'],
  message: ['message'],
  pr: ['url'],
  url: ['url'],
}

function checkLink(link) {
  const needs = LINK_KINDS[link?.kind]
  if (!needs) throw new Error(`a link's kind is one of: ${Object.keys(LINK_KINDS).join(', ')}`)
  for (const field of needs) {
    if (typeof link[field] !== 'string' || !link[field].trim()) throw new Error(`a ${link.kind} link needs ${field}`)
  }
  if ((link.kind === 'pr' || link.kind === 'url') && !/^https?:\/\//.test(link.url)) throw new Error('a link url starts with http:// or https://')
  if ((link.kind === 'file' || link.kind === 'project') && (link.path.startsWith('/') || link.path.split('/').includes('..'))) {
    throw new Error("a file link's path is relative to its task's working copy or project folder, without ..")
  }
  const kept = { kind: link.kind }
  for (const [key, value] of Object.entries(link)) if (typeof value === 'string' && value) kept[key] = value
  return kept
}

const text = (value, what, max) => {
  const s = String(value ?? '')
  if (s.length > max) throw new Error(`${what} is longer than ${max} characters`)
  return s
}

function needCard(board, id) {
  const card = board.cards[id]
  if (!card) throw new Error(`there is no card ${id} on the board`)
  return card
}

function needColumn(board, id) {
  const column = board.columns[id]
  if (!column) throw new Error(`there is no column ${id} on the board`)
  return column
}

/** The key for a place in a list: just after `after`, or just before `before`, or at the end. */
function placeIn(list, { before = null, after = null }, self) {
  const others = list.filter((x) => x.id !== self)
  let i = others.length
  if (after !== null) {
    const at = others.findIndex((x) => x.id === after)
    if (at < 0) throw new Error(`${after} is not there`)
    i = at + 1
  } else if (before !== null) {
    const at = others.findIndex((x) => x.id === before)
    if (at < 0) throw new Error(`${before} is not there`)
    i = at
  }
  const lo = i > 0 ? others[i - 1].order : null
  const hi = i < others.length ? others[i].order : null
  // Two cards with the same key (a tie): step past it so the new key still lands between distinct bounds.
  return lo !== null && hi !== null && lo >= hi ? keyBetween(lo, null) : keyBetween(lo, hi)
}

/**
 * Apply one operation to `board` in place. `by` is who did it: 'person', or an agent's user:<uuid> stamped by gugu.
 * `id` makes new ids (passed in so tests are repeatable). Returns what the caller needs back (a new card's id …).
 * Every failure throws, with what to do in the message: nothing is half-applied, the caller writes only on success.
 */
export function applyOp(board, op, { by, now, id }) {
  const at = now
  switch (op?.type) {
    case 'card.create': {
      const column = op.column ? needColumn(board, op.column).id : columnsInOrder(board)[0].id
      const title = text(op.title, 'a title', 500).trim()
      if (!title) throw new Error('a card needs a title')
      const card = { id: id(), title, note: text(op.note, 'a note', 100_000), column, order: '', by, links: {}, createdAt: at, updatedAt: at }
      card.order = placeIn(cardsIn(board, column), {}, card.id)
      for (const link of op.links ?? []) card.links[id()] = { ...checkLink(link), by, at }
      board.cards[card.id] = card
      return { card: card.id }
    }
    case 'card.update': {
      const card = needCard(board, op.card)
      if (op.title !== undefined) {
        const title = text(op.title, 'a title', 500).trim()
        if (!title) throw new Error('a card needs a title')
        card.title = title
      }
      if (op.note !== undefined) card.note = text(op.note, 'a note', 100_000)
      card.updatedAt = at
      return { card: card.id }
    }
    case 'card.move': {
      const card = needCard(board, op.card)
      const column = needColumn(board, op.column ?? card.column).id
      card.order = placeIn(cardsIn(board, column), op, card.id)
      card.column = column
      card.updatedAt = at
      return { card: card.id, column }
    }
    case 'card.delete': {
      needCard(board, op.card)
      delete board.cards[op.card]
      for (const [cid, c] of Object.entries(board.comments)) if (c.card === op.card) delete board.comments[cid]
      return { card: op.card }
    }
    case 'link.add': {
      const card = needCard(board, op.card)
      const link = checkLink(op.link)
      // The same task or file twice on one card is one link.
      const same = Object.entries(card.links).find(([, l]) => l.kind === link.kind && LINK_KINDS[link.kind].every((f) => l[f] === link[f]))
      if (same) return { card: card.id, link: same[0], existed: true }
      const lid = id()
      card.links[lid] = { ...link, by, at }
      card.updatedAt = at
      return { card: card.id, link: lid }
    }
    case 'link.remove': {
      const card = needCard(board, op.card)
      if (!card.links[op.link]) throw new Error(`card ${card.id} has no link ${op.link}`)
      delete card.links[op.link]
      card.updatedAt = at
      return { card: card.id }
    }
    case 'comment.add': {
      const card = needCard(board, op.card)
      const body = text(op.text, 'a comment', 20_000).trim()
      if (!body) throw new Error('a comment needs text')
      const cid = id()
      board.comments[cid] = { id: cid, card: card.id, by, text: body, at }
      card.updatedAt = at
      return { comment: cid }
    }
    case 'column.create': {
      const title = text(op.title, 'a column title', 100).trim()
      if (!title) throw new Error('a column needs a title')
      const cid = id()
      board.columns[cid] = { id: cid, role: null, title, order: placeIn(columnsInOrder(board), {}, cid) }
      return { column: cid }
    }
    case 'column.update': {
      const column = needColumn(board, op.column)
      const title = text(op.title, 'a column title', 100).trim()
      // An empty title gives a starting column its default name back; a column of your own needs one.
      if (!title && !column.role) throw new Error('a column needs a title')
      column.title = title || null
      return { column: column.id }
    }
    case 'column.move': {
      const column = needColumn(board, op.column)
      column.order = placeIn(columnsInOrder(board), op, column.id)
      return { column: column.id }
    }
    case 'column.delete': {
      const column = needColumn(board, op.column)
      if (cardsIn(board, column.id).length) throw new Error('move or delete the cards in this column first')
      if (columnsInOrder(board).length === 1) throw new Error('a board keeps at least one column')
      delete board.columns[column.id]
      return { column: column.id }
    }
    default:
      throw new Error(`unknown operation ${JSON.stringify(op?.type)}`)
  }
}

/**
 * How a task's status reads on a card, from listAgents' status / detail (packages/core/src/shared/agentStatus.ts):
 * a key the page words, and whether it waits on the person (those count in the tab's badge).
 */
export function taskState(agent) {
  if (!agent) return { key: 'gone', waiting: false }
  if (agent.failure || agent.status === 'error') return { key: 'error', waiting: false }
  switch (agent.status) {
    case 'working':
      return { key: agent.detail === 'parked' ? 'parked' : 'running', waiting: false }
    case 'needs_user':
      return { key: agent.detail === 'approval' ? 'approval' : 'answer', waiting: true }
    case 'idle':
      return { key: agent.detail === 'done' ? 'done' : 'stopped', waiting: false }
    default:
      return { key: 'none', waiting: false }
  }
}
