/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', panel: 'var(--panel)', sunk: 'var(--sunk)', line: 'var(--line)',
        ink: 'var(--ink)', ink2: 'var(--ink2)', mute: 'var(--mute)',
        accent: 'var(--accent)', accentInk: 'var(--accent-ink)', head: 'var(--head)', headInk: 'var(--head-ink)',
        plan: 'var(--plan)', planSoft: 'var(--plan-soft)', act: 'var(--act)', done: 'var(--done)',
        late: 'var(--late)', lateSoft: 'var(--late-soft)', idle: 'var(--idle)', warn: 'var(--warn)', warnSoft: 'var(--warn-soft)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans KR"', '"Apple SD Gothic Neo"', '"Malgun Gothic"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
