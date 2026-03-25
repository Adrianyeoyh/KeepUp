import { Shield } from "lucide-react";

const Footer = () => {
  return (
    <footer className="py-12 border-t border-border">
      <div className="container max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-bold text-foreground">FlowGuard</span>
          </div>
          <p className="text-sm text-muted-foreground font-mono">
            Detect → Diagnose → Draft Fix → Approve → Execute → Measure
          </p>
          <p className="text-xs text-muted-foreground">© 2026 FlowGuard</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
