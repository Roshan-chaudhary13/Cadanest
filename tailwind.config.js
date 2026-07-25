/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        industrial: {
          bg: 'var(--industrial-bg)',
          card: 'var(--industrial-card)',
          border: 'var(--industrial-border)',
          text: 'var(--industrial-text)',
          muted: 'var(--industrial-muted)',
          accent: 'var(--industrial-accent)',
          orange: 'var(--industrial-orange)',
          success: 'var(--industrial-success)',
          darker: 'var(--industrial-darker)'
        }
      }
    },
  },
  plugins: [],
}
