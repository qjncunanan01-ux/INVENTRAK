/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.js', './src/**/*.{js,jsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1f640e',
          secondary: '#0d3b06',
        },
        surface: '#ffffff',
        muted: '#f5f5f5',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
