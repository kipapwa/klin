import type { MetadataRoute } from "next";
import { withBase } from "@/lib/base-path";

// Necessário para o export estático (GitHub Pages).
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: withBase("/"),
    name: "Klin — Registros Médicos",
    short_name: "Klin",
    description: "Registros médicos por voz, medicamentos e linha do tempo clínica.",
    lang: "pt-BR",
    start_url: withBase("/"),
    scope: withBase("/"),
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f766e",
    categories: ["health", "medical"],
    icons: [
      { src: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: withBase("/icons/icon-maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
