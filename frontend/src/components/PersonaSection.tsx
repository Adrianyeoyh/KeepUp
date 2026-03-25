import { motion } from "framer-motion";
import { TrendingDown, Target } from "lucide-react";

const metrics = [
  { label: "Jira reopen rate", direction: "↓", color: "text-glow-success" },
  { label: "Cycle time", direction: "↓", color: "text-glow-success" },
  { label: "PR review time", direction: "↓", color: "text-glow-success" },
  { label: "Decision latency", direction: "↓", color: "text-glow-success" },
];

const personas = [
  {
    role: "CEO / Founder",
    emoji: "🎯",
    questions: [
      "Are we slowing down? Why? What's the cost?",
      "What one fix gives me the biggest leverage this week?",
      "Show me before/after improvement.",
    ],
    output: "Executive narrative: 3 bullets/day max, cost estimates, trend comparison",
  },
  {
    role: "Head of Engineering",
    emoji: "⚙️",
    questions: [
      "Where is work getting stuck and why?",
      "Where is rework coming from?",
      "How do we reduce decision churn without adding process?",
    ],
    output: "Engineering drill-down: evidence links, recommended changes, metric baselines",
  },
];

const PersonaSection = () => {
  return (
    <section className="py-28 relative">
      <div className="container max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-primary uppercase tracking-widest">Built For</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            Same outcomes, <span className="text-gradient-primary">different zoom</span>
          </h2>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2 mb-16">
          {personas.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="p-8 rounded-2xl border border-border bg-card shadow-card"
            >
              <div className="text-3xl mb-4">{p.emoji}</div>
              <h3 className="text-xl font-bold text-foreground mb-4">{p.role}</h3>
              <div className="space-y-3 mb-6">
                {p.questions.map((q, j) => (
                  <p key={j} className="text-sm text-muted-foreground italic">"{q}"</p>
                ))}
              </div>
              <div className="p-4 rounded-lg bg-surface-elevated border border-border">
                <p className="text-xs font-mono text-primary mb-1">FlowGuard Output</p>
                <p className="text-sm text-secondary-foreground">{p.output}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Success metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <h3 className="text-xl font-bold text-foreground mb-2 flex items-center justify-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Success = proof on one metric
          </h3>
        </motion.div>
        
        <div className="flex flex-wrap justify-center gap-4">
          {metrics.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="px-5 py-3 rounded-xl border border-border bg-card shadow-card flex items-center gap-3"
            >
              <TrendingDown className="w-4 h-4 text-glow-success" />
              <span className="text-sm font-semibold text-foreground">{m.label}</span>
              <span className={`font-mono text-sm ${m.color}`}>{m.direction}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PersonaSection;
