/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta dark customizada
        surface: {
          900: '#0d1117',
          800: '#161b22',
          700: '#21262d',
          600: '#30363d',
        },
        accent: {
          DEFAULT: '#58a6ff',
          hover: '#79b8ff',
        },
      },
    },
  },
  plugins: [],
};
