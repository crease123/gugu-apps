// 悬赏论坛: the list of bounties (gugu.bounty.list), the post form (gugu.bounty.create — the host confirms and posts),
// and a row opens its post (gugu.chats.open). Accepting and closing happen in the post itself, on the host's card.
const g = window.gugu
const ctx = await g.getContext()
const en = String(ctx.locale ?? '').startsWith('en')

const T = en
  ? {
      title: 'Bounties', compose: 'Post a bounty',
      fTitle: 'Title', fBody: 'Description', fAmount: 'Reward (points)', fDays: 'Duration', days: (n) => (n === 1 ? '1 day' : `${n} days`),
      fVisibility: 'Visibility', vPublic: 'Public', vPoster: 'Poster only',
      vNote: 'With "Poster only", answers are visible to you alone until the bounty ends.',
      cancel: 'Cancel', post: 'Continue', invalid: 'Fill in the title and description. The reward is 1–100 points.',
      status: { open: 'Open', settled: 'Closed', all: 'All' },
      mine: { '': 'All bounties', posted: 'Posted by me', answered: 'Answered by me' },
      sort: { new: 'Newest', amount: 'Highest reward', deadline: 'Ending soon' },
      search: 'Search bounties', more: 'Load more',
      reward: (n) => `${n} points`, answers: (n) => (n === 1 ? '1 answer' : `${n} answers`), joined: 'Joined',
      visibility: { public: 'Public', poster_only: 'Poster only' },
      endsIn: (t) => `Ends in ${t}`, inGrace: (t) => `Ended. Answers can be accepted for ${t}`,
      ended: { awarded: 'Accepted', refunded: 'Closed. The reward was refunded', burned: 'Closed. The reward was forfeited' },
      dur: { d: (n) => (n === 1 ? '1 day' : `${n} days`), h: (n) => (n === 1 ? '1 hour' : `${n} hours`), m: (n) => (n === 1 ? '1 minute' : `${n} minutes`) },
      by: (name, n) => (n === null ? name : `${name} · ${n} points`),
      empty: 'No bounties yet', emptyHint: 'Post the first one', emptyFiltered: 'No bounties match',
      loadFailed: 'Could not load bounties.', retry: 'Retry', failed: 'Could not complete the action. Try again.',
      openFailed: "This bounty can't be opened.",
    }
  : {
      title: '悬赏', compose: '发布悬赏',
      fTitle: '标题', fBody: '描述', fAmount: '赏金（积分）', fDays: '期限', days: (n) => `${n} 天`,
      fVisibility: '可见范围', vPublic: '公开', vPoster: '仅发布者可见',
      vNote: '选择「仅发布者可见」时，悬赏结束前只有你能看到回答。',
      cancel: '取消', post: '下一步', invalid: '请填写标题和描述，赏金为 1–100 积分。',
      status: { open: '进行中', settled: '已结束', all: '全部' },
      mine: { '': '全部悬赏', posted: '我发布的', answered: '我回答的' },
      sort: { new: '最新', amount: '赏金最高', deadline: '即将截止' },
      search: '搜索悬赏', more: '加载更多',
      reward: (n) => `赏金 ${n} 积分`, answers: (n) => `${n} 条回答`, joined: '已加入',
      visibility: { public: '公开', poster_only: '仅发布者可见' },
      endsIn: (t) => `${t}后截止`, inGrace: (t) => `已截止，可在 ${t} 内采纳`,
      ended: { awarded: '已采纳', refunded: '已结束，赏金已退还', burned: '已结束，赏金已作废' },
      dur: { d: (n) => `${n} 天`, h: (n) => `${n} 小时`, m: (n) => `${n} 分钟` },
      by: (name, n) => (n === null ? name : `${name} · ${n} 积分`),
      empty: '还没有悬赏', emptyHint: '发布第一个悬赏', emptyFiltered: '没有符合条件的悬赏',
      loadFailed: '悬赏列表加载失败。', retry: '重试', failed: '操作未完成，请重试。',
      openFailed: '无法打开该悬赏。',
    }

/**截止后还有 24 小时可以采纳(behavior/bounty.md「到期」)。 */
const GRACE_MS = 24 * 60 * 60 * 1000
const PAGE = 30

const $ = (id) => document.getElementById(id)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'text') el.textContent = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...children.filter((c) => c !== null && c !== undefined))
  return el
}

function duration(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  if (minutes >= 24 * 60) return T.dur.d(Math.floor(minutes / (24 * 60)))
  if (minutes >= 60) return T.dur.h(Math.floor(minutes / 60))
  return T.dur.m(minutes)
}

function stateOf(post, now) {
  if (post.bounty_status !== 'open') return T.ended[post.bounty_status] ?? post.bounty_status
  const deadline = Date.parse(post.deadline_at)
  return now < deadline ? T.endsIn(duration(deadline - now)) : T.inGrace(duration(deadline + GRACE_MS - now))
}

// --- static text ---
document.documentElement.lang = en ? 'en' : 'zh-CN'
document.title = T.title
$('heading').textContent = T.title
$('compose').textContent = T.compose
$('l-title').textContent = T.fTitle
$('l-body').textContent = T.fBody
$('l-amount').textContent = T.fAmount
$('l-days').textContent = T.fDays
$('l-visibility').textContent = T.fVisibility
$('v-public').textContent = T.vPublic
$('v-poster').textContent = T.vPoster
$('v-note').textContent = T.vNote
$('draft-cancel').textContent = T.cancel
$('draft-post').textContent = T.post
$('query').placeholder = T.search
$('query').setAttribute('aria-label', T.search)
$('more').textContent = T.more
$('d-days').replaceChildren(...[1, 3, 7].map((n) => h('option', { value: n, selected: n === 7, text: T.days(n) })))
$('mine').replaceChildren(...Object.entries(T.mine).map(([v, label]) => h('option', { value: v, text: label })))
$('sort').replaceChildren(...Object.entries(T.sort).map(([v, label]) => h('option', { value: v, text: label })))

// --- the list ---
const view = { status: 'open', mine: '', sort: 'new', query: '', posts: [], done: false }
let generation = 0

function renderStatus() {
  $('status').replaceChildren(
    ...Object.entries(T.status).map(([v, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(view.status === v), text: label, onclick: () => { view.status = v; renderStatus(); void load() } }),
    ),
  )
}

function row(post, now) {
  const facts = h(
    'span',
    { class: 'facts' },
    h('span', { class: 'reward', text: T.reward(post.amount) }),
    h('span', { text: T.visibility[post.visibility] ?? post.visibility }),
    h('span', { text: T.answers(post.answer_count) }),
    h('span', { text: stateOf(post, now) }),
    post.is_member ? h('span', { text: T.joined }) : null,
  )
  return h(
    'li',
    { tabindex: '0', role: 'button', 'data-chat': post.chat_id, onclick: (e) => open(e, post), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') open(e, post) } },
    h('gugu-avatar', { label: post.creator_name ?? '', size: 'sm' }),
    h('div', {}, h('strong', { text: post.name }), facts),
    h('div', { class: 'by' }, h('div', { text: T.by(post.creator_name ?? '', post.creator_points ?? null) }), h('gugu-time', { datetime: post.created_at })),
  )
}

function open(event, post) {
  event.preventDefault()
  // A bounty this person cannot read (taken down, or not a bounty at all): the host answers not-found / denied.
  g.chats.open(post.chat_id).catch((error) => showAlert(error, null, error?.code === 'not-found' || error?.code === 'denied' ? T.openFailed : T.failed))
}

function showAlert(error, retry, text = retry ? T.loadFailed : T.failed) {
  const box = $('alert')
  console.error('[bounty]', error)
  box.replaceChildren(h('span', { text }), retry ? h('button', { type: 'button', text: T.retry, onclick: retry }) : null)
  box.hidden = false
}

function render() {
  const now = Date.now()
  $('posts').replaceChildren(...view.posts.map((post) => row(post, now)))
  const filtered = view.query !== '' || view.mine !== '' || view.status !== 'open'
  $('empty').hidden = view.posts.length > 0
  $('empty').replaceChildren(
    h(
      'gugu-empty',
      { icon: 'coins' },
      h('strong', { text: filtered ? T.emptyFiltered : T.empty }),
      filtered ? null : h('small', { text: T.emptyHint }),
      filtered ? null : h('button', { class: 'primary', type: 'button', text: T.compose, onclick: showDraft }),
    ),
  )
  $('more').hidden = view.done
}

async function load(more = false) {
  const mine = ++generation
  try {
    const { posts } = await g.bounty.list({
      query: view.query, sort: view.sort, status: view.status, mine: view.mine || null, limit: PAGE, offset: more ? view.posts.length : 0,
    })
    if (mine !== generation) return
    view.posts = more ? [...view.posts, ...posts] : posts
    view.done = posts.length < PAGE
    $('alert').hidden = true
    render()
  } catch (error) {
    if (mine === generation) showAlert(error, () => void load(more))
  }
}

let typing = 0
$('query').addEventListener('input', () => {
  clearTimeout(typing)
  typing = setTimeout(() => { view.query = $('query').value.trim(); void load() }, 250)
})
$('mine').addEventListener('change', () => { view.mine = $('mine').value; void load() })
$('sort').addEventListener('change', () => { view.sort = $('sort').value; void load() })
$('more').addEventListener('click', () => void load(true))
// A post made, answered or settled elsewhere shows when the page shows again — no polling.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void load() })

// --- the post form: the host draws the confirmation (points move only behind its sheet), posts, and opens the post ---
function showDraft() {
  $('draft').hidden = false
  $('compose').hidden = true
  $('d-title').focus()
}
function hideDraft() {
  $('draft').hidden = true
  $('compose').hidden = false
  $('draft-alert').hidden = true
}
$('compose').addEventListener('click', showDraft)
$('draft-cancel').addEventListener('click', hideDraft)
$('draft').addEventListener('submit', (event) => {
  event.preventDefault()
  const draft = {
    title: $('d-title').value.trim(),
    body: $('d-body').value.trim(),
    amount: Number($('d-amount').value),
    days: Number($('d-days').value),
    visibility: document.querySelector('input[name=visibility]:checked').value,
  }
  const box = $('draft-alert')
  if (!draft.title || !draft.body || !Number.isInteger(draft.amount) || draft.amount < 1 || draft.amount > 100) {
    box.textContent = T.invalid
    box.hidden = false
    return
  }
  box.hidden = true
  g.bounty.create(draft).then(
    () => { $('draft').reset(); hideDraft() },
    (error) => { console.error('[bounty]', error); box.textContent = T.failed; box.hidden = false },
  )
})

renderStatus()
await load()
