"use client"

import { CheckCircle2, Mail, XCircle } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

import { Spinner } from "@/components/ui/spinner"

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
      } catch {
        setError("An error occurred during verification")
        setStatus("error")
      }
    }

    verifyEmail()
  }, [token, router])

  if (status === "no-token") {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Mail className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-0.5">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Check your email</h1>
          <p className="mt-0.5 text-sm text-foreground">
            We&apos;ve sent you a verification link. Click the link in your email
            to verify your account.
          </p>
        </div>
        <Alert>
          <Mail className="h-4 w-4" />
          <AlertDescription>
            If you don&apos;t see the email, check your spam folder.
          </AlertDescription>
        </Alert>

        <div>
          <Link href="/login">
            <Button variant="outline" size="sm" className="border-rail-purple/30 text-electric-cyan hover:bg-rail-purple/10">Back to login</Button>
          </Link>
        </div>
      </div>
    )
  }

  if (status === "loading") {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-0.5">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Verifying email...</h1>
          <p className="mt-0.5 text-sm text-foreground">
            Please wait while we verify your email address.
          </p>
        </div>
      </div>
    )
  }

  if (status === "success") {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
        </div>
        <div className="space-y-0.5">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Email verified!</h1>
          <p className="mt-0.5 text-sm text-foreground">
            Your email has been successfully verified. You can now sign in to
            your account.
          </p>
        </div>
        <Alert className="border-success/50 bg-success/10">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription className="text-foreground">
            Redirecting you to login...
          </AlertDescription>
        </Alert>

        <div>
          <Link href="/login">
            <Button size="sm" className="bg-rail-fade hover:opacity-90">Continue to login</Button>
          </Link>
        </div>
      </div>
    )
  }

  // Error state
  return (
    <div className="max-w-md mx-auto space-y-6 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <XCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-0.5">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Verification failed</h1>
        <p className="mt-0.5 text-sm text-foreground">
          We couldn&apos;t verify your email address.
        </p>
      </div>
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertDescription>
          {error || "The verification link may have expired or is invalid."}
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <p className="text-sm text-foreground">
          Need a new verification link?
        </p>
        <Link href="/register">
          <Button variant="outline" size="sm" className="border-rail-purple/30 text-electric-cyan hover:bg-rail-purple/10">Try registering again</Button>
        </Link>
      </div>
    </div>
  )
}

function VerifyEmailLoading() {
  return (
    <div className="max-w-md mx-auto space-y-6 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
      <h1 className="font-grotesk text-lg font-semibold text-foreground">Loading...</h1>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailLoading />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
