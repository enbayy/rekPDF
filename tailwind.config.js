/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: '#1a1a1a',
        'dark-lighter': '#2a2a2a',
        primary: '#3b82f6',
      },
    },
  },
  plugins: [],
}
