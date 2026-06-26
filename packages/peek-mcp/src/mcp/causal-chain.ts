import type { DomChange, UserAction } from './event-walker.js';
import type { ConsoleErrorRow, NetworkErrorRow } from './queries.js';

export const DOM_CAP = 50;
export const NET_CAP = 20;

export interface TimelineEntry {
  readonly ts: number;
  readonly relMs: number;
  readonly kind: 'action' | 'dom' | 'network' | 'error';
  readonly summary: string;
  readonly ref?: number;
}

export interface CausalChain {
  readonly errorId: number;
  readonly errorTs: number;
  readonly actions: UserAction[];
  readonly error: ConsoleErrorRow;
  readonly windowMs: number;
  readonly domMutations: DomChange[];
  readonly networkErrors: NetworkErrorRow[];
  readonly timeline: TimelineEntry[];
  readonly narrative: string;
  readonly truncated: { domMutations?: boolean; networkErrors?: boolean };
}

export interface BuildCausalChainInput {
  readonly error: ConsoleErrorRow;
  readonly windowMs: number;
  readonly actions: UserAction[];
  readonly domMutations: DomChange[];
  readonly networkErrors: NetworkErrorRow[];
}

function clipStr(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

function keepRecent<T>(rows: T[], cap: number): { kept: T[]; truncated: boolean } {
  return rows.length <= cap
    ? { kept: rows, truncated: false }
    : { kept: rows.slice(rows.length - cap), truncated: true };
}

function domSummary(d: DomChange): string {
  const where = d.target ? ` ${d.target}` : '';
  const attr = d.op === 'attribute' && d.attribute ? ` @${d.attribute}` : '';
  return `${d.op}${where}${attr}`;
}

function netSummary(n: NetworkErrorRow): string {
  const outcome = n.status ?? n.errorText ?? 'error';
  return `${n.method} ${clipStr(n.url, 80)} → ${outcome}`;
}

const KIND_ORDER: Record<TimelineEntry['kind'], number> = {
  action: 0,
  dom: 1,
  network: 2,
  error: 3,
};

function buildNarrative(
  error: ConsoleErrorRow,
  windowMs: number,
  actions: UserAction[],
  domMutations: DomChange[],
  networkErrors: NetworkErrorRow[],
): string {
  const head = `console error #${error.id} (${error.level}: "${clipStr(error.message, 80)}")`;
  if (actions.length === 0 && networkErrors.length === 0 && domMutations.length === 0) {
    return `No user actions, network errors, or DOM mutations in the ${windowMs}ms before ${head}.`;
  }
  let s = `In the ${windowMs}ms before ${head}: ${actions.length} user action(s), ${networkErrors.length} network error(s), ${domMutations.length} DOM mutation(s).`;
  const lastAction = actions[actions.length - 1];
  if (lastAction)
    s += ` Last action: ${lastAction.summary} (${error.ts - lastAction.ts}ms before).`;
  const lastNet = networkErrors[networkErrors.length - 1];
  if (lastNet)
    s += ` Network error: ${lastNet.method} ${clipStr(lastNet.url, 80)} → ${lastNet.status ?? lastNet.errorText ?? 'error'} (${error.ts - lastNet.ts}ms before).`;
  return s;
}

export function buildCausalChain(input: BuildCausalChainInput): CausalChain {
  const { error, windowMs, actions } = input;
  const errorTs = error.ts;
  const dom = keepRecent(input.domMutations, DOM_CAP);
  const net = keepRecent(input.networkErrors, NET_CAP);

  const timeline: TimelineEntry[] = [
    ...actions.map((a, i) => ({
      ts: a.ts,
      relMs: a.ts - errorTs,
      kind: 'action' as const,
      summary: a.summary,
      ref: i,
    })),
    ...dom.kept.map((d, i) => ({
      ts: d.ts,
      relMs: d.ts - errorTs,
      kind: 'dom' as const,
      summary: domSummary(d),
      ref: i,
    })),
    ...net.kept.map((n, i) => ({
      ts: n.ts,
      relMs: n.ts - errorTs,
      kind: 'network' as const,
      summary: netSummary(n),
      ref: i,
    })),
    {
      ts: errorTs,
      relMs: 0,
      kind: 'error' as const,
      summary: `console ${error.level}: ${clipStr(error.message, 80)}`,
    },
  ].sort((x, y) => (x.ts !== y.ts ? x.ts - y.ts : KIND_ORDER[x.kind] - KIND_ORDER[y.kind]));

  const truncated: { domMutations?: boolean; networkErrors?: boolean } = {};
  if (dom.truncated) truncated.domMutations = true;
  if (net.truncated) truncated.networkErrors = true;

  return {
    errorId: error.id,
    errorTs,
    actions,
    error,
    windowMs,
    domMutations: dom.kept,
    networkErrors: net.kept,
    timeline,
    narrative: buildNarrative(error, windowMs, actions, dom.kept, net.kept),
    truncated,
  };
}
