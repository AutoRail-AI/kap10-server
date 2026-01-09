export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public details?: any
  ) {
    super(message)
    this.name = "AppError"
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public fields?: Record<string, string[]>) {
    super(message, 400, "VALIDATION_ERROR")
    this.name = "ValidationError"
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      404,
      "NOT_FOUND"
    )
    this.name = "NotFoundError"
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED")
    this.name = "UnauthorizedError"
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "FORBIDDEN")
    this.name = "ForbiddenError"
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded", public resetAt?: Date) {
    super(message, 429, "RATE_LIMIT_EXCEEDED")
    this.name = "RateLimitError"
  }
}

export class QuotaExceededError extends AppError {
  constructor(
    message: string = "Quota exceeded",
    public remaining?: number,
    public resetAt?: Date
  ) {
    super(message, 429, "QUOTA_EXCEEDED")
    this.name = "QuotaExceededError"
  }
}

