# Folio website

The public download website is a standalone static page. It includes real app screenshots, light/dark themes, keyboard-accessible screenshot tabs, GitHub download links, and the donation link.

Preview from the repository root with `python -m http.server 4330 --directory website`, then open `http://localhost:4330`.

Deploy the contents of this directory to a static host. No build step, dependency installation, tracking scripts, or secret variables are needed. The Sites deployment uses a separate checkout with these files in `dist/` and its own hosting identity.

This is the download website. The Python PDF editing API and shared workspaces need a separately hosted backend with persistent storage; serving this page does not deploy that service.
