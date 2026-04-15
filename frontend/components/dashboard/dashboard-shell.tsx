"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  Bell,
  ChevronDown,
  ClipboardList,
  Home,
  Users,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useDemo } from "@/lib/demo-context"
import { useSimulation } from "@/lib/simulation-context"
import { fetchAllPatients } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const navigation = [
  { title: "Dashboard", href: "/", icon: Home },
  { title: "Population View", href: "/patients", icon: Users },
  { title: "Care Gaps", href: "/care-gaps", icon: ClipboardList },
]

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  moderate: "bg-yellow-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { persona, logout, dataVersion } = useDemo()
  const { recentAlerts, unreadAlertCount, markAlertsRead, isRunning } = useSimulation()
  const [totalAlerts, setTotalAlerts] = React.useState(0)
  const [notifOpen, setNotifOpen] = React.useState(false)

  React.useEffect(() => {
    fetchAllPatients({ limit: 500 })
      .then((patients) => {
        const count = patients.reduce(
          (sum, p) =>
            sum +
            p.active_alerts.filter(
              (a) => a.severity === "critical" || a.severity === "high",
            ).length,
          0,
        )
        setTotalAlerts(count)
      })
      .catch(() => setTotalAlerts(0))
  }, [dataVersion])

  const displayBadge = unreadAlertCount > 0 ? unreadAlertCount : totalAlerts

  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          {/* Left: Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <div className="hidden sm:flex flex-col gap-0.5 leading-none">
              <span className="font-semibold text-sm">Leafy Health</span>
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
            <Popover open={notifOpen} onOpenChange={(open) => {
              setNotifOpen(open)
              if (open && unreadAlertCount > 0) markAlertsRead()
            }}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-8 w-8">
                  <Bell className="h-4 w-4" />
                  {displayBadge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                      {displayBadge > 9 ? "9+" : displayBadge}
                    </span>
                  )}
                  <span className="sr-only">Notifications</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold">Notifications</h4>
                    {isRunning && (
                      <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {recentAlerts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Bell className="mb-2 h-8 w-8 opacity-30" />
                      <p className="text-sm">No recent alerts</p>
                      <p className="text-xs">Alerts will appear here during monitoring</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {recentAlerts.slice(0, 20).map((alert) => (
                        <div
                          key={alert.id}
                          className={cn(
                            "flex gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50",
                            !alert.read && "bg-muted/30",
                          )}
                        >
                          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[alert.severity] ?? "bg-gray-400")} />
                          <div className="flex-1 space-y-0.5 overflow-hidden">
                            <p className="truncate font-medium">{alert.patient_name}</p>
                            <p className="truncate text-muted-foreground">{alert.title}</p>
                          </div>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {timeAgo(alert.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

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
