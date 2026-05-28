// Reference: https://medium.com/@shubhankarmisra.bit/implementing-streaming-in-react-with-rendertopipeablestream-550864bee044

// Express server 
import express, { application } from "express";
import { renderToPipeableStream  } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { QueryClient, dehydrate } from "@tanstack/react-query";
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

/* Tanstack query implementation */
// Component code in useEffect
const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: async() => {
        const res = await api.get('/users');
        return res.data;
    }
})
// Express code in app.get('*')
// prefetchQuery is a fire and forget action to populate the cache
const prefetchPromises = matchesGlob.map(match => {
    const {routes, params} = match;
    if (routes.path === '/users') {
        return QueryClient.prefetchQuery({
            queryKey: ["users"],
            queryFn: async() => {
                const res = await api.get('/users');
                return res.data;
            }
        })
    }
    // Other routes
    return Promise.resolve();
});
await Promise.all(prefetchPromises);
const dehydratedState = dehydrate(queryClient);

let didError = false;

const stream = renderToPipeableStream(
    <QueryClientProvider client={queryClient}>
        <StaticRouter location={req.url}>
            <App />
        </StaticRouter>
    </QueryClientProvider>,
    {
        onShellReady() {
            res.statusCode = didError ? 500 : 200;
            res.setHeader('Content-Type', 'text/html');

            res.write(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <title>React Streaming SSR</title>
                    </head>
                    <body>
                    <div id="root">
            `);
            stream.pipe(res);
            res.write(
                `
                    </div>
                    <script>
                        window.__REACT_QUERY_STATE__ = ${JSON.stringify(dehydratedState)}
                    </script>
                    <script src="/client.bundle.js"></script>
                    </body>
                    </html>
                `
            )
        },
        onError(err) {
            didError = true;
            console.error(err)
        }
    }
)

// Client hydration main.tsx 
import { QueryClient, QueryClientProvider, Hydrate } from "@tanstack/react-query";

hydrateRoot(
    document.getElementById("root"),
    <QueryClientProvider client={queryClient}>
        <Hydrate state={window.__REACT_QUERY_STATE__}>
            <BrowserRouter>
                <App/>
            </BrowserRouter>
        </Hydrate>
    </QueryClientProvider>
)

/**
 In modern React SSR, we stream the shell early using renderToPipeableStream and hydrate React Query cache to avoid double fetching and TTFB

 To avoid this "double fetch," you must ensure your queryClient configuration has a reasonable staleTime (e.g., 10-60 secs) so the hydrated data is considered "fresh" long enough for the initial render.

 */