import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { Footer } from "@/components/layout/Footer";
import { getCatalog } from "@/lib/rdf-catalog";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/** Nombre único del sitio: cada página aporta solo su propio título. */
const SITE_NAME = "Portal de Calidad de Datos Abiertos de Castilla y León";

/**
 * La misma variable que usa `sitemap.ts`; en local cae a localhost.
 *
 * Sin `metadataBase`, las rutas relativas de Open Graph —la imagen de compartir,
 * sin ir más lejos— no se resuelven a absolutas, que es lo único que entienden
 * las redes al generar la vista previa de un enlace.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
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
    title: SITE_NAME,
    description:
      "Observatorio de calidad y reutilización de los datos abiertos de Castilla y León.",
    type: "website",
    locale: "es_ES",
    siteName: SITE_NAME,
  },
  // La imagen la aporta `opengraph-image.png` por convención de fichero, y Next
  // la hereda en todas las rutas junto con estas etiquetas.
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description:
      "Observatorio de calidad y reutilización de los datos abiertos de Castilla y León.",
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
          {/* Quien hace scroll es la página, no `main`. No añadir aquí
              `overflow-y-auto`: convierte a `main` en contenedor de
              desplazamiento y eso desactiva el `position: sticky` de lo que
              lleve dentro, como la barra de recorrido del explorador. */}
          {/* `scroll-mt-[4.5rem]`: es el destino del enlace de salto y queda
              justo debajo de la cabecera pegajosa, así que sin margen de scroll
              su primera línea aterriza tapada. Lo lleva el elemento y no el
              documento a propósito —ver la nota en `globals.css`—: como
              `scroll-padding-top`, hacía saltar el scroll al teclear en el
              buscador de la cabecera. */}
          <main
            id="contenido-principal"
            tabIndex={-1}
            className="min-w-0 flex-1 scroll-mt-[4.5rem] focus:outline-none"
          >
            {/* Columna de contenido. Sin ella el contenido iba a sangre: en un
                monitor de 1920 las tarjetas ocupaban ~1.870 px mientras los
                párrafos estaban topados a 768, y el texto parecía no llegar al
                ancho de su propia página.

                El ancho lo manda `--container-page`, y lo decide la rejilla de
                tarjetas, no el texto: la prosa tiene su propio tope más
                estrecho, así que ensanchar esto no la mueve.

                El envoltorio va aquí dentro y no sobre `main` porque `main` es
                un ítem flex (`flex-1`) al lado de la barra lateral, y centrar
                con `mx-auto` un elemento flexible es más frágil que centrar un
                `div` normal. El `id` y el `tabIndex` se quedan en `main`: son el
                destino del enlace de salto al contenido. */}
            <div className="mx-auto w-full max-w-page px-6 py-6 sm:px-8 lg:px-12">
              {children}
            </div>
          </main>
        </div>
        <Footer />
        {/* Telemetría de Vercel: ambos componentes son `use client`, no pintan
            nada y solo se activan al desplegar en Vercel. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
