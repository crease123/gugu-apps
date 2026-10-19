/**
 * 看板 — background page: the one place the pages talk to.
 *
 * - The board: a page's change comes here (sendToBackground), goes to the App's program (callProgram 'apply', the
 *   board's only writer), and the board that comes back goes to every page (broadcastToViews). A page never calls the
 *   program itself: in a tab of a task on another computer that call would run on that computer, with its board. This
 *   page always runs on this one.
 * - The tasks: this computer's agents (listAgents), sent to every page whenever one moves (onAgentsChanged), so each
 *   card shows its task's status.
 * - An agent's change through a tool: gugu sends `tools/called` after every tools.js call, and the board is read again.
 *   A gugu too old to send it still has the board read again when a page shows again and when an agent moves — never
 *   on a timer.
 */

const g = window.gugu
let board = null
let agents = []
const failure = { board: null, agents: null }

function parse(answer) {
  const text = answer?.content?.find((part) => part.type === 'text')?.text ?? ''
  if (answer?.isError) throw new Error(text || 'the board program answered with an error')
  return JSON.parse(text)
}

const send = (message) =>
  g.broadcastToViews(message).catch((error) => g.reportError(`看板 could not reach its pages: ${error?.message ?? error}`))

const say = () => send({ type: 'state', board, agents, failure })

async function readBoard() {
  try {
    board = parse(await g.callProgram('snapshot'))
    failure.board = null
  } catch (error) {
    failure.board = error?.message ?? String(error)
    g.reportError(`看板 could not read the board: ${failure.board}`)
  }
}

async function readAgents() {
  try {
    agents = (await g.listAgents()).filter((row) => !row.deviceId)
    failure.agents = null
    // The App's program has no listAgents (a program's gugu has only a page's own verbs): its tools read this snapshot,
    // written here whenever the tasks move. It is not the board — board.json still has one writer, the program.
    const rows = agents.map(({ agentId, sessionId, title, status, detail, failure: f }) => ({ agentId, sessionId, title, status, detail, failure: f ? { kind: f.kind } : null }))
    await g.writeData('agents.json', JSON.stringify({ at: new Date().toISOString(), agents: rows }))
  } catch (error) {
    // The board still works without statuses; the pages say why there are none.
    agents = []
    failure.agents = error?.message ?? String(error)
    g.reportError(`看板 could not read this computer's tasks: ${failure.agents}`)
  }
}

g.onViewMessage(async (message) => {
  if (message?.type === 'hello') {
    await Promise.all([readBoard(), readAgents()])
    return say()
  }
  if (message?.type === 'op') {
    try {
      const answer = parse(await g.callProgram('apply', { op: message.op }))
      board = answer.board
      await send({ type: 'state', board, agents, failure, done: { id: message.id, result: answer.result } })
    } catch (error) {
      await send({ type: 'refused', id: message.id, message: error?.message ?? String(error) })
    }
  }
})

let moving = null
g.onAgentsChanged(() => {
  // Several agents moving at once is one read.
  if (moving) return
  moving = Promise.all([readAgents(), readBoard()]).then(say).finally(() => (moving = null))
})

// After every tools.js call gugu says which tool ran. The board page's own calls are already broadcast above; an
// agent's tool call is not, so the board is read again.
g.onProgramNotification(({ method, params }) => {
  if (method === 'tools/called' && params?.tool !== 'apply' && params?.tool !== 'snapshot') readBoard().then(say)
})

await Promise.all([readBoard(), readAgents()])
await say()
