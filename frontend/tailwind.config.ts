import type { Config } from "tailwindcss";

// 편집실(스튜디오)에서 가져온 방향: 회색 계열 표면 + 탤리 라이트 색 하나.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        deep: "#0f0f10", page: "#141415", card: "#19191b", raised: "#232325",
        line: "rgba(237,237,237,0.08)", ink: "#ededed", sub: "#a1a1a6", mute: "#85858b",
        tally: "#ff6b3d", ok: "#4cc38a", bad: "#e5484d",
      },
      fontFamily: {
        sans: ["Pretendard Variable", "Pretendard", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
    },
  },
  plugins: [],
} satisfies Config;
