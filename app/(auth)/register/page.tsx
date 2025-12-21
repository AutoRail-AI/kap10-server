import type { Metadata } from "next"
import { RegisterForm, OAuthButtons } from "@/components/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create a new AppealGen AI account",
}

export default function RegisterPage() {
  return (
    <Card className="border-0 shadow-none lg:border lg:shadow-sm">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold">Create an account</CardTitle>
        <CardDescription>
          Get started with AppealGen AI today
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  )
}
