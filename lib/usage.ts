import type { Counters, Run } from './telemetry';

export interface WorkflowUsage {
  costUSD: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  complete: boolean;
  missingSessions: string[];
}

// Run counters are primary deltas and fresh child-session totals. Never add a
// cumulative primary-session total to these deltas.
export function workflowUsage(run: Run): WorkflowUsage {
  const sessions = [{ sessionID: run.sessionID, usage: run.primaryUsage }, ...run.children];
  const fields: Array<keyof Counters> = ['cost', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'];
  const measured = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const unique = new Map<string, Counters | null>();
  const conflicts = new Set<string>();
  for (const session of sessions) {
    if (unique.has(session.sessionID) && fields.some(k => unique.get(session.sessionID)?.[k] !== session.usage?.[k])) conflicts.add(session.sessionID);
    else unique.set(session.sessionID, session.usage);
  }
  const sum = (key: keyof Counters): number | null => {
    if (conflicts.size || [...unique.values()].some(u => !measured(u?.[key]))) return null;
    return [...unique.values()].reduce((total, u) => total + u![key]!, 0);
  };
  const costUSD = sum('cost'), inputTokens = sum('input'), outputTokens = sum('output');
  const reasoningTokens = sum('reasoning'), cacheReadTokens = sum('cacheRead'), cacheWriteTokens = sum('cacheWrite');
  const tokens = [inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens];
  // Native V2 normalizes output to visibleOutputTokens (output minus reasoning)
  // and input to nonCachedInputTokens; reasoning and both cache fields are separate.
  const totalTokens = tokens.every((n): n is number => n !== null) ? tokens.reduce((a, b) => a + b, 0) : null;
  const missingSessions = [...unique].filter(([id, u]) => conflicts.has(id) || fields.some(k => !measured(u?.[k]))).map(([id]) => id).sort();
  return { costUSD, inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, totalTokens, complete: missingSessions.length === 0, missingSessions };
}
