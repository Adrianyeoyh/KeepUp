import { motion } from "framer-motion";
import { Shield, Eye, Volume2, Lock, Undo2 } from "lucide-react";

const principles = [
  { icon: Eye, title: "Metadata-first", desc: "No message content stored long-term. Aggregate, team-level insights only." },
  { icon: Volume2, title: "Strict insight budget", desc: "1-3 per day max. Below-threshold signals go to weekly report." },
  { icon: Lock, title: "Human-gated execution", desc: "Draft → Preview → Approve → Execute. No autonomous changes." },
  { icon: Shield, title: "Blast radius limits", desc: "Project, channel, and field-level constraints on every action." },
  { icon: Undo2, title: "Full audit + rollback", desc: "Every executed action logged. Rollback available where possible." },
];

const TrustSection = () => {
  return (
    <section className="py-28 relative">
      <div className="absolute inset-0 bg-glow opacity-30" />
      <div className="container max-w-5xl mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-accent uppercase tracking-widest">Trust & Safety</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            Built for <span className="text-gradient-primary">trust</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            No employee ranking. No autonomous execution. Full transparency on what triggers what.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {principles.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="p-5 rounded-xl border border-border bg-card shadow-card flex items-start gap-4"
            >
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <p.icon className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm mb-1">{p.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustSection;
