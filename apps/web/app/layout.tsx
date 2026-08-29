import type { Metadata } from 'next';
import './globals.css';
import './components.css';

export const metadata: Metadata = {
  title: 'Geothermal Resource Assessment',
  description:
    'Volumetric geothermal resource assessment with Monte Carlo uncertainty propagation and IAPWS-IF97 thermodynamics.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Apply the stored theme before first paint so the page never flashes the wrong
          palette. Inline because it must run ahead of hydration; it touches only the
          root element's data-theme attribute.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('geo-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
