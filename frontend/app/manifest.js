// PWA-manifest (Next serverar detta på /manifest.webmanifest).
export default function manifest() {
  return {
    name: "Pineback",
    short_name: "Pineback",
    description: "Planera och cykla din semester.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0c17",
    theme_color: "#0e0c17",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
