"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Database, Home, Menu, Search, X, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const navItems = [
  { label: "Inicio", href: "/", icon: Home },
  { label: "Catálogo", href: "/catalogo", icon: Database },
  { label: "Calidad", href: "/calidad", icon: BarChart3 },
  { label: "Metodología", href: "/metodologia", icon: BookOpen },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const submitSearch = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const term = query.trim();
    if (!term) return;
    router.push(`/catalogo?q=${encodeURIComponent(term)}`);
    setQuery("");
    setIsMobileMenuOpen(false);
  };

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  const navLinkClass = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      active
        ? "bg-ok-surface text-ok"
        : "text-body hover:bg-fill hover:text-strong"
    );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex h-[4.5rem] items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          aria-label="JCyL Data Quality Portal, ir al inicio"
        >
          <Image
            src="/jcyl-data-quality-portal-logo-transparent.png"
            alt="JCyL Data Quality Portal"
            width={900}
            height={420}
            priority
            sizes="(max-width: 639px) 112px, 132px"
            className="h-auto w-28 sm:w-[8.25rem]"
          />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navegación principal">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={navLinkClass(isActive(item.href))}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <form className="relative hidden lg:block" onSubmit={submitSearch} role="search">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              placeholder="Buscar datasets..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar datasets"
              className="h-10 w-56 rounded-lg border border-field bg-fill pl-9 pr-3 text-sm text-body placeholder:text-faint transition-all focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            />
          </form>
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-body shadow-sm transition-colors hover:bg-fill hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas lg:hidden"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-navigation"
            aria-label={isMobileMenuOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div
          id="mobile-navigation"
          className="border-t border-border bg-card px-4 py-4 shadow-lg lg:hidden"
        >
          <form className="relative mb-3" onSubmit={submitSearch} role="search">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              placeholder="Buscar datasets..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar datasets"
              className="h-11 w-full rounded-lg border border-field bg-fill pl-9 pr-3 text-sm text-body placeholder:text-faint focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            />
          </form>
          <nav className="grid grid-cols-2 gap-1" aria-label="Navegación móvil">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn("flex items-center gap-2 py-2.5", navLinkClass(isActive(item.href)))}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
