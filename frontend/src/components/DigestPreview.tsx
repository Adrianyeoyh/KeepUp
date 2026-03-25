import { motion } from "framer-motion";
import { AlertTriangle, RotateCcw, Zap, CheckCircle2, GitCommit } from "lucide-react";

const DigestPreview = () => {
  return (
    <section className="py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-glow opacity-40" />
      <div className="container max-w-5xl mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-sm font-mono text-primary uppercase tracking-widest">Daily Digest</span>
          <h2 className="text-3xl md:text-5xl font-bold mt-4 mb-4">
            Your morning <span className="text-gradient-primary">briefing</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Delivered via Slack DM. 3 items max. Evidence-linked. One-click actions.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="rounded-2xl border border-border bg-card shadow-card overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">FlowGuard Daily Digest</p>
              <p className="text-xs text-muted-foreground font-mono">Today · 3 leaks detected</p>
            </div>
          </div>

          {/* Leak items */}
          <div className="divide-y divide-border">
            {/* Leak 1 */}
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">Decision Drift</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-mono">HIGH</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    est. <span className="text-accent font-mono">10–14 hrs/week</span> lost · 
                    <span className="text-primary underline cursor-pointer ml-1">#platform-arch thread</span> · 
                    <span className="text-primary underline cursor-pointer ml-1">PLAT-342</span>
                  </p>
                  <p className="text-sm text-secondary-foreground mb-3">
                    Thread running 4 days, 47 messages, no DRI assigned. Decision keywords detected but no outcome logged.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary font-mono hover:bg-primary/20 transition-colors flex items-center gap-1.5">
                      <GitCommit className="w-3 h-3" /> Create Decision Commit
                    </button>
                    <button className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent font-mono hover:bg-accent/20 transition-colors flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" /> Approve Reminder
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Leak 2 */}
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <RotateCcw className="w-4 h-4 text-accent" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">Rework Spike</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-mono">MED</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Reopen rate <span className="text-accent font-mono">18%</span> vs <span className="font-mono">10%</span> baseline · 
                    <span className="text-primary underline cursor-pointer ml-1">5 reopened issues</span>
                  </p>
                  <p className="text-sm text-secondary-foreground mb-3">
                    Missing acceptance criteria on 4/5 reopened tickets. Template enforcement would prevent 80% of rework.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary font-mono hover:bg-primary/20 transition-colors flex items-center gap-1.5">
                      <GitCommit className="w-3 h-3" /> Create Policy Commit
                    </button>
                    <button className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent font-mono hover:bg-accent/20 transition-colors flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" /> Propose Template Diff
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Leak 3 */}
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">PR Review Bottleneck</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono">MED</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Median review time <span className="text-primary font-mono">+35%</span> above baseline · 
                    <span className="text-primary underline cursor-pointer ml-1">PR queue</span>
                  </p>
                  <p className="text-sm text-secondary-foreground mb-3">
                    2 reviewers handling 80% of reviews. 6 PRs waiting &gt;3 days.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary font-mono hover:bg-primary/20 transition-colors flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" /> Approve Ping
                    </button>
                    <button className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent font-mono hover:bg-accent/20 transition-colors flex items-center gap-1.5">
                      <GitCommit className="w-3 h-3" /> Create Action Commit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default DigestPreview;
