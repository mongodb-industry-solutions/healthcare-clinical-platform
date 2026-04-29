"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  ChevronDown,
  ClipboardList,
  Home,
  Presentation,
  Users,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useDemo } from "@/lib/demo-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import InfoWizard from "@/components/infoWizard/InfoWizard"

const navigation = [
  { title: "Demo Overview", href: "/demo-overview", icon: Presentation },
  { title: "Dashboard", href: "/dashboard", icon: Home },
  { title: "Population View", href: "/patients", icon: Users },
  { title: "Care Gaps", href: "/care-gaps", icon: ClipboardList },
]

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { persona, logout } = useDemo()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          {/* Left: Logo */}
          <Link href="/demo-overview" className="flex items-center gap-2 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <div className="hidden sm:flex flex-col gap-0.5 leading-none">
              <span className="font-semibold text-sm">Clinical Operations Platform</span>
            </div>
          </Link>

          <div className="hidden sm:block h-6 w-px bg-border mx-1" />

          {/* Center: Navigation */}
          <nav className="flex items-center gap-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.title}</span>
                </Link>
              )
            })}
          </nav>

          {/* Right: Controls */}
          <div className="ml-auto flex items-center gap-2">
            <InfoWizard />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {persona?.initials ?? "DR"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden lg:inline text-sm font-medium">{persona?.name ?? "Guest"}</span>
                  <ChevronDown className="h-3 w-3 opacity-50 hidden lg:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Preferences</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
