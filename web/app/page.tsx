import { CtaSection } from '@/components/cta-section';
import { Eligibility } from '@/components/eligibility';
import { Faq } from '@/components/faq';
import { Footer } from '@/components/footer';
import { Hero } from '@/components/hero';
import { HowItWorks } from '@/components/how-it-works';
import { Navbar } from '@/components/navbar';
import { StatsBand } from '@/components/stats-band';

export default function HomePage() {
  return (
    <div className="relative min-h-screen">
      <Navbar />
      <main>
        <Hero />
        <StatsBand />
        <HowItWorks />
        <Eligibility />
        <Faq />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
