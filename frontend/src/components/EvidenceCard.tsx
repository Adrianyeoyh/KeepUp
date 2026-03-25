import { ExternalLink, MessageSquare, GitPullRequest, Ticket, Hash, Globe } from "lucide-react";

interface EvidenceLink {
  title?: string;
  url: string;
  entity_id?: string;
}

interface EvidenceCardProps {
  link: EvidenceLink;
}

/**
 * Cross-tool evidence card — replaces plain URLs with rich, provider-aware cards.
 * Detects the source tool from the URL and displays an appropriate icon + label.
 */
export function EvidenceCard({ link }: EvidenceCardProps) {
  const info = detectProvider(link);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 p-2 rounded-md bg-gray-800/60 border border-gray-700/50 hover:border-gray-600 hover:bg-gray-800 transition-all group"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-center w-7 h-7 rounded shrink-0"
        style={{ backgroundColor: info.bgColor }}
      >
        <info.Icon className="h-3.5 w-3.5" style={{ color: info.iconColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-300 truncate group-hover:text-gray-200">
          {link.title || info.label}
        </p>
        <p className="text-[10px] text-gray-500 truncate">{info.detail}</p>
      </div>
      <ExternalLink className="h-3 w-3 text-gray-600 group-hover:text-gray-400 shrink-0" />
    </a>
  );
}

interface ProviderInfo {
  Icon: typeof Globe;
  label: string;
  detail: string;
  bgColor: string;
  iconColor: string;
}

function detectProvider(link: EvidenceLink): ProviderInfo {
  const url = link.url;

  // Slack
  if (url.includes('slack.com') || url.includes('slack://')) {
    const channelMatch = url.match(/#([A-Za-z0-9_-]+)/);
    return {
      Icon: MessageSquare,
      label: channelMatch ? `#${channelMatch[1]}` : 'Slack thread',
      detail: link.entity_id || 'Slack conversation',
      bgColor: 'rgba(74, 21, 75, 0.3)',
      iconColor: '#e01e5a',
    };
  }

  // GitHub
  if (url.includes('github.com')) {
    const prMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    const issueMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
    if (prMatch) {
      return {
        Icon: GitPullRequest,
        label: `PR #${prMatch[2]}`,
        detail: prMatch[1],
        bgColor: 'rgba(13, 17, 23, 0.5)',
        iconColor: '#58a6ff',
      };
    }
    if (issueMatch) {
      return {
        Icon: Hash,
        label: `Issue #${issueMatch[2]}`,
        detail: issueMatch[1],
        bgColor: 'rgba(13, 17, 23, 0.5)',
        iconColor: '#3fb950',
      };
    }
    return {
      Icon: GitPullRequest,
      label: 'GitHub',
      detail: url.replace('https://github.com/', ''),
      bgColor: 'rgba(13, 17, 23, 0.5)',
      iconColor: '#8b949e',
    };
  }

  // Jira (Atlassian)
  if (url.includes('atlassian.net') || url.includes('jira')) {
    const keyMatch = url.match(/browse\/([A-Z][A-Z0-9]+-\d+)/) || link.entity_id?.match(/^([A-Z][A-Z0-9]+-\d+)$/);
    return {
      Icon: Ticket,
      label: keyMatch ? keyMatch[1] : 'Jira issue',
      detail: link.entity_id || 'Jira',
      bgColor: 'rgba(0, 82, 204, 0.15)',
      iconColor: '#2684ff',
    };
  }

  // Generic / unknown
  return {
    Icon: Globe,
    label: link.title || 'External link',
    detail: new URL(url).hostname,
    bgColor: 'rgba(107, 114, 128, 0.2)',
    iconColor: '#9ca3af',
  };
}

/**
 * Evidence card list — renders an array of evidence links as rich cards.
 */
export function EvidenceCardList({ links }: { links: EvidenceLink[] }) {
  if (!links || links.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {links.map((link, i) => (
        <EvidenceCard key={i} link={link} />
      ))}
    </div>
  );
}
