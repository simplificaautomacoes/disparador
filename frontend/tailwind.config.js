/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                dark: {
                    900: '#121212',
                    800: '#1e1e1e',
                    700: '#2d2d2d',
                },
                lime: {
                    400: '#d9f99d',
                    500: '#84cc16',
                }
            }
        },
    },
    plugins: [],
}
