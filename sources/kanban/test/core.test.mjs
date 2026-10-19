import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyBetween, emptyBoard, applyOp, cardsIn, columnsInOrder, findColumn, taskState } from '../app/lib/core.js'

let n = 0
const ctx = (by = 'person') => ({ by, now: '2026-10-19T00:00:00.000Z', id: () => `id${++n}` })

test('keyBetween always lands strictly between, and never needs a renumber', () => {
  let keys = [keyBetween(null, null)]
  for (let i = 0; i < 200; i++) keys.push(keyBetween(keys.at(-1), null)) // append
  for (let i = 0; i < 200; i++) keys.unshift(keyBetween(null, keys[0])) // prepend
  for (let i = 0; i < 200; i++) {
    const at = 1 + (i * 37) % (keys.length - 1)
    keys.splice(at, 0, keyBetween(keys[at - 1], keys[at])) // insert in the middle
  }
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i], `${keys[i - 1]} < ${keys[i]}`)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.every((k) => !k.endsWith('0')))
  // the same spot, hammered: still between
  let lo = 'a', hi = 'b'
  for (let i = 0; i < 100; i++) { const k = keyBetween(lo, hi); assert.ok(lo < k && k < hi); hi = k }
})

test('keyBetween refuses bounds out of order (a check that can fail)', () => {
  assert.throws(() => keyBetween('b', 'a'), /out of order/)
  assert.throws(() => keyBetween('a', 'a'), /out of order/)
})

test('a new board has the four starting columns in order', () => {
  const board = emptyBoard()
  assert.deepEqual(columnsInOrder(board).map((c) => c.role), ['todo', 'doing', 'review', 'done'])
  assert.equal(findColumn(board, 'Doing').id, 'doing')
  assert.equal(findColumn(board, 'nope'), null)
})

test('create, move between, move to another column, delete', () => {
  const board = emptyBoard()
  const a = applyOp(board, { type: 'card.create', title: 'a' }, ctx()).card
  const b = applyOp(board, { type: 'card.create', title: 'b' }, ctx()).card
  const c = applyOp(board, { type: 'card.create', title: 'c' }, ctx()).card
  assert.deepEqual(cardsIn(board, 'todo').map((x) => x.title), ['a', 'b', 'c'])
  applyOp(board, { type: 'card.move', card: c, column: 'todo', before: a }, ctx())
  assert.deepEqual(cardsIn(board, 'todo').map((x) => x.title), ['c', 'a', 'b'])
  applyOp(board, { type: 'card.move', card: a, column: 'doing' }, ctx())
  assert.deepEqual(cardsIn(board, 'doing').map((x) => x.title), ['a'])
  applyOp(board, { type: 'comment.add', card: b, text: 'hi' }, ctx())
  applyOp(board, { type: 'card.delete', card: b }, ctx())
  assert.equal(board.cards[b], undefined)
  assert.equal(Object.keys(board.comments).length, 0)
})

test('links: kinds checked, the same task twice is one link', () => {
  const board = emptyBoard()
  const card = applyOp(board, { type: 'card.create', title: 'x' }, ctx()).card
  const first = applyOp(board, { type: 'link.add', card, link: { kind: 'task', session: 's1', agent: 'user:a' } }, ctx('user:a'))
  const again = applyOp(board, { type: 'link.add', card, link: { kind: 'task', session: 's1' } }, ctx())
  assert.equal(again.link, first.link)
  assert.equal(again.existed, true)
  assert.equal(board.cards[card].links[first.link].by, 'user:a')
  assert.throws(() => applyOp(board, { type: 'link.add', card, link: { kind: 'file', session: 's', path: '../etc/passwd' } }, ctx()), /without \.\./)
  assert.throws(() => applyOp(board, { type: 'link.add', card, link: { kind: 'url', url: 'javascript:alert(1)' } }, ctx()), /http/)
  assert.throws(() => applyOp(board, { type: 'link.add', card, link: { kind: 'shell' } }, ctx()), /kind is one of/)
})

test('refusals throw and leave the board as it was', () => {
  const board = emptyBoard()
  const before = JSON.stringify(board)
  assert.throws(() => applyOp(board, { type: 'card.create', title: '   ' }, ctx()), /needs a title/)
  assert.throws(() => applyOp(board, { type: 'card.move', card: 'nope', column: 'todo' }, ctx()), /no card/)
  assert.throws(() => applyOp(board, { type: 'whatever' }, ctx()), /unknown operation/)
  assert.equal(JSON.stringify(board), before)
})

test('columns: add, rename, a starting column takes its default name back, delete only when empty', () => {
  const board = emptyBoard()
  const col = applyOp(board, { type: 'column.create', title: 'Blocked' }, ctx()).column
  assert.equal(columnsInOrder(board).at(-1).id, col)
  applyOp(board, { type: 'column.update', column: 'todo', title: 'Inbox' }, ctx())
  assert.equal(board.columns.todo.title, 'Inbox')
  applyOp(board, { type: 'column.update', column: 'todo', title: '' }, ctx())
  assert.equal(board.columns.todo.title, null)
  assert.throws(() => applyOp(board, { type: 'column.update', column: col, title: '' }, ctx()), /needs a title/)
  applyOp(board, { type: 'card.create', title: 'x', column: col }, ctx())
  assert.throws(() => applyOp(board, { type: 'column.delete', column: col }, ctx()), /first/)
})

test('a task status reads on the card as gugu states it', () => {
  assert.deepEqual(taskState({ status: 'needs_user', detail: 'approval' }), { key: 'approval', waiting: true })
  assert.deepEqual(taskState({ status: 'needs_user', detail: 'question' }), { key: 'answer', waiting: true })
  assert.equal(taskState({ status: 'working', detail: 'running' }).key, 'running')
  assert.equal(taskState({ status: 'working', detail: 'parked' }).key, 'parked')
  assert.equal(taskState({ status: 'idle', detail: 'done' }).key, 'done')
  assert.equal(taskState({ status: 'idle', detail: 'plain' }).key, 'stopped')
  assert.equal(taskState({ status: 'working', failure: { kind: 'adapter-exit' } }).key, 'error')
  assert.equal(taskState({ status: null }).key, 'none')
  assert.equal(taskState(null).key, 'gone')
})

test('a project file link needs its project and a path inside it', () => {
  const board = emptyBoard()
  const card = applyOp(board, { type: 'card.create', title: 'x' }, ctx()).card
  const { link } = applyOp(board, { type: 'link.add', card, link: { kind: 'project', project: 'p1', path: 'docs/a.md', title: 'proj' } }, ctx())
  assert.deepEqual({ ...board.cards[card].links[link], at: undefined, by: undefined }, { kind: 'project', project: 'p1', path: 'docs/a.md', title: 'proj', at: undefined, by: undefined })
  assert.throws(() => applyOp(board, { type: 'link.add', card, link: { kind: 'project', path: 'a.md' } }, ctx()), /needs project/)
  assert.throws(() => applyOp(board, { type: 'link.add', card, link: { kind: 'project', project: 'p1', path: '../../etc/passwd' } }, ctx()), /without \.\./)
})

