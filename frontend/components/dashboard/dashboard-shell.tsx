"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  ClipboardList,
  GitCompare,
  Home,
  Search,
  Settings,
  Users,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useDemo } from "@/lib/demo-context"
import { useSimulation, type AlertNotification } from "@/lib/simulation-context"
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
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface DashboardShellProps {
  children: React.ReactNode
}

const navigation = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", href: "/", icon: Home },
      { title: "Population View", href: "/patients", icon: Users },
      { title: "Active Alerts", href: "/alerts", icon: AlertTriangle, badge: true },
    ],
  },
  {
    title: "Analysis",
    items: [
      { title: "Vitals Monitor", href: "/vitals", icon: Activity },
      { title: "Care Gaps", href: "/care-gaps", icon: ClipboardList },
      { title: "Compare Patients", href: "/compare", icon: GitCompare },
    ],
  },
  {
    title: "System",
    items: [
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

const hospitals = [
  { id: "all", name: "All Hospitals" },
  { id: "st_marys", name: "St. Mary's Medical Center" },
  { id: "regional_general", name: "Regional General Hospital" },
  { id: "community_health", name: "Community Health Partners" },
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

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname()
  const { persona, logout, dataVersion } = useDemo()
  const { recentAlerts, unreadAlertCount, markAlertsRead, isRunning } = useSimulation()
  const [selectedHospital, setSelectedHospital] = React.useState(hospitals[0])
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
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href="/" className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">Leafy Health</span>
                    <span className="text-xs text-muted-foreground">Clinical Platform</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {navigation.map((group) => (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.href}
                        tooltip={item.title}
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.badge && totalAlerts > 0 && (
                        <SidebarMenuBadge>
                          <Badge 
                            variant="destructive" 
                            className="h-5 min-w-5 rounded-full px-1.5 text-xs"
                          >
                            {totalAlerts}
                          </Badge>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {persona?.initials ?? "DR"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-0.5 leading-none">
                      <span className="font-medium">{persona?.name ?? "Guest"}</span>
                      <span className="text-xs text-muted-foreground capitalize">{persona?.description ?? "Not logged in"}</span>
                    </div>
                    <ChevronDown className="ml-auto h-4 w-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Profile</DropdownMenuItem>
                  <DropdownMenuItem>Preferences</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <span className="max-w-[150px] truncate">{selectedHospital.name}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hospitals.map((hospital) => (
                <DropdownMenuItem
                  key={hospital.id}
                  onClick={() => setSelectedHospital(hospital)}
                  className={cn(
                    selectedHospital.id === hospital.id && "bg-accent"
                  )}
                >
                  {hospital.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="relative ml-auto flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search patients, conditions, or notes..."
              className="h-8 pl-8 bg-secondary/50"
            />
          </div>

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
                {recentAlerts.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" asChild>
                    <Link href="/alerts">View all</Link>
                  </Button>
                )}
              </div>
              <ScrollArea className="max-h-80">
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
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
