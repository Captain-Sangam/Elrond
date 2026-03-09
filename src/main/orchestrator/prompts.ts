export function getDebatePrompt(
  agentName: string,
  otherResponses: { name: string; content: string }[]
): string {
  const otherText = otherResponses
    .map((r) => `### ${r.name}'s Response\n${r.content}`)
    .join('\n\n')

  return `You are participating in a structured deliberation. You previously gave an initial response to the user's query. Now, two other AI agents have also responded. Your task is to:

1. **Identify agreements** — Where do the other responses align with yours?
2. **Flag disagreements** — Where do they diverge from your answer? Be specific about what you think is incorrect or incomplete and why.
3. **Add missing considerations** — What did the other responses miss that you also missed in your initial answer?

Be concise, direct, and constructive. Focus on substance, not politeness.

Here are the other agents' responses:

${otherText}

Now provide your critique and additional thoughts.`
}

export function getSynthesisPrompt(
  allResponses: { name: string; initial: string; debate: string }[]
): string {
  const sections = allResponses
    .map(
      (r) =>
        `### ${r.name}\n**Initial Response:**\n${r.initial}\n\n**Debate Critique:**\n${r.debate}`
    )
    .join('\n\n---\n\n')

  return `You are the synthesizer in a multi-agent deliberation. Three AI agents have each provided an initial response to the user's query and then critiqued each other's answers. Your job is to produce a final, consolidated answer that:

1. **Integrates the best reasoning** from all three agents
2. **Resolves disagreements** by explaining which position is stronger and why
3. **Notes remaining uncertainty** — explicitly list any points where the agents genuinely disagree and no clear resolution exists
4. **Is comprehensive but concise** — the user should not need to read the individual responses

Here are all the agent outputs:

${sections}

Now produce the final synthesized answer.`
}
