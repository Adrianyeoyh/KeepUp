import { motion } from "framer-motion";
import { Search, Brain, FileEdit, CheckCircle, Play, BarChart3 } from "lucide-react";

const steps = [
  { icon: Search, label: "Detect", desc: "Observe how work moves across Slack, Jira & GitHub" },
  { icon: Brain, label: "Diagnose", desc: "Identify root causes with evidence-linked explanations" },
  { icon: FileEdit, label: "Draft Fix", desc: "Generate targeted remediation within existing tools" },
  { icon: CheckCircle, label: "Approve", desc: "Human reviews the change preview (diff)" },
  { icon: Play, label: "Execute", desc: "Apply approved changes with audit trail + rollback" },
  { icon: BarChart3, label: "Measure", desc: "Quantify improvement against baselines" },
];

const PipelineSection = () => {
  return (
    <section className="py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-glow opacity-50" />
      <div className="container max-w-6xl mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-primary uppercase tracking-widest">How It Works</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            A closed-loop <span className="text-gradient-primary">operations co-pilot</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Not a dashboard. A pipeline that finds problems, proposes fixes, and measures results.
          </p>
        </motion.div>

        <div className="relative">
          {/* Connection line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-px bg-border -translate-y-1/2" />
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="relative flex flex-col items-center text-center"
              >
                <div className="w-14 h-14 rounded-xl bg-card border border-border flex items-center justify-center mb-4 relative z-10 shadow-card group-hover:border-primary transition-colors">
                  <step.icon className="w-6 h-6 text-primary" />
                </div>
                <span className="text-xs font-mono text-primary mb-1">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="font-semibold text-foreground mb-1">{step.label}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default PipelineSection;
