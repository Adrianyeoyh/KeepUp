import { motion } from "framer-motion";
import { Shield } from "lucide-react";

const Navbar = () => {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 bg-surface-glass border-b border-border"
    >
      <div className="container max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" />
          <span className="font-bold text-lg text-foreground tracking-tight">FlowGuard</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#problem" className="hover:text-foreground transition-colors">Problem</a>
          <a href="#how" className="hover:text-foreground transition-colors">How It Works</a>
          <a href="#modules" className="hover:text-foreground transition-colors">Modules</a>
          <a href="#rules" className="hover:text-foreground transition-colors">Rules</a>
          <a href="#trust" className="hover:text-foreground transition-colors">Trust</a>
        </div>
        <div className="flex items-center gap-3">
          <a href="/app" className="text-sm text-primary font-semibold hover:underline underline-offset-4">
            Dashboard →
          </a>
        </div>
      </div>
    </motion.nav>
  );
};

export default Navbar;
