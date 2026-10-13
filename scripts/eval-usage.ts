import { privateClient } from './runtime';
import { metricsRpc, type Run } from '../lib/telemetry';
import { reconcileEvaluation, type NativeSessionLink } from '../lib/eval-report';

export function trajectorySessionIDs(output: string): string[] {
  const ids = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    try { const event = JSON.parse(line); if (typeof event.sessionID === 'string' && event.sessionID) ids.add(event.sessionID); } catch {}
  }
  return [...ids].sort();
}

// Only use with the per-attempt private DB. Native root identity is also
// available when the CLI fails before emitting any JSONL; never match by time.
export async function readEvaluationUsage(cwd: string, env: NodeJS.ProcessEnv, output: string, connect = privateClient) {
  const temporary = await connect(cwd, env);
  const { client } = temporary;
  let bootstrap: string | undefined;
  try {
    const roots = await client.session.list({parentID:null,limit:2});
    const moreRoots = roots.cursor.next ? await client.session.list({parentID:null,limit:1,cursor:roots.cursor.next}) : undefined;
    if (moreRoots?.data.length || roots.data.length !== 1 || roots.data[0].agent !== 'aorchestra') throw new Error('EVALUATION_PRIMARY_AMBIGUOUS');
    const sessionID = roots.data[0].id;
    const trajectoryIDs = trajectorySessionIDs(output);
    if (trajectoryIDs.some(id => id !== sessionID)) throw new Error('EVALUATION_TRAJECTORY_SESSION_MISMATCH');
    const family: NativeSessionLink[] = [{id:sessionID}];
    for (let i = 0; i < family.length; i++) {
      let cursor: string | undefined;
      do {
        const page = await client.session.list({parentID:family[i].id,limit:100,cursor});
        for (const child of page.data) {
          if (child.parentID !== family[i].id || family.some(s => s.id === child.id)) throw new Error('EVALUATION_CHILD_IDENTITY_MISMATCH');
          family.push({id:child.id,parentID:child.parentID});
        }
        cursor = page.cursor.next ?? undefined;
      } while (cursor);
    }
    // Initialize the location plugin for its read-only RPC. This session never
    // receives a prompt, and is excluded from the family above.
    bootstrap = (await client.session.create({location:{directory:cwd}})).id;
    const rpc = client.rpc(metricsRpc);
    const records: Run[] = [];
    let cursor: string | undefined;
    do {
      let page: {version:1;runs:Run[];next:string|null} | undefined;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { page = await rpc.list({after:cursor,limit:500},{location:{directory:cwd}}) as typeof page; break; }
        catch (error) {
          if (!['rpc.unavailable','rpc.method_not_found'].includes((error as {type?:string}).type ?? '') || attempt === 19) throw error;
          await new Promise(resolve => setTimeout(resolve,250));
        }
      }
      if (!page) throw new Error('EVALUATION_METRICS_UNAVAILABLE');
      records.push(...page.runs); cursor = page.next ?? undefined;
    } while (cursor);
    return {sessionID,nativeOutcome:roots.data[0].outcome??null,family,records:records.filter(r => r.sessionID === sessionID),...reconcileEvaluation(sessionID,records,family)};
  } finally {
    if (bootstrap) await client.session.remove({sessionID:bootstrap}).catch(()=>{});
    await temporary.close();
  }
}
