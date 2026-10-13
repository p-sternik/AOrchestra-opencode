import { privateClient } from './runtime';
import { metricsRpc, type Run } from '../lib/telemetry';
import {
  reconcileEvaluation,
  evaluationActivity,
  type EvaluationTool,
  type NativeSessionLink,
} from '../lib/eval-report';

export function trajectorySessionIDs(output: string): string[] {
  const ids = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (typeof event.sessionID === 'string' && event.sessionID) ids.add(event.sessionID);
    } catch {}
  }
  return [...ids].sort();
}

// Only use with the per-attempt private DB. Native root identity is also
// available when the CLI fails before emitting any JSONL; never match by time.
export async function readEvaluationUsage(
  cwd: string,
  env: NodeJS.ProcessEnv,
  output: string,
  connect = privateClient,
) {
  const temporary = await connect(cwd, env);
  const { client } = temporary;
  let bootstrap: string | undefined;
  try {
    const roots = await client.session.list({ parentID: null, limit: 2 });
    const moreRoots = roots.cursor.next
      ? await client.session.list({ parentID: null, limit: 1, cursor: roots.cursor.next })
      : undefined;
    if (moreRoots?.data.length || roots.data.length !== 1 || roots.data[0].agent !== 'aorchestra')
      throw new Error('EVALUATION_PRIMARY_AMBIGUOUS');
    const sessionID = roots.data[0].id;
    const trajectoryIDs = trajectorySessionIDs(output);
    if (trajectoryIDs.some((id) => id !== sessionID))
      throw new Error('EVALUATION_TRAJECTORY_SESSION_MISMATCH');
    const family: NativeSessionLink[] = [{ id: sessionID }];
    for (let i = 0; i < family.length; i++) {
      let cursor: string | undefined;
      do {
        const page = await client.session.list({ parentID: family[i].id, limit: 100, cursor });
        for (const child of page.data) {
          if (child.parentID !== family[i].id || family.some((s) => s.id === child.id))
            throw new Error('EVALUATION_CHILD_IDENTITY_MISMATCH');
          family.push({ id: child.id, parentID: child.parentID });
        }
        cursor = page.cursor.next ?? undefined;
      } while (cursor);
    }
    // Initialize the location plugin for its read-only RPC. This session never
    // receives a prompt, and is excluded from the family above.
    bootstrap = (await client.session.create({ location: { directory: cwd } })).id;
    const rpc = client.rpc(metricsRpc);
    const records: Run[] = [];
    let cursor: string | undefined;
    do {
      let page: { version: 1; runs: Run[]; next: string | null } | undefined;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          page = (await rpc.list(
            { after: cursor, limit: 500 },
            { location: { directory: cwd } },
          )) as typeof page;
          break;
        } catch (error) {
          if (
            !['rpc.unavailable', 'rpc.method_not_found'].includes(
              (error as { type?: string }).type ?? '',
            ) ||
            attempt === 19
          )
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!page) throw new Error('EVALUATION_METRICS_UNAVAILABLE');
      records.push(...page.runs);
      cursor = page.next ?? undefined;
    } while (cursor);
    let tools: EvaluationTool[] | null = null;
    const activityIssues: string[] = [];
    try {
      const unique = new Map<string, EvaluationTool>();
      let after: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.message.list({ sessionID, limit: 100, cursor: after });
        for (const message of page.data) {
          if (message.type !== 'assistant') continue;
          for (const part of message.content) if (part.type === 'tool') unique.set(part.id, part);
        }
        after = page.cursor.next ?? undefined;
        if (after && cursors.has(after)) throw new Error('EVALUATION_MESSAGE_CURSOR_REPEATED');
        if (after) cursors.add(after);
      } while (after);
      tools = [...unique.values()];
    } catch {
      activityIssues.push('native-tool-history-unavailable');
    }
    const reconciled = reconcileEvaluation(sessionID, records, family);
    return {
      sessionID,
      nativeOutcome: roots.data[0].outcome ?? null,
      family,
      records: records.filter((r) => r.sessionID === sessionID),
      ...reconciled,
      ...evaluationActivity(reconciled.run, tools),
      nativeDelegationCalls:
        tools?.filter((t) => ['aorchestra_delegate', 'subagent'].includes(t.name)).length ?? 0,
      activityIssues,
    };
  } finally {
    if (bootstrap) await client.session.remove({ sessionID: bootstrap }).catch(() => {});
    await temporary.close();
  }
}

// Prepare a native root session in the attempt DB. The CLI resumes this session;
// neither strategy gets an additional model loop or a different agent.
export async function prepareEvaluationSession(
  cwd: string,
  env: NodeJS.ProcessEnv,
  strategy: import('../lib/eval-report').Strategy,
  model: string,
  connect = privateClient,
) {
  const temporary = await connect(cwd, env);
  const { client } = temporary;
  try {
    const { Model } = await import('@opencode/plugin');
    // Session creation initializes location configuration/plugins on a fresh DB.
    // No prompt is sent until the persisted permission restriction is verified.
    const session = await client.session.create({
      agent: 'aorchestra',
      location: { directory: cwd },
      model: Model.Ref.parse(model),
    });
    let primary: Awaited<ReturnType<typeof client.agent.list>>['data'][number] | undefined;
    let loaded = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const [agents, plugins] = await Promise.all([
        client.agent.list({ location: { directory: cwd } }),
        client.plugin.list({ location: { directory: cwd } }),
      ]);
      primary = agents.data.find((a) => a.id === 'aorchestra');
      loaded =
        plugins.data.filter((p) => p.id === 'aorchestra' && p.state.status === 'active').length ===
        1;
      if (primary && loaded) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!primary || !loaded) throw new Error('EVALUATION_HARNESS_NOT_READY');
    const configs = await client.config.get({ location: { directory: cwd } });
    const documents = configs.filter((c) => c.type === 'document').map((c) => c.info);
    const permissions = evaluationPermissions(primary.permissions, strategy);
    await client.session.update({ sessionID: session.id, permissions });
    for (const action of ['aorchestra_delegate', 'subagent']) {
      if (strategy !== 'direct') break;
      const decision = await client.permission.create({
        sessionID: session.id,
        action,
        resources: ['*'],
      });
      if (decision.effect === 'ask')
        await client.permission.reply({
          sessionID: session.id,
          requestID: decision.id,
          decision: 'reject',
        });
      if (decision.effect !== 'deny') throw new Error('EVALUATION_DIRECT_PERMISSION_NOT_ENFORCED');
    }
    return {
      sessionID: session.id,
      settings: { primary, documents },
      permissions,
      directRestrictionEnforced: strategy === 'direct',
    };
  } finally {
    await temporary.close();
  }
}

export function evaluationPermissions(
  permissions: Array<{ action: string; resource: string; effect: 'allow' | 'deny' | 'ask' }>,
  strategy: import('../lib/eval-report').Strategy,
) {
  return [
    ...permissions,
    ...(strategy === 'direct'
      ? ['aorchestra_delegate', 'subagent'].map((action) => ({
          action,
          resource: '*',
          effect: 'deny' as const,
        }))
      : []),
  ];
}
