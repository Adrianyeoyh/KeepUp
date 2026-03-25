import { motion } from "framer-motion";
import { MessageSquare, AlertCircle, GitBranch, Clock, Code2 } from "lucide-react";

const rules = [
  {
    icon: MessageSquare,
    name: "Decision Drift",
    source: "Slack",
    trigger: "Thread > N messages OR unresolved > T hours, decision keywords detected",
    fix: "Ask for DRI + propose Decision Commit with summary",
  },
  {
    icon: AlertCircle,
    name: "Unlogged Action Items",
    source: "Slack",
    trigger: "Thread ends with implied tasks but no ticket created within 24h",
    fix: "Generate Action Commits with owners + due dates",
  },
  {
    icon: GitBranch,
    name: "Jira Reopen Spike",
    source: "Jira",
    trigger: "Reopen rate > threshold OR status bounce > 2",
    fix: "Propose ticket template diff with required fields",
  },
  {
    icon: Clock,
    name: "Cycle Time Drift",
    source: "Jira",
    trigger: "Cycle time +X% vs baseline, bottleneck at same status",
    fix: "SLA reminders + clarify approval ownership",
  },
  {
    icon: Code2,
    name: "PR Review Bottleneck",
    source: "GitHub",
    trigger: "PR open > T days OR review time > baseline",
    fix: "Review rotation policy + auto-ping rules",
  },
];

const sourceColors: Record<string, string> = {
  Slack: "text-primary bg-primary/10",
  Jira: "text-accent bg-accent/10",
  GitHub: "text-glow-success bg-glow-success/10",
};

const GoldenRulesSection = () => {
  return (
    <section className="py-28 relative">
      <div className="container max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-accent uppercase tracking-widest">Detection Rules</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            5 rules. <span className="text-gradient-primary">Ship first.</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            We start with exactly 5 detection rules — each proven to surface real, actionable friction.
          </p>
        </motion.div>

        <div className="space-y-4">
          {rules.map((rule, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-5 rounded-xl border border-border bg-card shadow-card"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <rule.icon className="w-5 h-5 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-foreground">{rule.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${sourceColors[rule.source]}`}>
                      {rule.source}
                    </span>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-mono text-muted-foreground mb-1">TRIGGER</p>
                      <p className="text-sm text-secondary-foreground">{rule.trigger}</p>
                    </div>
                    <div>
                      <p className="text-xs font-mono text-muted-foreground mb-1">DRAFT FIX</p>
                      <p className="text-sm text-secondary-foreground">{rule.fix}</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default GoldenRulesSection;
