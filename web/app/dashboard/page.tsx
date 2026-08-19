import type { Metadata } from 'next';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';
import { DashboardView } from '@/components/dashboard-view';

export const metadata: Metadata = {
  title: 'Live dashboard',
  description:
    'Every distribution, every snapshot and every payout the Moderna airdrop engine has made, updated live.',
};

export default function DashboardPage() {
  return (
    <div className="relative min-h-screen">
      <Navbar />
      <main className="pt-28 pb-16">
        <DashboardView />
      </main>
      <Footer />
    </div>
  );
}
