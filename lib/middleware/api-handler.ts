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
    try {
      const session = await auth.api.getSession({ headers: await headers() })
      if (!session) {
        return errorResponse("Unauthorized", 401)
      }

      return handler(req, {
        session,
        userId: session.user.id,
      })
    } catch (error) {
      logger.error("API handler error", error)
      return handleError(error)
    }
  }
}

export function withOptionalAuth(handler: ApiHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const session = await auth.api.getSession({ headers: await headers() })
      return handler(req, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session: session || null as any,
        userId: session?.user.id || "",
      })
    } catch (error) {
      logger.error("API handler error", error)
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
    logger.error("Unhandled error", error)
    return serverErrorResponse(error.message)
  }

  return serverErrorResponse("Unknown error occurred")
}

