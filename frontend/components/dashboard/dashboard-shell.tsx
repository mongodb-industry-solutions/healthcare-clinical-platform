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

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname()
  const [selectedHospital, setSelectedHospital] = React.useState(hospitals[0])
  const [totalAlerts, setTotalAlerts] = React.useState(0)

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
  }, [])

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
                        DR
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-0.5 leading-none">
                      <span className="font-medium">Dr. Sarah Chen</span>
                      <span className="text-xs text-muted-foreground">Attending Physician</span>
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
                  <DropdownMenuItem>Sign out</DropdownMenuItem>
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

          <Button variant="ghost" size="icon" className="relative h-8 w-8">
            <Bell className="h-4 w-4" />
            {totalAlerts > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                {totalAlerts > 9 ? "9+" : totalAlerts}
              </span>
            )}
            <span className="sr-only">Notifications</span>
          </Button>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
