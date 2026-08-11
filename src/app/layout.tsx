import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { getCatalog } from "@/lib/rdf-catalog";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "JCyL Data Quality Portal | Datos Abiertos de Castilla y León",
  description:
    "Observatorio de la calidad del catálogo de datos abiertos de la Junta de Castilla y León: metadatos, formatos, licencias, disponibilidad y reutilización.",
  keywords: [
    "datos abiertos",
    "Castilla y León",
    "open data",
    "calidad de datos",
    "gobernanza",
    "transparencia",
    "DCAT",
    "catálogo de datos",
    "Junta de Castilla y León",
  ],
  openGraph: {
    title: "JCyL Data Quality Portal",
    description:
      "Observatorio de calidad y reutilización de los datos abiertos de Castilla y León.",
    type: "website",
    locale: "es_ES",
  },
};

const ANTI_FOUC = `(function(){try{var t=localStorage.getItem('jcyl-data-quality-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}})()`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const catalog = await getCatalog();
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Blocking theme script — must run before first paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FOUC }} />
      </head>
      <body className="font-sans">
        <a
          href="#contenido-principal"
          className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-canvas"
        >
          Saltar al contenido principal
        </a>
        <Header />
        <div className="flex min-h-[calc(100vh-4.5rem)]">
          <Suspense fallback={null}>
            <Sidebar stats={catalog.stats} />
          </Suspense>
          <main id="contenido-principal" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 focus:outline-none">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
