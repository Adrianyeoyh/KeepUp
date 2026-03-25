import { motion } from "framer-motion";
import { Clock, RotateCcw, MessageSquare, Users, GitBranch } from "lucide-react";

const problems = [
  {
    icon: Clock,
    pain: "We're moving slower, but I can't pinpoint why.",
    cause: "Decision latency compounds across threads and tools — invisible until it's a crisis.",
  },
  {
    icon: RotateCcw,
    pain: "Tickets keep getting reopened.",
    cause: "Ambiguous requirements and missing acceptance criteria create rework loops.",
  },
  {
    icon: MessageSquare,
    pain: "We keep repeating the same discussions.",
    cause: "Decisions scatter across Slack, Jira, and GitHub — no one records the outcome.",
  },
  {
    icon: Users,
    pain: "When people leave, everything breaks.",
    cause: "Organizational memory decays with turnover — new members re-interpret intent.",
  },
  {
    icon: GitBranch,
    pain: "Nobody owns the decision.",
    cause: "Cross-tool fragmentation means accountability falls through the cracks.",
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const ProblemSection = () => {
  return (
    <section className="py-28 relative">
      <div className="container max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-accent uppercase tracking-widest">The Problem</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            Scaling is a <span className="text-gradient-primary">silent tax</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Growth + turnover increases fragmentation and rework. These are the symptoms teams feel but can't diagnose.
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {problems.map((p, i) => (
            <motion.div
              key={i}
              variants={item}
              className="group p-6 rounded-xl border border-border bg-card hover:border-glow transition-all duration-300 shadow-card"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <p.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-foreground font-semibold mb-2 text-sm">
                "{p.pain}"
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {p.cause}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default ProblemSection;
