type LogLevel = "debug" | "info" | "warn" | "error"

interface LogContext {
  userId?: string
  organizationId?: string
  requestId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

class Logger {
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ""
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const formatted = this.formatMessage(level, message, context)

    switch (level) {
      case "debug":
        if (process.env.NODE_ENV === "development") {
          console.debug(formatted)
        }
        break
      case "info":
        console.info(formatted)
        break
      case "warn":
        console.warn(formatted)
        break
      case "error":
        console.error(formatted)
        break
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context)
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context)
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = {
      ...context,
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
    }
    this.log("error", message, errorContext)
  }
}

export const logger = new Logger()

