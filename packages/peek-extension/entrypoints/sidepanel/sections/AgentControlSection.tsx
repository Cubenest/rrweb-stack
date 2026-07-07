import { PairedConnectors } from './PairedConnectors';
import { RecentActions } from './RecentActions';
import { TrustDial } from './TrustDial';

/** "Agent control" group: the trust dial + paired-connectors list + recent-actions audit preview. */
export function AgentControlSection({ origin }: { origin: string | null }): React.JSX.Element {
  return (
    <section className="peek-section peek-agent-section" aria-labelledby="peek-agent-heading">
      <h2 id="peek-agent-heading" className="peek-section-title">
        Agent control
      </h2>
      <TrustDial origin={origin} />
      <PairedConnectors />
      <RecentActions />
    </section>
  );
}
