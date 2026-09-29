import type { Metadata } from 'next';
import { About } from '@/components/About';
import { CTABanner } from '@/components/CTABanner';
import { FAQ } from '@/components/FAQ';
import { Features } from '@/components/Features';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { getEditorUrl } from '@/lib/env';

export const metadata: Metadata = {
  title: 'video-editor-web — Free, Private Browser Video Editor',
  alternates: { canonical: '/' },
};

export default function LandingPage() {
  const editorUrl = getEditorUrl();
  return (
    <>
      <Header editorUrl={editorUrl} />
      <main className="flex flex-col">
        <Hero editorUrl={editorUrl} />
        <Features />
        <HowItWorks />
        <About />
        <FAQ />
        <CTABanner editorUrl={editorUrl} />
      </main>
      <Footer />
    </>
  );
}
