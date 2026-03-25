import { motion } from "framer-motion";
import { GitCommit, GitBranch, GitMerge, Diff } from "lucide-react";

const primitives = [
  {
    icon: GitCommit,
    git: "Commit",
    flowguard: "Memory Anchor",
    desc: "A Decision Commit or Action Commit. Contains summary, rationale, DRI, evidence links, and timestamp.",
  },
  {
    icon: GitBranch,
    git: "Branch",
    flowguard: "Alternative Proposal",
    desc: "Option A vs Option B. Experiment branches. Architecture decision alternatives. Incident workarounds.",
  },
  {
    icon: GitMerge,
    git: "Merge",
    flowguard: "Approved & Canonical",
    desc: "When leadership approves, it becomes mainline truth — linked back into Jira, Confluence, or Notion.",
  },
  {
    icon: Diff,
    git: "Diff",
    flowguard: "What Changed?",
    desc: "Show execs: decisions made, scope changes, ownership changes, and SLA modifications since last week.",
  },
];

const GitLedgerSection = () => {
  return (
    <section className="py-28 relative">
      <div className="container max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-glow-success uppercase tracking-widest">Truth Ledger</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            Git for <span className="text-gradient-primary">decisions</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A version-controlled history of what was decided, why, and who owns it. 
            Points back to Slack/Jira/GitHub — never replaces them.
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2">
          {primitives.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="p-6 rounded-xl border border-border bg-card shadow-card flex gap-5"
            >
              <div className="w-12 h-12 rounded-xl bg-glow-success/10 flex items-center justify-center shrink-0">
                <p.icon className="w-6 h-6 text-glow-success" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm text-glow-success">{p.git}</span>
                  <span className="text-muted-foreground text-sm">→</span>
                  <span className="font-semibold text-foreground text-sm">{p.flowguard}</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Commit example */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-12 rounded-2xl border border-glow-success/20 bg-card shadow-card overflow-hidden"
        >
          <div className="px-6 py-3 border-b border-border bg-glow-success/5 flex items-center gap-2">
            <GitCommit className="w-4 h-4 text-glow-success" />
            <span className="font-mono text-sm text-glow-success">Decision Commit</span>
            <span className="text-xs text-muted-foreground ml-auto font-mono">main · 2h ago</span>
          </div>
          <div className="p-6 font-mono text-sm space-y-2">
            <div><span className="text-muted-foreground">title:</span> <span className="text-foreground">Migrate auth to OAuth2 provider</span></div>
            <div><span className="text-muted-foreground">decision:</span> <span className="text-foreground">Use Auth0 over Firebase Auth</span></div>
            <div><span className="text-muted-foreground">rationale:</span> <span className="text-secondary-foreground">Better enterprise SSO support, team already has Auth0 experience</span></div>
            <div><span className="text-muted-foreground">DRI:</span> <span className="text-primary">@sarah.chen</span></div>
            <div><span className="text-muted-foreground">evidence:</span> <span className="text-primary underline cursor-pointer">#platform-arch:t1234</span> · <span className="text-primary underline cursor-pointer">PLAT-342</span></div>
            <div><span className="text-muted-foreground">status:</span> <span className="text-glow-success">merged ✓</span></div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default GitLedgerSection;
