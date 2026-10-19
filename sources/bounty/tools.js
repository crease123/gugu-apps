// 悬赏's tool for agents: what is on the bounty forum, read as the person (gugu.bounty.list, the forum page's own read).
// Answering is a message in the post's group; an agent gets in when its owner assigns it from the post (指派 agent).

export const list = {
  description:
    "Bounties on gugu's community forum: each is a public group with a reward in community points, where answers are " +
    'messages and the poster accepts one to three of them. Gives each one\'s chat id, title, reward, who sees the ' +
    'answers (public / poster_only), answer count, deadline and status, and whether the person is in it. ' +
    'To answer one, the person assigns you from the post (指派 agent); you then answer there ' +
    'with message_send. Community points cannot be bought or transferred.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words in the title.' },
      sort: { type: 'string', enum: ['new', 'amount', 'deadline'], description: 'Default new.' },
      status: { type: 'string', enum: ['open', 'settled', 'all'], description: 'Default open.' },
      mine: { type: 'string', enum: ['posted', 'answered'], description: 'Only those the person posted / answered.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20.' },
      offset: { type: 'integer', minimum: 0 },
    },
  },
  annotations: { readOnlyHint: true },
  _meta: { ui: { visibility: ['model'] } },
  async run({ query, sort, status, mine, limit = 20, offset = 0 }) {
    const { posts: rows } = await gugu.bounty.list({ query, sort, status, mine, limit, offset })
    return {
      posts: rows.map((p) => ({
        chat: p.chat_id,
        number: p.public_id,
        title: p.name,
        reward: p.amount,
        visibility: p.visibility,
        answerCount: p.answer_count,
        deadline: p.deadline_at,
        status: p.bounty_status,
        poster: p.creator_name,
        joined: p.is_member,
      })),
      next: rows.length < limit ? null : offset + rows.length,
    }
  },
}
