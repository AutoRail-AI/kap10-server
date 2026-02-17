import type { Metadata } from "next"
import { OAuthButtons, RegisterForm } from "@/components/auth"
import { Separator } from "@/components/ui/separator"

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create a new account",
}

export default function RegisterPage() {
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="space-y-0.5 text-center">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Create an account</h1>
        <p className="mt-0.5 text-sm text-foreground">
          Get started today
        </p>
      </div>

      <div className="space-y-4">
        <OAuthButtons mode="register" />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator className="w-full" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or continue with email
            </span>
          </div>
        </div>

        <RegisterForm />
      </div>
    </div>
  )
}
