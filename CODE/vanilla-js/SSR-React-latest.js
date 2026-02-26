// Reference: https://medium.com/@shubhankarmisra.bit/implementing-streaming-in-react-with-rendertopipeablestream-550864bee044

// Express server 
import express from "express";
import { renderToPipeableStream  } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import App from "./App";

const app = express();

app.get("*", (req, res) => {
    const { pipe } = renderToPipeableStream(
        <StaticRouter url={req.url}>
            <App />
        </StaticRouter>,
        {
            onShellReady() {
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html");
                res.write(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                    `
                );
                pipe(res);
                res.write(`
                        </head>
                        <body>
                            <div id="root"></div>
                            <script src="./bundle.js"></script>
                        </body>
                    </html>
                `)
            }
        }
    )

});

app.listen(3000);

// React 19 - no helmet needed as it supports native title, meta tags 

// For SSR - main.tsx Hydration code
import { hydrateRoot } from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";

hydrateRoot(
    document.getElementById("root"),
    <BrowserRouter>
        <App />
    </BrowserRouter>
);

// For CSR
import { createRoot } from "react-dom/client"
createRoot(
    document.getElementById("root"),
    <BrowserRouter>
        <App />
    </BrowserRouter>
)