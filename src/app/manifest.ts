import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Barbut",
    short_name: "Barbut",
    description: "Barbut cu zaruri între prieteni, cu chibiți, Șan și Brăila.",
    id: "/barbut/",
    start_url: "/barbut/",
    // "/" on purpose: going back to the hub (same origin) stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/barbut/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/barbut/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/barbut/pwa-icon/512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
