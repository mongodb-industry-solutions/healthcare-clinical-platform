"use client"

import * as React from "react"
import Link from "next/link"
import { 
  AlertTriangle, 
  ArrowUpDown, 
  ChevronRight, 
  Filter, 
  Heart,
  Thermometer,
  Wind,
  Activity as ActivityIcon
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { mockPatients, type Patient360 } from "@/lib/mock-data"

type SortField = "name" | "age" | "alerts" | "hospital"
type SortDirection = "asc" | "desc"

export function PatientList() {
  const [sortField, setSortField] = React.useState<SortField>("alerts")
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc")
  const [hospitalFilter, setHospitalFilter] = React.useState<string[]>([])
  const [profileFilter, setProfileFilter] = React.useState<string[]>([])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const filteredPatients = React.useMemo(() => {
    let patients = [...mockPatients]

    // Apply hospital filter
    if (hospitalFilter.length > 0) {
      patients = patients.filter((p) => hospitalFilter.includes(p.source_hospital))
    }

    // Apply profile filter
    if (profileFilter.length > 0) {
      patients = patients.filter((p) => profileFilter.includes(p.profile_type))
    }

    // Sort
    patients.sort((a, b) => {
      let comparison = 0

      switch (sortField) {
        case "name":
          comparison = a.demographics.name.localeCompare(b.demographics.name)
          break
        case "age":
          comparison = a.demographics.age - b.demographics.age
          break
        case "alerts":
          const aAlerts = a.active_alerts.filter((al) => al.severity === "critical").length * 10 +
                          a.active_alerts.filter((al) => al.severity === "high").length
          const bAlerts = b.active_alerts.filter((al) => al.severity === "critical").length * 10 +
                          b.active_alerts.filter((al) => al.severity === "high").length
          comparison = aAlerts - bAlerts
          break
        case "hospital":
          comparison = a.hospital_name.localeCompare(b.hospital_name)
          break
      }

      return sortDirection === "asc" ? comparison : -comparison
    })

    return patients
  }, [sortField, sortDirection, hospitalFilter, profileFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Population View</h1>
          <p className="text-sm text-muted-foreground">
            {mockPatients.length} patients actively monitored
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Hospital Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Filter className="h-3.5 w-3.5" />
                Hospital
                {hospitalFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {hospitalFilter.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Filter by Hospital</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={hospitalFilter.includes("st_marys")}
                onCheckedChange={(checked) => {
                  setHospitalFilter(
                    checked
                      ? [...hospitalFilter, "st_marys"]
                      : hospitalFilter.filter((h) => h !== "st_marys")
                  )
                }}
              >
                St. Mary's Medical Center
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hospitalFilter.includes("regional_general")}
                onCheckedChange={(checked) => {
                  setHospitalFilter(
                    checked
                      ? [...hospitalFilter, "regional_general"]
                      : hospitalFilter.filter((h) => h !== "regional_general")
                  )
                }}
              >
                Regional General Hospital
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hospitalFilter.includes("community_health")}
                onCheckedChange={(checked) => {
                  setHospitalFilter(
                    checked
                      ? [...hospitalFilter, "community_health"]
                      : hospitalFilter.filter((h) => h !== "community_health")
                  )
                }}
              >
                Community Health Partners
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Profile Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Filter className="h-3.5 w-3.5" />
                Risk Profile
                {profileFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {profileFilter.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filter by Profile</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={profileFilter.includes("target")}
                onCheckedChange={(checked) => {
                  setProfileFilter(
                    checked
                      ? [...profileFilter, "target"]
                      : profileFilter.filter((p) => p !== "target")
                  )
                }}
              >
                Target (High Risk)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={profileFilter.includes("diabetic")}
                onCheckedChange={(checked) => {
                  setProfileFilter(
                    checked
                      ? [...profileFilter, "diabetic"]
                      : profileFilter.filter((p) => p !== "diabetic")
                  )
                }}
              >
                Diabetic
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={profileFilter.includes("cardiac")}
                onCheckedChange={(checked) => {
                  setProfileFilter(
                    checked
                      ? [...profileFilter, "cardiac"]
                      : profileFilter.filter((p) => p !== "cardiac")
                  )
                }}
              >
                Cardiac
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={profileFilter.includes("healthy")}
                onCheckedChange={(checked) => {
                  setProfileFilter(
                    checked
                      ? [...profileFilter, "healthy"]
                      : profileFilter.filter((p) => p !== "healthy")
                  )
                }}
              >
                Healthy
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear Filters */}
          {(hospitalFilter.length > 0 || profileFilter.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setHospitalFilter([])
                setProfileFilter([])
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Patient Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[250px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 gap-1"
                    onClick={() => handleSort("name")}
                  >
                    Patient
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="w-[100px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 gap-1"
                    onClick={() => handleSort("age")}
                  >
                    Age
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="hidden md:table-cell">Conditions</TableHead>
                <TableHead>Latest Vitals</TableHead>
                <TableHead className="w-[120px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 gap-1"
                    onClick={() => handleSort("alerts")}
                  >
                    Alerts
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 gap-1"
                    onClick={() => handleSort("hospital")}
                  >
                    Hospital
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPatients.map((patient) => (
                <PatientRow key={patient.patient_id} patient={patient} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function PatientRow({ patient }: { patient: Patient360 }) {
  const criticalCount = patient.active_alerts.filter((a) => a.severity === "critical").length
  const highCount = patient.active_alerts.filter((a) => a.severity === "high").length
  const vitals = patient.vitals_summary.latest
  const thresholds = patient.personalized_thresholds

  // Check if vitals are outside thresholds
  const hrStatus = getVitalStatus(vitals.heart_rate, thresholds.heart_rate.low, thresholds.heart_rate.high)
  const spo2Status = getVitalStatus(vitals.spo2, thresholds.spo2.low, thresholds.spo2.high)
  const tempStatus = getVitalStatus(vitals.temperature, thresholds.temperature.low, thresholds.temperature.high)
  const rrStatus = getVitalStatus(vitals.respiratory_rate, thresholds.respiratory_rate.low, thresholds.respiratory_rate.high)

  return (
    <TableRow className="group">
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {patient.demographics.given[0]}{patient.demographics.family[0]}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{patient.demographics.name}</span>
              <ProfileBadge profile={patient.profile_type} />
            </div>
            <p className="text-xs text-muted-foreground">MRN: {patient.mrn}</p>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <span className="text-sm">
          {patient.demographics.age}y {patient.demographics.gender === "female" ? "F" : "M"}
        </span>
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {patient.conditions.slice(0, 2).map((condition, i) => (
            <Badge key={i} variant="outline" className="text-xs truncate max-w-[120px]">
              {getConditionShortName(condition.display)}
            </Badge>
          ))}
          {patient.conditions.length > 2 && (
            <Badge variant="outline" className="text-xs">
              +{patient.conditions.length - 2}
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-3 text-xs">
          <VitalIndicator 
            icon={Heart} 
            value={`${Math.round(vitals.heart_rate)}`}
            unit="bpm"
            status={hrStatus}
          />
          <VitalIndicator 
            icon={ActivityIcon} 
            value={`${vitals.spo2.toFixed(1)}`}
            unit="%"
            status={spo2Status}
          />
          <VitalIndicator 
            icon={Thermometer} 
            value={`${vitals.temperature.toFixed(1)}`}
            unit="°C"
            status={tempStatus}
            className="hidden sm:flex"
          />
          <VitalIndicator 
            icon={Wind} 
            value={`${Math.round(vitals.respiratory_rate)}`}
            unit="/m"
            status={rrStatus}
            className="hidden sm:flex"
          />
        </div>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-1.5">
          {criticalCount > 0 && (
            <Badge variant="destructive" className="gap-1 px-1.5">
              <AlertTriangle className="h-3 w-3" />
              {criticalCount}
            </Badge>
          )}
          {highCount > 0 && (
            <Badge className="gap-1 px-1.5 bg-warning text-warning-foreground">
              {highCount}
            </Badge>
          )}
          {criticalCount === 0 && highCount === 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              None
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell className="hidden lg:table-cell">
        <span className="text-sm text-muted-foreground">
          {patient.hospital_name.split(" ").slice(0, 2).join(" ")}
        </span>
      </TableCell>

      <TableCell>
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/patients/${patient.patient_id}`}>
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">View patient</span>
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function ProfileBadge({ profile }: { profile: Patient360["profile_type"] }) {
  const variants: Record<typeof profile, { label: string; className: string }> = {
    target: { label: "High Risk", className: "bg-destructive/10 text-destructive border-destructive/20" },
    diabetic: { label: "Diabetic", className: "bg-warning/10 text-warning border-warning/20" },
    cardiac: { label: "Cardiac", className: "bg-chart-1/10 text-chart-1 border-chart-1/20" },
    healthy: { label: "Healthy", className: "bg-success/10 text-success border-success/20" },
  }

  const { label, className } = variants[profile]

  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", className)}>
      {label}
    </Badge>
  )
}

function VitalIndicator({
  icon: Icon,
  value,
  unit,
  status,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  unit: string
  status: "normal" | "warning" | "critical"
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Icon className={cn(
        "h-3 w-3",
        status === "normal" && "text-muted-foreground",
        status === "warning" && "text-warning",
        status === "critical" && "text-destructive"
      )} />
      <span className={cn(
        "tabular-nums",
        status === "warning" && "text-warning",
        status === "critical" && "text-destructive"
      )}>
        {value}
      </span>
      <span className="text-muted-foreground">{unit}</span>
    </div>
  )
}

function getVitalStatus(value: number, low: number, high: number): "normal" | "warning" | "critical" {
  if (value < low * 0.9 || value > high * 1.1) return "critical"
  if (value < low || value > high) return "warning"
  return "normal"
}

function getConditionShortName(display: string): string {
  const shortNames: Record<string, string> = {
    "Type 2 diabetes mellitus": "T2DM",
    "Type 2 diabetes mellitus with hyperglycemia": "T2DM",
    "Chronic kidney disease stage 3": "CKD 3",
    "Chronic kidney disease stage 4": "CKD 4",
    "Essential hypertension": "HTN",
    "Peripheral neuropathy": "Neuropathy",
    "Congestive heart failure": "CHF",
    "Atrial fibrillation": "A-fib",
    "Chronic obstructive pulmonary disease": "COPD",
  }

  return shortNames[display] || display.split(" ").slice(0, 2).join(" ")
}
