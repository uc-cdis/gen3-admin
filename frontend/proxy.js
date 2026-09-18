// Remember to change the name of this file to middleware.js when we want to enable auth again
// export { default } from "next-auth/middleware"

// middleware.js

export function middleware(req) {
  const bootstrapEnabled = process.env.NEXT_PUBLIC_BOOTSTRAP_MODE === "true";

  if (bootstrapEnabled) {
    const url = req.nextUrl.clone();

    // Allow ONLY /bootstrap and static assets
    if (!url.pathname.startsWith("/bootstrap") &&
        !url.pathname.startsWith("/_next") &&
        !url.pathname.startsWith("/favicon") &&
        !url.pathname.startsWith("/api")) {
      url.pathname = "/bootstrap";
      return Response.redirect(url);
    }
  }
}

export const config = {
  matcher: ["/:path*"],
};
