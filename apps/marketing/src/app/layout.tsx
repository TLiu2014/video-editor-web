import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const TITLE = 'video-editor-web — Free, Private Browser Video Editor';
const DESCRIPTION =
  'Professional non-linear video editing that runs 100% in your browser. Your media never leaves your device — no servers, no uploads, no watermarks.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · video-editor-web',
  },
  description: DESCRIPTION,
  applicationName: 'video-editor-web',
  keywords: [
    'video editor',
    'browser video editor',
    'web video editor',
    'online video editor',
    'privacy-first',
    'no upload',
    'free',
    'RDD Studio',
  ],
  authors: [{ name: 'RDD Studio' }],
  publisher: 'RDD Studio',
  creator: 'RDD Studio',
  openGraph: {
    type: 'website',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'video-editor-web',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'video-editor-web — edit video in your browser',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  icons: { icon: '/favicon.ico' },
};

/**
 * The theme-color meta is theme-aware: light + dark variants emit
 * separate <meta> tags so mobile browser chrome blends with the
 * actual theme the user has picked, not just the default.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
};

/**
 * Inline boot script. Runs synchronously before React hydrates so
 * the initial paint already has the user's preferred theme applied —
 * no "flash of light theme" when they've selected dark. Keep this
 * tiny and string-literal; it's inlined as-is into the HTML.
 *
 * Resolution order:
 *   1. localStorage (explicit user choice — wins)
 *   2. prefers-color-scheme (OS-level preference)
 *   3. 'light' default
 */
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('marketing-theme');
    var theme;
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    } else {
      theme = 'light';
    }
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`.trim();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
