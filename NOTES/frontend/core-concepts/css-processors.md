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

==========================

The Webpack CSS Pipeline
1. SCSS Compilation: sass-loader takes your .scss files and compiles them down into standard, browser-readable .css.

2. PostCSS Processing (Tailwind & Autoprefixer) 
    - PostCSS takes the CSS (either pure CSS or what was just compiled from SCSS) and transforms it using plugins.
    - Tailwind doesn't just "remove unused classes" anymore. Since Tailwind v3 (and further optimized in v4), it uses a Just-In-Time (JIT) engine. It scans your .jsx/.tsx files, looks for class names you actually used, and generates only that CSS on the fly.
    - Autoprefixer: This plugin reads your generated CSS and adds vendor prefixes (like -webkit- or -moz-) based on your .browserslistrc file so it works on older browsers.

3. CSS Handling in Webpack 
    It translates your CSS into JavaScript modules (handling url() and @import like JS require() statements).
    However, there's a slight distinction in how it's outputted:
    Development (style-loader): It takes the JS-string version of your CSS and injects it into the DOM inside <style> tags. This is great for fast reloads (HMR).
    Production (MiniCssExtractPlugin): style-loader is not typically used in production. Instead, you swap it out for standard Webpack plugins like MiniCssExtractPlugin.loader, which physically bundles it into a standalone .css file.

4. Tailwind Entry Point (global.scss) 
    When postcss-loader runs the Tailwind plugin, it looks for those @tailwind directives in your entry file and replaces them with the actual utility styles it generated from scanning your codebase.

The Evaluation Order (Right-to-Left)
In Webpack, loaders run from right-to-left (or bottom-to-top in an array). To make everything work smoothly, your Webpack config array must look like this:


module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          // 4. Injects CSS into DOM (dev) or extracts to file (prod)
          isProduction ? MiniCssExtractPlugin.loader : "style-loader",
          // 3. Translates CSS into CommonJS
          "css-loader",
          // 2. Processes Tailwind and Autoprefixer
          "postcss-loader",
          // 1. Compiles SCSS to CSS first
          "sass-loader",
        ],
      },
    ],
  },
};



In a Webpack configuration, if you place postcss-loader after css-loader (reading left-to-right in the array), what is the most likely outcome when using Tailwind CSS?
 - Build will suceed but Tailwind utility classes won't be applied (since css-loader runs first it ) 
 Expected order: [style-loader, css-loader, postcss, sass]
 Wrong order: [ postcss-loader, css-loader]   

Why is style-loader generally avoided in production environments for large-scale applications?
 - It increases the initial JS bundle size and causes a Flash of Unstyled Content (FOUC).

You notice the production build is slow. You see sass-loader, postcss-loader, and css-loader in the chain. Which architectural change would most likely speed up the build?
 - Migrate from SCSS to PostCSS only (using nesting plugins) to remove the sass-loader step 

 
