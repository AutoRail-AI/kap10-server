"use client"

import {
  Check,
  ChevronsUpDown,
  HelpCircle,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserPlus,
  Zap,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect } from "react"
import {
  type OrgAccount,
  useAccountContext,
} from "@/components/providers/account-context"
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
import { signOut, useSession } from "@/lib/auth/client"

function getInitials(name?: string | null, email?: string): string {
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

function getContextLabel(
  account: ReturnType<typeof useAccountContext>["activeAccount"],
  userName?: string | null
): string {
  if (account.type === "personal") {
    const first = userName?.split(" ")[0] ?? "Personal"
    return `${first}'s Personal`
  }
  return account.org.name
}

interface UserProfileMenuProps {
  serverOrgs: OrgAccount[]
}

export function UserProfileMenu({ serverOrgs }: UserProfileMenuProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { theme, setTheme } = useTheme()
  const {
    activeAccount,
    organizations,
    setActiveAccount,
    setOrganizations,
  } = useAccountContext()

  useEffect(() => {
    if (serverOrgs.length > 0) {
      setOrganizations(serverOrgs)
    }
  }, [serverOrgs, setOrganizations])

  const user = session?.user
  const initials = getInitials(user?.name, user?.email)
  const contextLabel = getContextLabel(activeAccount, user?.name)

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
        >
          <Avatar className="h-7 w-7">
            {user?.image && (
              <AvatarImage src={user.image} alt={user.name ?? "Avatar"} />
            )}
            <AvatarFallback className="bg-rail-fade text-[10px] font-semibold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate text-xs font-medium text-foreground">
              {contextLabel}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 border-border bg-popover"
      >
        {/* Header: email */}
        <DropdownMenuLabel className="px-3 py-2">
          <p className="truncate text-xs font-normal text-muted-foreground">
            {user?.email}
          </p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Context switcher */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Accounts
          </DropdownMenuLabel>

          {/* Personal account */}
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-3"
            onSelect={() => setActiveAccount({ type: "personal" })}
          >
            <Avatar className="h-5 w-5">
              {user?.image && (
                <AvatarImage src={user.image} alt="Personal" />
              )}
              <AvatarFallback className="bg-muted/50 text-[8px] font-semibold text-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate text-sm">
              {user?.name
                ? `${user.name.split(" ")[0]}'s Personal`
                : "Personal"}
            </span>
            {activeAccount.type === "personal" && (
              <Check className="h-3.5 w-3.5 text-electric-cyan" />
            )}
          </DropdownMenuItem>

          {/* Org accounts */}
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              className="cursor-pointer gap-2 px-3"
              onSelect={() => setActiveAccount({ type: "org", org })}
            >
              <Avatar className="h-5 w-5">
                <AvatarFallback className="bg-rail-fade text-[8px] font-semibold text-white">
                  {org.name[0]?.toUpperCase() ?? "O"}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm">{org.name}</span>
              {activeAccount.type === "org" &&
                activeAccount.org.id === org.id && (
                  <Check className="h-3.5 w-3.5 text-electric-cyan" />
                )}
            </DropdownMenuItem>
          ))}
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
          <DropdownMenuItem className="cursor-pointer gap-2 px-3" disabled>
            <Zap className="h-4 w-4 text-electric-cyan" />
            <span className="text-electric-cyan">Upgrade Plan</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer gap-2 px-3" disabled>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <span>Invite Friends</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Preferences: theme toggle */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-3"
            onSelect={(e) => {
              e.preventDefault()
              setTheme(theme === "dark" ? "light" : "dark")
            }}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" />
            )}
            <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Sign out */}
        <DropdownMenuItem
          className="cursor-pointer gap-2 px-3 text-muted-foreground"
          onSelect={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
