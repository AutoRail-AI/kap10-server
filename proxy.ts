import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  const publicPaths = [
    "/login",
    "/register",
    "/verify-email",
    "/api/auth",
    "/api/webhooks",
    "/api/health",
  ]

  const isPublicPath = publicPaths.some((p) => path.startsWith(p))

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ??
    request.cookies.get("__Secure-better-auth.session_token")?.value

  if (!sessionToken && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (sessionToken && (path === "/login" || path === "/register")) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  // Email verification: authenticated but unverified → /verify-email (except exempt paths)
  if (sessionToken && !isPublicPath) {
    try {
      const session = await auth.api.getSession({
        headers: request.headers,
      })
      const user = session?.user as { emailVerified?: boolean } | undefined
      if (user && user.emailVerified === false) {
        const url = request.nextUrl.clone()
        url.pathname = "/verify-email"
        return NextResponse.redirect(url)
      }
    } catch {
      // Session lookup failed — allow through; auth may be degraded
    }
  }

  return NextResponse.next()
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api/auth (auth endpoints)
         * - api/webhooks (webhook endpoints)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico, sitemap.xml, robots.txt (metadata files)
         * - images/ (public images)
         */
        "/((?!api/auth|api/webhooks|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|images/).*)",
    ],
}
