import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './data/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#070508',
        crypt: {
          DEFAULT: '#0D0A0F',
          light: '#151019',
        },
        bone: {
          DEFAULT: '#E8E0D0',
          dim: '#9C937F',
          faint: '#5C564A',
        },
        blood: {
          DEFAULT: '#A31621',
          bright: '#E0342C',
          dark: '#5C0E14',
        },
        hex: {
          DEFAULT: '#7A6A8F',
          light: '#A79BC0',
        },
        moss: '#5F7355',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        widest2: '0.28em',
        widest3: '0.45em',
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      animation: {
        flicker: 'flicker 4s linear infinite',
        breathe: 'breathe 5s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'drift-up': 'drift-up 7s linear infinite',
        glitch: 'glitch 3.1s steps(1) infinite',
        sway: 'sway 9s ease-in-out infinite',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '41%': { opacity: '1' },
          '42%': { opacity: '0.55' },
          '43%': { opacity: '1' },
          '45%': { opacity: '0.75' },
          '46%': { opacity: '1' },
          '71%': { opacity: '1' },
          '72%': { opacity: '0.4' },
          '73.5%': { opacity: '1' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.045)', opacity: '1' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '80%, 100%': { transform: 'scale(1.55)', opacity: '0' },
        },
        'drift-up': {
          '0%': { transform: 'translateY(20vh) translateX(0)', opacity: '0' },
          '10%': { opacity: '0.5' },
          '90%': { opacity: '0.25' },
          '100%': { transform: 'translateY(-110vh) translateX(24px)', opacity: '0' },
        },
        glitch: {
          '0%, 93%, 100%': { transform: 'none', filter: 'none' },
          '94%': { transform: 'translateX(-2px) skewX(2deg)' },
          '95%': { transform: 'translateX(2px)', filter: 'hue-rotate(40deg)' },
          '96%': { transform: 'none' },
        },
        sway: {
          '0%, 100%': { transform: 'rotate(-1.2deg)' },
          '50%': { transform: 'rotate(1.2deg)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
