// 看板 — the board page. The same page wherever it opens (the dock, a chat's panel, a task's tab): the board comes from
// the background page, and every change goes back through it to the App's program, the board's only writer.
import { columnsInOrder, cardsIn, taskState } from './lib/core.js'

const g = window.gugu

const WORDS = {
  zh: {
    title: '看板', newPlaceholder: '新卡片，回车添加', add: '添加', attach: '关联当前任务',
    roles: { todo: '待办', doing: '进行中', review: '待验收', done: '完成' },
    states: { running: '运行中', parked: '后台运行', approval: '待批准', answer: '待回复', done: '本轮完成', stopped: '已停止', error: '出错', gone: '任务已移除', none: '无状态' },
    addColumn: '添加列', columnName: '列名', back: '返回', close: '关闭', del: '删除卡片', delAgain: '再次点击确认删除',
    tasks: '任务', links: '文件与链接', noteH: '说明', comments: '评论', edit: '编辑', done: '完成',
    noteEmpty: '暂无说明', open: '打开任务', handTo: '转给任务', remove: '移除',
    attachCurrent: '关联当前任务', pickTask: '关联任务…', start: '新建任务', starting: '正在新建任务…',
    pickFile: '关联任务文件…', pickChatFile: '关联群文件…', addUrl: '添加链接', urlPlaceholder: 'https://…', ok: '确定', cancel: '取消',
    filter: '筛选', chooseTask: '选择任务', noTasks: '本机暂无任务', noFiles: '未找到文件。输入文件名可搜索全部对话。',
    show: '查看', openBeside: '在旁边打开', pickProjectFile: '关联项目文件…', chooseProject: '选择项目', noProjects: '暂无项目', desktopOnly: '看板仅在电脑上可用。', browser: '打开', message: '查看消息',
    comment: '添加评论', send: '发表', byAgent: (n) => `⚡ ${n}`, byPerson: '我',
    noStatus: (e) => `无法读取本机任务状态：${e}`, noBoard: (e) => `无法读取看板：${e}`,
    handText: (c) => `请处理看板上的卡片（id ${c.id}）：${c.title}${c.note ? `\n\n${c.note}` : ''}\n\n开始时用看板的 claim 工具认领，完成后用 move 移到「待验收」，并用 link 关联产出。`,
  },
  en: {
    title: 'Board', newPlaceholder: 'New card, press Enter to add', add: 'Add', attach: 'Link current task',
    roles: { todo: 'To do', doing: 'In progress', review: 'Review', done: 'Done' },
    states: { running: 'Running', parked: 'Running in background', approval: 'Awaiting approval', answer: 'Awaiting reply', done: 'Turn complete', stopped: 'Stopped', error: 'Error', gone: 'Task removed', none: 'No status' },
    addColumn: 'Add column', columnName: 'Column name', back: 'Back', close: 'Close', del: 'Delete card', delAgain: 'Click again to confirm',
    tasks: 'Tasks', links: 'Files and links', noteH: 'Note', comments: 'Comments', edit: 'Edit', done: 'Done',
    noteEmpty: 'No note', open: 'Open task', handTo: 'Send to task', remove: 'Remove',
    attachCurrent: 'Link current task', pickTask: 'Link task…', start: 'New task', starting: 'Creating task…',
    pickFile: 'Link task file…', pickChatFile: 'Link chat file…', addUrl: 'Add link', urlPlaceholder: 'https://…', ok: 'OK', cancel: 'Cancel',
    filter: 'Filter', chooseTask: 'Select task', noTasks: 'No tasks on this device', noFiles: 'No files found. Enter a file name to search all chats.',
    show: 'View', openBeside: 'Open beside', pickProjectFile: 'Link project file…', chooseProject: 'Select project', noProjects: 'No projects', desktopOnly: 'The board is available on desktop only.', browser: 'Open', message: 'View message',
    comment: 'Add a comment', send: 'Post', byAgent: (n) => `⚡ ${n}`, byPerson: 'Me',
    noStatus: (e) => `Unable to read task status on this device: ${e}`, noBoard: (e) => `Unable to read the board: ${e}`,
    handText: (c) => `Please handle this card from the board (id ${c.id}): ${c.title}${c.note ? `\n\n${c.note}` : ''}\n\nClaim it with the board's claim tool when you start; when finished, move it to Review and link the output with link.`,
  },
}

const $ = (id) => document.getElementById(id)
// The page is moved between places (the dock, a chat's panel, a task's tab) and told by onContextChanged: where it
// is now — its session or chat — is read again on every change, never kept from the first load.
let ctx = await g.getContext()
let t = WORDS[String(ctx.locale ?? '').startsWith('zh') ? 'zh' : 'en']

let board = null
let agents = []
let shownColumn = null
let selected = null
let visible = ctx.layout?.visible ?? true
const waiting = new Map()

/** Element maker: text goes in as text (others wrote it), never as markup. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'text') el.textContent = value
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid)
  return el
}

const icon = (name) => h('gugu-icon', { name })
const narrow = () => $('shell').clientWidth <= 640

function showAlert(message) {
  $('alert').textContent = message ?? ''
  $('alert').hidden = !message
}

/** One change to the board, through the background page; resolves the program's result, rejects with its reason. */
function change(op) {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    g.sendToBackground({ type: 'op', id, op }).catch((error) => {
      waiting.delete(id)
      reject(error)
    })
  }).catch((error) => {
    showAlert(error?.message ?? String(error))
    throw error
  })
}

// A change refused is already said in #alert; the click that asked for it has nothing more to do.
const quietly = (promise) => promise.catch(() => {})

// A phone has no background page — and so neither the App's program nor this computer's board: say so and stop.
const desktop = typeof gugu.onBackgroundMessage === 'function'

if (desktop) g.onBackgroundMessage((message) => {
  if (message?.type === 'refused') {
    waiting.get(message.id)?.reject(new Error(message.message))
    waiting.delete(message.id)
    return
  }
  if (message?.type !== 'state') return
  board = message.board
  agents = message.agents ?? []
  const problems = [message.failure?.board && t.noBoard(message.failure.board), message.failure?.agents && t.noStatus(message.failure.agents)].filter(Boolean)
  if (problems.length) showAlert(problems.join(' · '))
  else if (!message.done) showAlert(null)
  if (message.done) {
    waiting.get(message.done.id)?.resolve(message.done.result)
    waiting.delete(message.done.id)
  }
  render()
})

const agentBySession = (session) => agents.find((a) => a.sessionId === session) ?? null
const agentById = (id) => agents.find((a) => a.agentId === id) ?? null
const columnTitle = (column) => column.title ?? t.roles[column.role] ?? column.id
const taskLinks = (card) => Object.entries(card.links).filter(([, l]) => l.kind === 'task')
const otherLinks = (card) => Object.entries(card.links).filter(([, l]) => l.kind !== 'task')

function stateBadge(link) {
  const { key } = taskState(agentBySession(link.session))
  return h('span', { class: `state ${key}`, text: t.states[key] })
}

function byLabel(by) {
  if (by === 'person') return t.byPerson
  return t.byAgent(agentById(by)?.title ?? by.slice(5, 13))
}

// ── the board ────────────────────────────────────────────────────────────────

function render() {
  if (!board) return
  const columns = columnsInOrder(board)
  if (!shownColumn || !board.columns[shownColumn]) shownColumn = columns[0]?.id ?? null

  let waitingCount = 0
  for (const card of Object.values(board.cards)) {
    if (taskLinks(card).some(([, l]) => taskState(agentBySession(l.session)).waiting)) waitingCount += 1
  }
  g.setTabBadge(waitingCount || null).catch((error) => g.reportError(`setTabBadge: ${error?.message ?? error}`))

  $('tabs').replaceChildren(
    ...columns.map((c) =>
      h('button', { role: 'tab', 'aria-selected': c.id === shownColumn ? 'true' : 'false', onclick: () => { shownColumn = c.id; render() } }, `${columnTitle(c)} ${cardsIn(board, c.id).length}`),
    ),
  )
  $('board').replaceChildren(...columns.map(columnView), h('div', {}, h('button', { onclick: addColumn, text: t.addColumn })))
  if (selected && !board.cards[selected]) closeCard()
  else if (selected) updateDrawer()
}

function columnView(column) {
  const cards = cardsIn(board, column.id)
  const list = h('ul', { class: 'cards', 'data-col': column.id })
  list.append(...cards.map((card) => h('li', {}, cardView(card))))
  list.addEventListener('dragover', (event) => {
    event.preventDefault()
    list.classList.add('over')
  })
  list.addEventListener('dragleave', () => list.classList.remove('over'))
  list.addEventListener('drop', (event) => {
    event.preventDefault()
    list.classList.remove('over')
    const id = event.dataTransfer.getData('text/plain')
    if (!board.cards[id]) return
    // Dropped above the first card whose middle is below the pointer; by its id, never by an index (others move too).
    const below = [...list.querySelectorAll('.card')].find((el) => el.dataset.card !== id && el.getBoundingClientRect().top + el.offsetHeight / 2 > event.clientY)
    quietly(change({ type: 'card.move', card: id, column: column.id, ...(below ? { before: below.dataset.card } : {}) }))
  })
  const title = h('span', { text: columnTitle(column), title: t.columnName, ondblclick: () => renameColumn(column, title) })
  return h('section', { class: `col${column.id === shownColumn ? ' shown' : ''}`, 'aria-label': columnTitle(column) },
    h('h2', {}, title, h('small', { text: String(cards.length) })),
    list,
  )
}

function cardView(card) {
  const tasks = taskLinks(card)
  const others = otherLinks(card).length
  const el = h('button', { class: 'card', draggable: 'true', 'data-card': card.id, 'aria-selected': card.id === selected ? 'true' : 'false', onclick: () => openCard(card.id) },
    h('strong', { text: card.title }),
    (tasks.length || others || card.by !== 'person')
      ? h('span', { class: 'meta' },
          tasks.map(([, l]) => stateBadge(l)),
          others ? h('span', {}, icon('paperclip'), ` ${others}`) : null,
          card.by !== 'person' ? h('span', { text: byLabel(card.by) }) : null)
      : null,
  )
  el.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', card.id)
    el.classList.add('dragging')
  })
  el.addEventListener('dragend', () => el.classList.remove('dragging'))
  return el
}

function renameColumn(column, span) {
  const input = h('input', { type: 'text', value: columnTitle(column), 'aria-label': t.columnName })
  const done = (save) => {
    if (save && input.value.trim() !== columnTitle(column)) quietly(change({ type: 'column.update', column: column.id, title: input.value }))
    else render()
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) })
  input.addEventListener('blur', () => done(true))
  span.replaceWith(input)
  input.focus()
  input.select()
}

function addColumn(event) {
  const button = event.currentTarget
  const input = h('input', { type: 'text', placeholder: t.columnName, 'aria-label': t.columnName })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) quietly(change({ type: 'column.create', title: input.value }))
    if (e.key === 'Escape') render()
  })
  button.replaceWith(input)
  input.focus()
}

// ── a new card ───────────────────────────────────────────────────────────────

$('heading').textContent = t.title
$('new-title').placeholder = t.newPlaceholder
$('new-title').setAttribute('aria-label', t.newPlaceholder)
$('new-add').textContent = t.add
$('attach-label').textContent = t.attach
$('new-card').addEventListener('submit', async (event) => {
  event.preventDefault()
  const title = $('new-title').value.trim()
  if (!title) return
  const links = ctx.session && $('attach-task').checked ? [{ kind: 'task', session: ctx.session.id, ...(ctx.session.agentId ? { agent: ctx.session.agentId } : {}) }] : []
  const column = narrow() ? shownColumn : undefined
  await quietly(change({ type: 'card.create', title, links, ...(column ? { column } : {}) }).then(() => { $('new-title').value = '' }))
})

g.onCommand((id) => { if (id === 'new') $('new-title').focus() })

// ── a card, opened ───────────────────────────────────────────────────────────

let drawer = null // the open card's live parts: { card, title, noteView, noteEdit, viewing, ... }

function openCard(id) {
  selected = id
  closeView()
  drawer = buildDrawer(id)
  $('drawer').replaceChildren(drawer.root)
  $('drawer').hidden = false
  $('shell').classList.add('open')
  render()
}

function closeCard() {
  closeView()
  selected = null
  drawer = null
  $('drawer').hidden = true
  $('drawer').replaceChildren()
  $('shell').classList.remove('open')
  render()
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selected && !event.target.closest?.('input, textarea, .cm-editor')) closeCard()
})

function buildDrawer(id) {
  const card = board.cards[id]
  const column = h('select', { 'aria-label': t.roles.doing, onchange: (e) => quietly(change({ type: 'card.move', card: id, column: e.target.value })) })
  let armed = false
  const del = h('button', { class: 'danger', text: t.del, onclick: () => {
    if (!armed) { armed = true; del.textContent = t.delAgain; return }
    quietly(change({ type: 'card.delete', card: id }))
  } })
  const title = h('input', { id: 'd-title', type: 'text', value: card.title, 'aria-label': t.title })
  title.addEventListener('change', () => quietly(change({ type: 'card.update', card: id, title: title.value })))

  const tasks = h('ul', { class: 'links' })
  const taskActions = h('div', { class: 'row' })
  const links = h('ul', { class: 'links' })
  const linkActions = h('div', { class: 'row' })
  const picker = h('div')
  const view = h('div')

  const noteView = h('div', { class: 'note-view', 'data-empty': t.noteEmpty })
  const noteEdit = h('textarea', { rows: '8', hidden: true, 'aria-label': t.noteH })
  const noteButton = h('button', { text: t.edit })
  noteButton.addEventListener('click', () => {
    if (noteEdit.hidden) {
      noteEdit.value = board.cards[id]?.note ?? ''
      noteEdit.hidden = false
      noteView.hidden = true
      noteButton.textContent = t.done
      noteEdit.focus()
    } else {
      saveNote()
    }
  })
  const saveNote = () => {
    const text = noteEdit.value
    noteEdit.hidden = true
    noteView.hidden = false
    noteButton.textContent = t.edit
    if (text !== (board.cards[id]?.note ?? '')) quietly(change({ type: 'card.update', card: id, note: text }))
  }

  const comments = h('ul', { class: 'comments' })
  const commentBox = h('textarea', { rows: '2', placeholder: t.comment, 'aria-label': t.comment })
  const commentSend = h('button', { text: t.send, onclick: () => {
    const text = commentBox.value.trim()
    if (text) quietly(change({ type: 'comment.add', card: id, text }).then(() => { commentBox.value = '' }))
  } })

  const back = h('button', { 'aria-label': t.back, onclick: closeCard }, icon(narrow() ? 'chevron-left' : 'x'))
  const root = h('div', { class: 'stack' },
    h('div', { class: 'head' }, back, column, del),
    title,
    h('section', {}, h('h5', { text: t.tasks }), tasks, taskActions),
    h('section', {}, h('h5', { text: t.links }), links, linkActions, picker, view),
    h('section', {}, h('div', { class: 'row' }, h('h5', { text: t.noteH }), noteButton), noteView, noteEdit),
    h('section', {}, h('h5', { text: t.comments }), comments, commentBox, h('div', {}, commentSend)),
  )
  return { id, root, column, title, tasks, taskActions, links, linkActions, picker, view, noteView, noteEdit, comments, viewing: null, file: null, shownNote: null }
}

async function updateDrawer() {
  const d = drawer
  const card = d && board.cards[d.id]
  if (!card) return
  d.column.replaceChildren(...columnsInOrder(board).map((c) => h('option', { value: c.id, selected: c.id === card.column, text: columnTitle(c) })))
  if (document.activeElement !== d.title) d.title.value = card.title

  d.tasks.replaceChildren(...taskLinks(card).map(([lid, link]) => {
    const row = agentBySession(link.session)
    return h('li', {},
      stateBadge(link),
      h('span', { class: 'what', text: row?.title ?? link.title ?? link.session }),
      h('button', { text: t.open, onclick: () => g.showSession(link.session, { peek: true }).catch((e) => showAlert(e.message)) }),
      h('button', { text: t.handTo, onclick: () => g.compose(t.handText(card), { session: link.session }).catch((e) => showAlert(e.message)) }),
      h('button', { 'aria-label': t.remove, onclick: () => quietly(change({ type: 'link.remove', card: card.id, link: lid })) }, icon('x')),
    )
  }))
  const appState = await g.getAppState().catch(() => null) // the current task is a convenience: without it the button is not offered
  if (drawer !== d) return
  const current = appState?.activeSessionId
  const linked = new Set(taskLinks(card).map(([, l]) => l.session))
  // replaceChildren writes a null as the text "null": leave the absent button out.
  d.taskActions.replaceChildren(...[
    current && !linked.has(current)
      ? h('button', { text: t.attachCurrent, onclick: () => quietly(change({ type: 'link.add', card: card.id, link: { kind: 'task', session: current, ...(agentBySession(current)?.agentId ? { agent: agentBySession(current).agentId } : {}) } })) })
      : null,
    h('button', { text: t.pickTask, onclick: () => pickTask(card) }),
    h('button', { text: t.start, onclick: (e) => startTask(card, e.currentTarget, appState?.activeProjectId) }),
  ].filter(Boolean))

  d.links.replaceChildren(...otherLinks(card).map(([lid, link]) => linkRow(card, lid, link)))
  d.linkActions.replaceChildren(...[
    h('button', { text: t.pickFile, onclick: () => pickTaskFile(card) }),
    h('button', { text: t.pickChatFile, onclick: () => pickChatFile(card) }),
    // A gugu without project folders for Apps has no gugu.projects: the button is not offered there.
    typeof g.projects?.list === 'function' ? h('button', { text: t.pickProjectFile, onclick: () => pickProjectFile(card) }) : null,
    h('button', { text: t.addUrl, onclick: () => addUrl(card) }),
  ].filter(Boolean))

  if (d.noteEdit.hidden && d.shownNote !== card.note) {
    d.shownNote = card.note
    if (card.note) {
      const md = await g.markdown()
      if (drawer !== d) return
      md.render(d.noteView, card.note, { density: 'comfortable' })
    } else {
      d.noteView.replaceChildren()
    }
  }
  const said = Object.values(board.comments).filter((c) => c.card === card.id).sort((a, b) => a.at.localeCompare(b.at))
  d.comments.replaceChildren(...said.map((c) => h('li', { class: 'stack' }, h('small', { class: 'muted' }, byLabel(c.by), ' · ', h('gugu-time', { datetime: c.at })), h('span', { text: c.text }))))
}

function linkRow(card, lid, link) {
  const remove = h('button', { 'aria-label': t.remove, onclick: () => quietly(change({ type: 'link.remove', card: card.id, link: lid })) }, icon('x'))
  const current = drawer.viewing === lid ? 'true' : 'false'
  switch (link.kind) {
    case 'file':
    case 'project':
    case 'chatfile': {
      const name = nameOf(link)
      // Drawn in the card when the App can (md, text, images, video); every file also opens beside the board, in the
      // App that opens it or gugu's own preview.
      return h('li', { 'aria-current': current }, icon('file-text'), h('span', { class: 'what', text: name, title: name }),
        drawable(name) ? h('button', { text: t.show, onclick: () => showFile(lid, link) }) : null,
        h('button', { text: t.openBeside, onclick: () => g.files.openWith(refOf(link), { peek: true }).catch((e) => showAlert(e.message)) }),
        remove)
    }
    case 'message':
      return h('li', {}, icon('message-square'), h('span', { class: 'what', text: link.excerpt ?? link.message }), h('button', { text: t.message, onclick: () => g.showMessage(link.message).catch((e) => showAlert(e.message)) }), remove)
    default:
      return h('li', {}, icon(link.kind === 'pr' ? 'git-pull-request' : 'link'), h('span', { class: 'what', text: `${link.title ?? link.url}${link.state ? ` · ${link.state}` : ''}`, title: link.url }), h('button', { text: t.browser, onclick: () => g.openBrowserTab(link.url).catch((e) => showAlert(e.message)) }), remove)
  }
}

// ── a linked file, shown in the card ─────────────────────────────────────────

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const VIDEO = /\.(mp4|webm|mov|m4v)$/i
const MARKDOWN = /\.(md|markdown|mdx)$/i
const TEXT = /\.(txt|json|jsonc|ya?ml|toml|csv|tsv|log|ini|env|xml|js|mjs|cjs|ts|tsx|jsx|css|scss|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sh|zsh|bash|sql|vue|svelte)$/i

const drawable = (name) => IMAGE.test(name) || VIDEO.test(name) || MARKDOWN.test(name) || TEXT.test(name)
const nameOf = (link) => (link.kind === 'chatfile' ? (link.name ?? link.file) : link.path)
function refOf(link) {
  if (link.kind === 'file') return { session: link.session, id: link.path }
  if (link.kind === 'project') return { project: link.project, id: link.path }
  return { id: link.file }
}

function closeView() {
  if (!drawer) return
  drawer.unbind?.()
  drawer.file?.close()
  if (drawer.url) URL.revokeObjectURL(drawer.url)
  Object.assign(drawer, { file: null, unbind: null, url: null, viewing: null })
  drawer.view.replaceChildren()
}

async function showFile(lid, link) {
  const d = drawer
  if (d.viewing === lid) return closeView()
  closeView()
  d.viewing = lid
  updateDrawer()
  const ref = refOf(link)
  const name = nameOf(link)
  const box = h('div', { class: 'view' })
  d.view.replaceChildren(box)
  try {
    const f = await g.files.open(ref)
    if (drawer !== d || d.viewing !== lid) return f.close()
    d.file = f
    if (IMAGE.test(name) || VIDEO.test(name)) {
      d.url = URL.createObjectURL(await f.blob())
      box.replaceChildren(IMAGE.test(name) ? h('img', { src: d.url, alt: name }) : h('video', { src: d.url, controls: true }))
      return
    }
    const cm = await g.codemirror()
    const editor = (parent) => {
      const view = new cm.EditorView({ parent, extensions: [cm.basicSetup, ...(MARKDOWN.test(name) ? [cm.markdown()] : [])] })
      d.unbind = g.bind.codemirror(view, f)
    }
    if (!MARKDOWN.test(name)) return editor(box)
    // Markdown reads rendered; 编辑 swaps in the editor, bound to the file (others' typing stays).
    const md = await g.markdown()
    const shown = h('div')
    const draw = () => md.render(shown, f.text, { density: 'comfortable', file: f.entry })
    draw()
    const off = f.onChange(draw)
    const edit = h('button', { text: t.edit, onclick: () => {
      off()
      edit.remove()
      shown.remove()
      editor(box)
    } })
    box.replaceChildren(h('div', { class: 'row' }, edit), shown)
  } catch (error) {
    box.replaceChildren(h('p', { role: 'alert', text: error?.message ?? String(error) }))
  }
}

// ── pickers ──────────────────────────────────────────────────────────────────

function openPicker(title, fill) {
  const list = h('ul', { class: 'list' })
  const filter = h('input', { type: 'search', placeholder: t.filter, 'aria-label': t.filter })
  const box = h('div', { class: 'picker' }, h('div', { class: 'row' }, h('strong', { text: title }), h('button', { text: t.cancel, onclick: () => box.remove() })), filter, list)
  drawer.picker.replaceChildren(box)
  filter.focus()
  const done = () => box.remove()
  fill({ list, filter, done }).catch((error) => list.replaceChildren(h('li', { role: 'alert', text: error?.message ?? String(error) })))
}

const recentFirst = (rows) => [...rows].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))

function taskRows(list, filter, onPick) {
  const draw = () => {
    const q = filter.value.trim().toLowerCase()
    const rows = recentFirst(agents).filter((a) => !q || (a.title ?? '').toLowerCase().includes(q)).slice(0, 50)
    list.replaceChildren(...(rows.length
      ? rows.map((a) => h('li', {}, h('button', { class: 'card', onclick: () => onPick(a) }, h('strong', { text: a.title ?? a.sessionId }), h('span', { class: 'meta' }, stateBadge({ session: a.sessionId }), h('span', { text: a.providerId ?? '' })))))
      : [h('li', { class: 'muted', text: t.noTasks })]))
  }
  filter.addEventListener('input', draw)
  draw()
}

function pickTask(card) {
  openPicker(t.pickTask, async ({ list, filter, done }) => {
    taskRows(list, filter, (a) => quietly(change({ type: 'link.add', card: card.id, link: { kind: 'task', session: a.sessionId, agent: a.agentId, ...(a.title ? { title: a.title } : {}) } }).then(done)))
  })
}

function pickTaskFile(card) {
  openPicker(t.chooseTask, async ({ list, filter, done }) => {
    taskRows(list, filter, async (a) => {
      const entries = await g.files.list({ session: a.sessionId }).catch((error) => { showAlert(error.message); return null })
      if (!entries) return
      const files = entries.filter((e) => e.type !== 'folder')
      // The same box now filters this task's files (a fresh input: the task list's listener goes with the old one).
      const fileFilter = h('input', { type: 'search', placeholder: t.filter, 'aria-label': t.filter })
      filter.replaceWith(fileFilter)
      fileFilter.focus()
      const draw = () => {
        const q = fileFilter.value.trim().toLowerCase()
        const rows = files.filter((e) => !q || e.path.toLowerCase().includes(q)).slice(0, 80)
        list.replaceChildren(...(rows.length
          ? rows.map((e) => h('li', {}, h('button', { class: 'card', onclick: () => quietly(change({ type: 'link.add', card: card.id, link: { kind: 'file', session: a.sessionId, path: e.path } }).then(done)) }, h('span', { text: e.path }))))
          : [h('li', { class: 'muted', text: t.noFiles })]))
      }
      fileFilter.addEventListener('input', draw)
      draw()
    })
  })
}

function pickProjectFile(card) {
  openPicker(t.chooseProject, async ({ list, filter, done }) => {
    const { projects } = await g.projects.list()
    const drawProjects = () => {
      const q = filter.value.trim().toLowerCase()
      const rows = projects.filter((p) => !q || p.name.toLowerCase().includes(q))
      list.replaceChildren(...(rows.length
        ? rows.map((p) => h('li', {}, h('button', { class: 'card', onclick: () => pickIn(p) }, h('strong', { text: p.name }))))
        : [h('li', { class: 'muted', text: t.noProjects })]))
    }
    filter.addEventListener('input', drawProjects)
    drawProjects()
    const pickIn = async (project) => {
      const entries = await g.files.list({ project: project.id }).catch((error) => { showAlert(error.message); return null })
      if (!entries) return
      const files = entries.filter((e) => e.type !== 'folder')
      // The same box now filters this project's files (a fresh input: the project list's listener goes with the old one).
      const fileFilter = h('input', { type: 'search', placeholder: t.filter, 'aria-label': t.filter })
      filter.replaceWith(fileFilter)
      fileFilter.focus()
      const draw = () => {
        const q = fileFilter.value.trim().toLowerCase()
        const rows = files.filter((e) => !q || e.path.toLowerCase().includes(q)).slice(0, 80)
        list.replaceChildren(...(rows.length
          ? rows.map((e) => h('li', {}, h('button', { class: 'card', onclick: () => quietly(change({ type: 'link.add', card: card.id, link: { kind: 'project', project: project.id, path: e.path, title: project.name } }).then(done)) }, h('span', { text: `${project.name} / ${e.path}` }))))
          : [h('li', { class: 'muted', text: t.noFiles })]))
      }
      fileFilter.addEventListener('input', draw)
      draw()
    }
  })
}

function pickChatFile(card) {
  openPicker(t.pickChatFile, async ({ list, filter, done }) => {
    const pick = (e) => quietly(change({ type: 'link.add', card: card.id, link: { kind: 'chatfile', file: e.id, name: e.path ?? e.name, ...(e.chat ? { chat: e.chat } : {}) } }).then(done))
    const draw = (entries) => list.replaceChildren(...(entries.length
      ? entries.filter((e) => e.type !== 'folder').map((e) => h('li', {}, h('button', { class: 'card', onclick: () => pick(e) }, h('strong', { text: e.path ?? e.name }), h('span', { class: 'meta', text: e.chatName ?? '' }))))
      : [h('li', { class: 'muted', text: t.noFiles })]))
    // Before anything is typed: this chat's files when the board is open in one, then the ones opened lately; typing
    // searches every chat the person is in.
    const start = async () => {
      const [here, recent] = await Promise.all([ctx.chat ? g.files.list({ chat: ctx.chat.id }) : [], g.files.recent({ limit: 30 })])
      const seen = new Set()
      return [...here, ...recent].filter((e) => !seen.has(e.id) && seen.add(e.id))
    }
    draw(await start())
    let asked = 0
    filter.addEventListener('input', async () => {
      const q = filter.value.trim()
      const mine = ++asked
      const entries = q ? await g.files.search({ query: q, limit: 30 }) : await start()
      if (mine === asked) draw(entries)
    })
  })
}

function addUrl(card) {
  const input = h('input', { type: 'url', placeholder: t.urlPlaceholder, 'aria-label': t.addUrl })
  const add = () => {
    const url = input.value.trim()
    if (!url) return
    const kind = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url) ? 'pr' : 'url'
    quietly(change({ type: 'link.add', card: card.id, link: { kind, url } }).then(() => box.remove()))
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add() })
  const box = h('div', { class: 'row picker' }, input, h('button', { class: 'primary', text: t.ok, onclick: add }), h('button', { text: t.cancel, onclick: () => box.remove() }))
  drawer.picker.replaceChildren(box)
  input.focus()
}

/** 新建任务: a new task of the person's, on this card, started only by their click; it is linked and the card moves to doing. */
async function startTask(card, button, project) {
  button.disabled = true
  button.textContent = t.starting
  try {
    const { agentId } = await g.spawnAgent(t.handText(card), { title: card.title, ...(project ? { project } : {}) })
    const row = (await g.listAgents()).find((a) => a.agentId === agentId)
    if (!row) throw new Error(`the new task (${agentId}) is not in the task list`)
    await change({ type: 'link.add', card: card.id, link: { kind: 'task', session: row.sessionId, agent: agentId, title: card.title } })
    const doing = columnsInOrder(board).find((c) => c.role === 'doing')
    if (doing && card.column !== doing.id) await change({ type: 'card.move', card: card.id, column: doing.id })
  } catch (error) {
    showAlert(error?.message ?? String(error))
  } finally {
    button.disabled = false
    button.textContent = t.start
  }
}

// ── where the page is ────────────────────────────────────────────────────────

function placed() {
  $('attach-box').hidden = !ctx.session
}
placed()

g.onContextChanged(async () => {
  ctx = await g.getContext()
  t = WORDS[String(ctx.locale ?? '').startsWith('zh') ? 'zh' : 'en']
  placed()
  const now = ctx.layout?.visible ?? visible
  // Back on screen: read the board again (an agent's tool call may have changed it meanwhile).
  if (desktop && now && !visible) g.sendToBackground({ type: 'hello' }).catch((e) => showAlert(e.message))
  visible = now
})

if (desktop) {
  g.sendToBackground({ type: 'hello' }).catch((error) => showAlert(error?.message ?? String(error)))
} else {
  $('shell').replaceChildren(h('gugu-empty', { icon: 'monitor' }, h('strong', { text: t.title }), h('small', { text: t.desktopOnly })))
}
