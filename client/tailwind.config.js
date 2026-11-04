/** @type {import('tailwindcss').Config} */
export default { content: ['./index.html', './src/**/*.{ts,tsx}'], theme: { extend: { colors: { forest: '#174c3a', ink: '#18221e', muted: '#69736e', canvas: '#f6f7f5', line: '#e7ebe8' }, fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] }, boxShadow: { card: '0 2px 10px rgba(21, 42, 32, .035)' } } }, plugins: [] }
