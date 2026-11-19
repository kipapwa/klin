import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "@/components/auth/session-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ConfirmProvider } from "@/components/ui/confirm";
import { NavTransition } from "@/components/nav-transition";
import { NoZoom } from "@/components/no-zoom";
import { Suspense } from "react";
import { contentSecurityPolicy } from "@/lib/csp";
import { NAV_POP_SCRIPT } from "@/lib/nav-pop-script";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Klin", template: "%s · Klin" },
  description: "Registros médicos por voz, medicamentos e linha do tempo clínica.",
  applicationName: "Klin",
  appleWebApp: { capable: true, title: "Klin", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Dados de saúde: o app não deve ser indexado por buscadores.
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sem zoom (skill sem-zoom): maximumScale impede o iPhone de aumentar a tela ao
  // tocar num campo; userScalable trava a pinça no Android. A pinça no iPhone é
  // barrada no NoZoom. O zoom de acessibilidade do celular continua funcionando.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f766e" },
    { media: "(prefers-color-scheme: dark)", color: "#042f2e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      // O tema escolhido é aplicado antes de o React carregar (atributo data-theme).
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: NAV_POP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <ConfirmProvider>
            {/* #tela: o que a transição entre telas copia e anima. */}
            <div id="tela" className="flex min-h-full flex-1 flex-col">
              {children}
            </div>
            <Suspense fallback={null}>
              <NavTransition />
            </Suspense>
            <NoZoom />
          </ConfirmProvider>
        </SessionProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
