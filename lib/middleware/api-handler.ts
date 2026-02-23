import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { errorResponse, serverErrorResponse } from "@/lib/utils/api-response"
import { AppError } from "@/lib/utils/errors"
import { logger } from "@/lib/utils/logger"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiHandler<T = any> = (
  req: NextRequest,
  context: {
    session: Awaited<ReturnType<typeof auth.api.getSession>>
    userId: string
  }
) => Promise<NextResponse<T>>

export function withAuth(handler: ApiHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const start = Date.now()
    const method = req.method
    const path = req.nextUrl.pathname

    try {
      const session = await auth.api.getSession({ headers: await headers() })
      if (!session) {
        logger.warn("Unauthorized request", { service: "api", method, path })
        return errorResponse("Unauthorized", 401)
      }

      const userId = session.user.id
      logger.info(`${method} ${path}`, { service: "api", userId, method, path })

      const response = await handler(req, { session, userId })

      const durationMs = Date.now() - start
      const status = response.status
      if (status >= 400) {
        logger.warn(`${method} ${path} → ${status}`, { service: "api", userId, method, path, status, durationMs })
      } else {
        logger.info(`${method} ${path} → ${status}`, { service: "api", userId, method, path, status, durationMs })
      }

      return response
    } catch (error) {
      const durationMs = Date.now() - start
      logger.error(`${method} ${path} → error`, error, { service: "api", method, path, durationMs })
      return handleError(error)
    }
  }
}

export function withOptionalAuth(handler: ApiHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const start = Date.now()
    const method = req.method
    const path = req.nextUrl.pathname

    try {
      const session = await auth.api.getSession({ headers: await headers() })
      const userId = session?.user.id || ""

      logger.info(`${method} ${path}`, { service: "api", userId: userId || "anonymous", method, path })

      const response = await handler(req, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session: session || null as any,
        userId,
      })

      const durationMs = Date.now() - start
      const status = response.status
      if (status >= 400) {
        logger.warn(`${method} ${path} → ${status}`, { service: "api", userId: userId || "anonymous", method, path, status, durationMs })
      } else {
        logger.info(`${method} ${path} → ${status}`, { service: "api", userId: userId || "anonymous", method, path, status, durationMs })
      }

      return response
    } catch (error) {
      const durationMs = Date.now() - start
      logger.error(`${method} ${path} → error`, error, { service: "api", method, path, durationMs })
      return handleError(error)
    }
  }
}

function handleError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return errorResponse(error.message, error.statusCode, {
      code: error.code,
      details: error.details,
    })
  }

  if (error instanceof Error) {
    logger.error("Unhandled error", error, { service: "api" })
    return serverErrorResponse(error.message)
  }

  return serverErrorResponse("Unknown error occurred")
}
