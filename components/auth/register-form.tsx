"use client"

import { AlertCircle, CheckCircle2, Lock, Mail, User } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { signUp } from "@/lib/auth/client"

export function RegisterForm() {
  const _router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    // Validate passwords match
    if (password !== confirmPassword) {
      setError("Passwords do not match")
      setIsLoading(false)
      return
    }

    // Validate password strength
    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      setIsLoading(false)
      return
    }

    try {
      const result = await signUp.email({
        email,
        password,
        name,
      })

      if (result.error) {
        setError(result.error.message || "Failed to create account")
        return
      }

      // Show success message - email verification required
      setSuccess(true)
    } catch (err) {
      setError("An unexpected error occurred")
      console.error("Registration error:", err)
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="space-y-4">
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            <strong>Check your email!</strong>
            <br />
            We&apos;ve sent a verification link to <strong>{email}</strong>.
            Please click the link to verify your account.
          </AlertDescription>
        </Alert>

        <div className="text-center text-sm text-foreground">
          <p>Didn&apos;t receive the email?</p>
          <Button
            variant="link"
            size="sm"
            className="p-0 h-auto"
            onClick={() => setSuccess(false)}
          >
            Try again with a different email
          </Button>
        </div>

        <p className="text-center text-sm text-foreground">
          Already verified?{" "}
          <Link href="/login" className="text-electric-cyan hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name" className="text-xs text-muted-foreground">Full Name</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="name"
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 pl-10"
            required
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 pl-10"
            required
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-xs text-muted-foreground">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            placeholder="Create a password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-9 pl-10"
            required
            minLength={8}
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword" className="text-xs text-muted-foreground">Confirm Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Confirm your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-9 pl-10"
            required
            disabled={isLoading}
          />
        </div>
      </div>

      <Button type="submit" size="sm" className="w-full bg-rail-fade hover:opacity-90" disabled={isLoading}>
        {isLoading ? (
          <>
            <Spinner className="mr-2 h-3.5 w-3.5" />
            Creating account...
          </>
        ) : (
          "Create account"
        )}
      </Button>

      <p className="text-center text-sm text-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-electric-cyan hover:underline">
          Sign in
        </Link>
      </p>

      <p className="text-center text-xs text-foreground">
        By creating an account, you agree to our{" "}
        <Link href="/terms" className="text-electric-cyan underline hover:opacity-90">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-electric-cyan underline hover:opacity-90">
          Privacy Policy
        </Link>
      </p>
    </form>
  )
}
