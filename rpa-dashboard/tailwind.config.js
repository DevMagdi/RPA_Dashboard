/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#F9F9F6',
        card: '#FFFFFF',
        textMain: '#1F2937',
        textMuted: '#6B7280',
        primaryDark: '#2A3F54',
        accentGreen: '#10B981',
      }
    },
  },
  plugins: [],
}