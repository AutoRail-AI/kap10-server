"use client"

import {
  Building2,
  Check,
  ChevronsUpDown,
  HelpCircle,
  LogOut,
  Moon,
  Settings,
  Sun,
  User,
  Zap,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useAccountContext } from "@/components/providers/account-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut } from "@/lib/auth/client"

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase()
  }
  return (email?.[0] ?? "U").toUpperCase()
}

interface UserProfileMenuProps {
  serverUser: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

export function UserProfileMenu({ serverUser }: UserProfileMenuProps) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const {
    contextType,
    currentContextName,
    activeOrgId,
    organizations,
    switchContext,
    isLoading,
  } = useAccountContext()

  const user = serverUser
  const initials = getInitials(user?.name, user?.email)

  const contextLabel =
    contextType === "personal"
      ? `${user?.name?.split(" ")[0] ?? "Personal"}'s Personal`
      : currentContextName

  const handleSignOut = async () => {
    await signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
          disabled={isLoading}
        >
          <Avatar className="h-7 w-7 rounded-md">
            {user?.image && (
              <AvatarImage src={user.image} alt={user.name ?? "Avatar"} />
            )}
            <AvatarFallback className="rounded-md bg-rail-fade text-[10px] font-semibold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate text-xs font-medium text-foreground">
              {contextLabel}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">
              {user?.email}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-64 border-border bg-popover"
      >
        {/* Header */}
        <DropdownMenuLabel className="px-3 py-2">
          <p className="truncate text-xs font-medium text-foreground">
            {user?.name}
          </p>
          <p className="truncate text-[11px] font-normal text-muted-foreground">
            {user?.email}
          </p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Context switcher */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Context
          </DropdownMenuLabel>

          {/* Personal account */}
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-3"
            onSelect={() => void switchContext(null)}
            disabled={isLoading}
          >
            <div
              className={`flex h-5 w-5 items-center justify-center rounded border ${
                contextType === "personal"
                  ? "border-electric-cyan/50 bg-electric-cyan/10"
                  : "border-border bg-muted/30"
              }`}
            >
              <User
                className={`h-3 w-3 ${
                  contextType === "personal"
                    ? "text-electric-cyan"
                    : "text-muted-foreground"
                }`}
              />
            </div>
            <span
              className={`flex-1 truncate text-sm ${
                contextType === "personal" ? "text-electric-cyan" : ""
              }`}
            >
              Personal Account
            </span>
            {contextType === "personal" && (
              <Check className="h-3.5 w-3.5 text-electric-cyan" />
            )}
          </DropdownMenuItem>

          {/* Org accounts */}
          {organizations.map((org) => {
            const isActive =
              contextType === "organization" && activeOrgId === org.id
            return (
              <DropdownMenuItem
                key={org.id}
                className="cursor-pointer gap-2 px-3"
                onSelect={() => void switchContext(org.id)}
                disabled={isLoading}
              >
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded border ${
                    isActive
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <Building2
                    className={`h-3 w-3 ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                </div>
                <span
                  className={`flex-1 truncate text-sm ${
                    isActive ? "text-primary" : ""
                  }`}
                >
                  {org.name}
                </span>
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            )
          })}

        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Navigation */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-3"
            onSelect={() => router.push("/settings")}
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer gap-2 px-3" disabled>
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            <span>Help &amp; Support</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Growth */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="cursor-pointer gap-2 rounded-md px-3"
            disabled
          >
            <Zap className="h-4 w-4 text-electric-cyan" />
            <span className="bg-gradient-to-r from-electric-cyan to-primary bg-clip-text font-medium text-transparent">
              Upgrade Plan
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Preferences: theme toggle */}
        <DropdownMenuGroup>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Theme
            </span>
            <div className="flex items-center rounded-full border border-border bg-muted/20 p-0.5">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`rounded-full p-1 transition-colors ${
                  theme === "light"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Light mode"
              >
                <Sun className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`rounded-full p-1 transition-colors ${
                  theme === "dark"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Dark mode"
              >
                <Moon className="h-3 w-3" />
              </button>
            </div>
          </div>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Sign out */}
        <DropdownMenuItem
          className="cursor-pointer gap-2 px-3 text-destructive focus:text-destructive"
          onSelect={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
