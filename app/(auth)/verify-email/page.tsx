"use client"

import { CheckCircle2, Loader2, Mail, XCircle } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense , useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  const [status, setStatus] = useState<"loading" | "success" | "error" | "no-token">(
    token ? "loading" : "no-token"
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    const verifyEmail = async () => {
      try {
        const response = await fetch(`/api/auth/verify-email?token=${token}`, {
          method: "GET",
        })

        if (response.ok) {
          setStatus("success")
          // Redirect to login after 3 seconds
          setTimeout(() => {
            router.push("/login")
          }, 3000)
        } else {
          const data = await response.json() as { message?: string }
          setError(data.message || "Verification failed")
          setStatus("error")
        }
      } catch (_err) {
        setError("An error occurred during verification")
        setStatus("error")
      }
    }

    verifyEmail()
  }, [token, router])

  if (status === "no-token") {
    return (
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Mail className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">Check your email</CardTitle>
          <CardDescription>
            We&apos;ve sent you a verification link. Click the link in your email
            to verify your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription>
              If you don&apos;t see the email, check your spam folder.
            </AlertDescription>
          </Alert>

          <div className="text-center">
            <Link href="/login">
              <Button variant="outline">Back to login</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === "loading") {
    return (
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
          </div>
          <CardTitle className="text-2xl font-bold">Verifying email...</CardTitle>
          <CardDescription>
            Please wait while we verify your email address.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (status === "success") {
    return (
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Email verified!</CardTitle>
          <CardDescription>
            Your email has been successfully verified. You can now sign in to
            your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              Redirecting you to login...
            </AlertDescription>
          </Alert>

          <div className="text-center">
            <Link href="/login">
              <Button>Continue to login</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state
  return (
    <Card className="border-0 shadow-none lg:border lg:shadow-sm">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <XCircle className="h-6 w-6 text-destructive" />
        </div>
        <CardTitle className="text-2xl font-bold">Verification failed</CardTitle>
        <CardDescription>
          We couldn&apos;t verify your email address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            {error || "The verification link may have expired or is invalid."}
          </AlertDescription>
        </Alert>

        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Need a new verification link?
          </p>
          <Link href="/register">
            <Button variant="outline">Try registering again</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function VerifyEmailLoading() {
  return (
    <Card className="border-0 shadow-none lg:border lg:shadow-sm">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
        </div>
        <CardTitle className="text-2xl font-bold">Loading...</CardTitle>
      </CardHeader>
    </Card>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailLoading />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
