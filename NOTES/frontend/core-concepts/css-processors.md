# CSS Processors

CSS Preprocessors
    A CSS preprocessor extends CSS with extra features and compiles it into normal CSS before the browser sees it. It runs during build time.
    Sass is a CSS preprocessor language.
    SCSS is just the modern syntax of Sass (most commonly used). 
    Sass = the preprocessor/tool
    SCSS = the syntax you write
    Preprocessors give you:
    Variables, Nesting, Mixins, Functions, Conditionals, Loops, Imports

    $primary: blue;
    .button {
        background: $primary;
        &:hover {
            background: darken($primary, 10%);
        }
    }

    SCSS file → Sass compiler → CSS file → Browser 

    Webpack uses sass-loader and converts scss to css using Sass compiler

CSS Postprocessors
    A postprocessor takes already-written CSS and transforms or enhances it.
    Most popular - PostCSS.
    Postprocessors can:
        - Add vendor prefixes
        - Polyfill future CSS
        - Remove unused CSS
        - Minify CSS
        - Optimize output
    display: flex -> Converted to 
    { display: -ms-flexbox; display: -webkit-box, display: flex }

CSS-in-JS 
    JS runs → styles generated → injected into DOM
    Popular libraries: styled-components, Emotion 
    It generates unique class names (similar to CSS modules) but created via JS. 
    - Runtime style generation 
    - More JS bundle size 
    - More memory 
    - Potential hydration cost in SSR 

CSS preprocessors like Sass enhance CSS at build time and output static CSS, while CSS-in-JS generates and injects styles at runtime using JavaScript, allowing dynamic styling but introducing runtime overhead.

Use Preprocessors when:
    Large enterprise apps
    Design systems
    Performance-critical apps
    SSR-heavy apps
    Micro-frontends

Use CSS-in-JS when:
    Highly dynamic styling
    Theme switching
    Component libraries
    You want full JS power inside styles


Styling compilation phases during React webpack build:
1) Component uses scss import statement: import "./Button.scss";
2) Webpack sees .scss and sends it to Sass compiler 
3) Sass compiler runs to convert .scss to .css 
4) CSS goes back to bundler. Now normal CSS enters the CSS pipeline:
    PostCSS (Tailwind etc.)
    Autoprefixer
    Minification
    Extraction or style injection 
5) Browser receives plain CSS 

npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p // creates the file tailwind.config.js

// tailwind.config.js
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

// postcss.config.js 
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

// global.css (These are compile-time directives, not real CSS.)
@tailwind base;
@tailwind components;
@tailwind utilities;


// Note: Tailwind scanner cannot evaluate runtime JS 
<div className={`w-[${size}px]`} /> // ERROR 

// This WORKS!
<div className={size === 100 ? "w-[100px]" : "w-[200px]"} />

Pipeline: 
SCSS → CSS
        ↓
PostCSS starts
        ↓
Tailwind plugin
  • scan content
  • detect arbitrary utilities
  • generate CSS rules
        ↓
    Autoprefixer
        ↓
    Minifier
        ↓
    Bundle
 