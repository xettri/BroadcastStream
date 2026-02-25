import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/broadcaststream/",
  title: "BroadcastStream",
  description:
    "A production-ready WebRTC & HLS low-latency streaming infrastructure",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Architecture", link: "/architecture/overview" },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/guide/getting-started" },
          { text: "Broadcasting & Viewing", link: "/guide/broadcasting" },
        ],
      },
      {
        text: "Architecture & Design",
        items: [
          { text: "System Overview", link: "/architecture/overview" },
          {
            text: "Ports & Internal APIs",
            link: "/architecture/ports-apis",
          },
          {
            text: "Deep Dive: Publish Scripts",
            link: "/architecture/scripts-lifecycle",
          },
          {
            text: "Deep Dive: NGINX Config",
            link: "/architecture/nginx-config",
          },
          {
            text: "Deep Dive: FFmpeg & transcode.sh",
            link: "/architecture/ffmpeg",
          },
          {
            text: "Deep Dive: MediaMTX Config",
            link: "/architecture/mediamtx-config",
          },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/xettri/broadcaststream" },
    ],
  },
});
