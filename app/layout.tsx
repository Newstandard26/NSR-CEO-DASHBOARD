import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NSR OS',
  description: 'New Standard Restoration — operating dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
