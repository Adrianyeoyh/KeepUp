import { motion } from "framer-motion";
import { Shield, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section className="py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-glow" />
      <div className="absolute inset-0 grid-pattern opacity-20" />
      
      <div className="container max-w-3xl mx-auto px-6 relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            Stop guessing.<br />
            <span className="text-gradient-primary">Start knowing.</span>
          </h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-lg mx-auto">
            Free 7-day diagnostic. No code changes. Connect Slack + Jira + GitHub and see your first insights by tomorrow.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="hero" size="lg" className="text-base px-8 py-6">
              <Shield className="w-5 h-5 mr-2" />
              Start Free Diagnostic
            </Button>
            <Button variant="hero-outline" size="lg" className="text-base px-8 py-6">
              Talk to Founders
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
