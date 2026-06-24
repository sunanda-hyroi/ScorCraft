import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ScorCraft brand palette (HYROI Solutions)
        navy: "#1A2744",
        gold: "#C8963E",
        indigo: "#4338CA",
      },
    },
  },
  plugins: [],
};

export default config;
