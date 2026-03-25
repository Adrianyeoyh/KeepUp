import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProblemSection from "@/components/ProblemSection";
import PipelineSection from "@/components/PipelineSection";
import ModulesSection from "@/components/ModulesSection";
import GoldenRulesSection from "@/components/GoldenRulesSection";
import DigestPreview from "@/components/DigestPreview";
import GitLedgerSection from "@/components/GitLedgerSection";
import PersonaSection from "@/components/PersonaSection";
import TrustSection from "@/components/TrustSection";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <div id="problem" className="scroll-mt-24"><ProblemSection /></div>
      <div id="how" className="scroll-mt-24"><PipelineSection /></div>
      <div id="modules" className="scroll-mt-24"><ModulesSection /></div>
      <div id="rules" className="scroll-mt-24"><GoldenRulesSection /></div>
      <DigestPreview />
      <GitLedgerSection />
      <PersonaSection />
      <div id="trust" className="scroll-mt-24"><TrustSection /></div>
      <div id="cta" className="scroll-mt-24"><CTASection /></div>
      <Footer />
    </div>
  );
};

export default Index;
