import type { IssueSummary } from '@/lib/api'

/** What Claude Code's prompt box starts with: enough to find the ticket, and what to do with it. */
export function workPrompt(issue: IssueSummary, site: string): string {
  return [
    `Work on Jira ticket ${issue.key}: ${issue.summary}`,
    `${site}/browse/${issue.key}`,
    '',
    'First read the ticket (description, comments, linked issues) with the Atlassian tools, summarise what it asks for, and propose a plan before changing any code.',
  ].join('\n')
}
