import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // GitHub-dark palette (dark mode)
        gh: {
          canvas: '#0d1117',
          surface: '#161b22',
          overlay: '#1c2128',
          border: '#30363d',
          'border-muted': '#21262d',
          text: '#e6edf3',
          'text-secondary': '#8b949e',
          'text-muted': '#6e7681',
          blue: '#58a6ff',
          green: '#3fb950',
          yellow: '#d29922',
          orange: '#db6d28',
          red: '#f85149',
          purple: '#bc8cff',
          cyan: '#39c5cf',
        },
        // Light mode tokens
        lm: {
          canvas: '#f6f8fa',
          surface: '#ffffff',
          border: '#d0d7de',
          text: '#1f2328',
          'text-secondary': '#656d76',
          blue: '#0969da',
          green: '#1a7f37',
          yellow: '#9a6700',
          red: '#cf222e',
          orange: '#bc4c00',
        },
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', '"Cascadia Code"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'dash': 'dash 1.5s linear infinite',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        dash: {
          to: { 'stroke-dashoffset': '-20' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [typography],
} satisfies Config;
