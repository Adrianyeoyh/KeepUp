import { motion } from "framer-motion";
import { Shield, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-glow" />
      <div className="absolute inset-0 grid-pattern opacity-30" />
      
      {/* Animated orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, hsl(195 90% 50% / 0.3), transparent 70%)" }}
        animate={{ scale: [1, 1.2, 1], x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-1/3 right-1/4 w-72 h-72 rounded-full opacity-15"
        style={{ background: "radial-gradient(circle, hsl(35 95% 55% / 0.3), transparent 70%)" }}
        animate={{ scale: [1, 1.15, 1], x: [0, -20, 0], y: [0, 15, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />

      <div className="relative z-10 container max-w-5xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 mb-8"
        >
          <span className="glow-dot" />
          <span className="text-sm font-mono text-primary">Autonomous Operational Intelligence</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] mb-6"
        >
          <span className="text-foreground">Stop the</span>
          <br />
          <span className="text-gradient-primary">invisible slowdown</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          FlowGuard detects workflow drift across your tools, captures decisions that never get logged, 
          and drafts fixes — with human approval, full audit trail, and rollback.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Button asChild variant="hero" size="lg" className="text-base px-8 py-6">
            <a href="#cta">
              <Shield className="w-5 h-5 mr-2" />
              Start Free Diagnostic
            </a>
          </Button>
          <Button asChild variant="hero-outline" size="lg" className="text-base px-8 py-6">
            <a href="#how">
              See How It Works
              <ArrowRight className="w-5 h-5 ml-2" />
            </a>
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-6 text-sm text-muted-foreground font-mono"
        >
          Slack + Jira + GitHub · 7-day free trial · No code changes required
        </motion.p>
      </div>
    </section>
  );
};

export default HeroSection;
