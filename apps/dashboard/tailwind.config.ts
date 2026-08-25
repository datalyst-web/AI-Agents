import type { Config } from "tailwindcss";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const uiPreset = require("@chat-agent/ui/tailwind-preset");

const config: Config = {
  presets: [uiPreset],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  darkMode: "class",
};

export default config;
