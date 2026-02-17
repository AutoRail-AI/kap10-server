import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
    const path = request.nextUrl.pathname

    // Define public paths that don't require authentication
    const publicPaths = [
        "/login",
        "/register",
        "/verify-email",
        "/api/auth",
        "/api/webhooks",
    ]

    // Check if the path is public
    const isPublicPath = publicPaths.some((publicPath) =>
        path.startsWith(publicPath)
    )

    // Get session token from cookies
    // better-auth uses "better-auth.session_token" by default
    const sessionToken = request.cookies.get("better-auth.session_token")?.value ||
        request.cookies.get("__Secure-better-auth.session_token")?.value

    // If user is not authenticated and trying to access a protected route
    if (!sessionToken && !isPublicPath) {
        // Redirect to login page
        const url = request.nextUrl.clone()
        url.pathname = "/login"
        // Optional: Add callback URL
        // url.searchParams.set("callbackUrl", path)
        return NextResponse.redirect(url)
    }

    // If user is authenticated and trying to access auth pages (login/register)
    if (sessionToken && (path === "/login" || path === "/register")) {
        // Redirect to dashboard
        return NextResponse.redirect(new URL("/", request.url))
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
