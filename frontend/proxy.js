// Remember to re-enable auth here when we want it again:
// export { default } from "next-auth/middleware"
//
// Next 16 renamed the middleware file convention to "proxy"; the exported
// function follows the file name.

export function proxy(req) {
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
