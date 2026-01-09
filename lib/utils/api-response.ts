import { NextResponse } from "next/server"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export function successResponse<T>(
  data: T,
  message?: string,
  status: number = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      ...(message && { message }),
    },
    { status }
  )
}

export function errorResponse(
  error: string | Error,
  status: number = 400,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any
): NextResponse<ApiResponse> {
  const errorMessage = error instanceof Error ? error.message : error

  return NextResponse.json(
    {
      success: false,
      error: errorMessage,
      ...(details && { details }),
    },
    { status }
  )
}

export function unauthorizedResponse(
  message: string = "Unauthorized"
): NextResponse<ApiResponse> {
  return errorResponse(message, 401)
}

export function forbiddenResponse(
  message: string = "Forbidden"
): NextResponse<ApiResponse> {
  return errorResponse(message, 403)
}

export function notFoundResponse(
  message: string = "Not found"
): NextResponse<ApiResponse> {
  return errorResponse(message, 404)
}

export function serverErrorResponse(
  error: string | Error = "Internal server error",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any
): NextResponse<ApiResponse> {
  return errorResponse(error, 500, details)
}

