/* 
 * Browser -> Node/Express SSR -> React render -> HTML -> Hydration 
 * Tech stack: React, Express, react-router, react-helmet, sitemap + robots 
 * renderToString -> renderToPipeableStream 
 */ 

// Express server
import { renderToString } from "react-dom/server";
import App from "./App";
import { StaticRouter } from "react-router-dom/server";
import { Helmet } from "react-helmet";

app.get('*', (req, res) => {
    const html = renderToString(
        <StaticRouter location={req.url}>
            <App/>
        </StaticRouter>
    );
    const helmet = Helmet.renderStatic();
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                ${helmet.title.toString()}
                ${helmet.meta.toString()}
                ${helmet.link.toString()}
            </head>
            <body><div id="root">${html}</div></body>
        <script src="./bundle.js"></script>
        </html>
    `)
});

// Meta tags - react-helmet 
// used to manage <head> tags (title, met, OG etc.) dynamically 
// good for SEO and SSR

// Wrapper SEO component
import { Helmet } from "react-helmet";

function SEO({ title, description }) {    
    return (
        <Helmet>
            <title>{title}</title>
            <meta name="description" content={description} />
        </Helmet>
    );
}