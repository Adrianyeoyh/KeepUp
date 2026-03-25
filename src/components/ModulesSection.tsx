import { motion } from "framer-motion";
import { Activity, BookOpen, Wrench, ArrowRight } from "lucide-react";

const modules = [
  {
    icon: Activity,
    name: "FlowGuard Leaks",
    subtitle: "Operational Drift Detection",
    description: "Detect and quantify friction patterns: decision latency, reopen spikes, cycle time drift, and PR review bottlenecks.",
    features: [
      "Max 1-3 insights per day (strict budget)",
      "Evidence links + baseline comparison",
      "Cost estimate in hours/week",
      "Recommended fix with every insight",
    ],
    color: "primary" as const,
  },
  {
    icon: BookOpen,
    name: "FlowGuard Memory",
    subtitle: "Institutional Memory Ledger",
    description: "A git-style truth ledger that captures decisions, action items, and rationale — pointing back to the original source.",
    features: [
      "Decision Commits with DRI + rationale",
      "Action Commits with owner + due date",
      "\"Why trail\" across Slack ↔ Jira ↔ GitHub",
      "Branching for proposals, merging for approval",
    ],
    color: "accent" as const,
  },
  {
    icon: Wrench,
    name: "FlowGuard Remediation",
    subtitle: "Human-Gated Execution",
    description: "When a leak is detected, FlowGuard drafts a fix, shows a change preview, and executes only with approval.",
    features: [
      "Draft → Preview → Approve → Execute",
      "Full audit log + rollback capability",
      "Blast radius limits per action",
      "Role-based approval workflows",
    ],
    color: "success" as const,
  },
];

const colorMap = {
  primary: { dot: "glow-dot", border: "hover:border-primary/30", bg: "bg-primary/10", text: "text-primary" },
  accent: { dot: "glow-dot-accent", border: "hover:border-accent/30", bg: "bg-accent/10", text: "text-accent" },
  success: { dot: "glow-dot-success", border: "hover:border-glow-success/30", bg: "bg-glow-success/10", text: "text-glow-success" },
};

const ModulesSection = () => {
  return (
    <section className="py-28 relative">
      <div className="container max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-accent uppercase tracking-widest">Core Modules</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            Three layers, <span className="text-gradient-primary">one system</span>
          </h2>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-3">
          {modules.map((mod, i) => {
            const colors = colorMap[mod.color];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15, duration: 0.5 }}
                className={`group p-8 rounded-2xl border border-border bg-card shadow-card ${colors.border} transition-all duration-300`}
              >
                <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center mb-5`}>
                  <mod.icon className={`w-6 h-6 ${colors.text}`} />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-1">{mod.name}</h3>
                <p className={`text-sm font-mono ${colors.text} mb-3`}>{mod.subtitle}</p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-5">{mod.description}</p>
                <ul className="space-y-2">
                  {mod.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm">
                      <ArrowRight className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${colors.text}`} />
                      <span className="text-secondary-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ModulesSection;
