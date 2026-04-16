"use client"

import * as React from "react"
import { AlertTriangle, Lock, LockOpen, Shield, ShieldCheck, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { JsonTreeView } from "@/components/mongodb/json-tree-view"
import {
  fetchEncryptionStatus,
  fetchEncryptionServerView,
  type EncryptionStatusResponse,
  type ServerViewResponse,
} from "@/lib/api"
import type { Patient360 } from "@/lib/mock-data"

type EncryptionComplianceCardProps = {
  patientId: string
  patient360: Patient360
}

type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "error"; error: string }

export function EncryptionComplianceCard({
  patientId,
  patient360,
}: EncryptionComplianceCardProps) {
  const [encStatus, setEncStatus] = React.useState<LoadState<EncryptionStatusResponse>>({
    status: "idle",
  })
  const [serverView, setServerView] = React.useState<LoadState<ServerViewResponse>>({
    status: "idle",
  })

  React.useEffect(() => {
    setEncStatus({ status: "loading" })
    fetchEncryptionStatus()
      .then((data) => setEncStatus({ status: "loaded", data }))
      .catch((err) => setEncStatus({ status: "error", error: String(err) }))
  }, [])

  React.useEffect(() => {
    if (encStatus.status !== "loaded" || !encStatus.data.qe_enabled) return
    setServerView({ status: "loading" })
    fetchEncryptionServerView(patientId)
      .then((data) => setServerView({ status: "loaded", data }))
      .catch((err) => setServerView({ status: "error", error: String(err) }))
  }, [patientId, encStatus])

  if (encStatus.status === "loading") {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading encryption status...
      </div>
    )
  }

  if (encStatus.status === "error") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <AlertTriangle className="h-5 w-5" />
        Could not load encryption status.
      </div>
    )
  }

  if (encStatus.status !== "loaded") return null

  const { data: status } = encStatus

  if (!status.qe_enabled) {
    return <DisabledState />
  }

  return (
    <div className="space-y-6">
      <StatusHeader kmsProvider={status.kms_provider} />

      <ProtectedFieldsTable
        fields={status.encrypted_fields}
        hipaaMapping={status.hipaa_mapping}
      />

      <DocumentComparison
        patient360={patient360}
        serverView={serverView}
      />
    </div>
  )
}

function DisabledState() {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Shield className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-lg">Queryable Encryption Not Enabled</CardTitle>
        <CardDescription className="mx-auto max-w-md">
          MongoDB Queryable Encryption allows you to encrypt sensitive PHI fields while
          maintaining query capability. Enable it by setting <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">QE_ENABLED=true</code> in
          your backend environment, then re-seed the data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mx-auto max-w-sm space-y-2 rounded-lg border bg-muted/30 p-4 font-mono text-xs">
          <p className="text-muted-foreground"># Add to your .env file:</p>
          <p>QE_ENABLED=true</p>
          <p>QE_LOCAL_MASTER_KEY=  <span className="text-muted-foreground"># auto-generated if empty</span></p>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusHeader({ kmsProvider }: { kmsProvider: string }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
        <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            Queryable Encryption Active
          </span>
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
            {kmsProvider.toUpperCase()} KMS
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-400/70">
          Sensitive fields are encrypted client-side before reaching the database.
          The server never sees plaintext for protected fields.
        </p>
      </div>
    </div>
  )
}

function ProtectedFieldsTable({
  fields,
  hipaaMapping,
}: {
  fields: EncryptionStatusResponse["encrypted_fields"]
  hipaaMapping: EncryptionStatusResponse["hipaa_mapping"]
}) {
  const hipaaMap = new Map(hipaaMapping.map((h) => [h.field, h]))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Protected Fields</CardTitle>
        <CardDescription className="text-xs">
          Fields encrypted with MongoDB Queryable Encryption on the <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">patient_360</code> collection.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Field Path</TableHead>
              <TableHead>Query Support</TableHead>
              <TableHead>HIPAA Reference</TableHead>
              <TableHead>Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const hipaa = hipaaMap.get(field.path)
              return (
                <TableRow key={field.path}>
                  <TableCell>
                    {field.queryable ? (
                      <Lock className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-amber-500" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{field.path}</TableCell>
                  <TableCell>
                    {field.queryable ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Equality
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Encrypt only</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {hipaa?.regulation ?? "—"}
                  </TableCell>
                  <TableCell>
                    {hipaa ? (
                      <Badge variant="outline" className="text-[10px]">
                        {hipaa.category}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function DocumentComparison({
  patient360,
  serverView,
}: {
  patient360: Patient360
  serverView: LoadState<ServerViewResponse>
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Document Comparison</h4>
      <p className="text-xs text-muted-foreground">
        Left: what the application sees (auto-decrypted). Right: what the database server stores (raw ciphertext).
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <LockOpen className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs font-medium">Application View (Decrypted)</span>
          </div>
          <JsonTreeView
            value={buildIdentitySubset(patient360)}
            collapsed={false}
            maxHeightClassName="max-h-[32rem]"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium">Server View (Encrypted)</span>
          </div>
          {serverView.status === "loading" && (
            <div className="flex items-center justify-center rounded-lg border bg-muted/20 py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading server view...
            </div>
          )}
          {serverView.status === "error" && (
            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/20 py-16 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Could not load server view.
            </div>
          )}
          {serverView.status === "loaded" && (
            <JsonTreeView
              value={buildIdentitySubset(serverView.data.raw_document as Record<string, unknown>)}
              collapsed={false}
              maxHeightClassName="max-h-[32rem]"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function buildIdentitySubset(doc: Record<string, unknown>): Record<string, unknown> {
  const demographics = (doc.demographics ?? {}) as Record<string, unknown>
  return {
    patient_id: doc.patient_id,
    mrn: doc.mrn,
    demographics: {
      name: demographics.name,
      given: demographics.given,
      family: demographics.family,
      birth_date: demographics.birth_date,
      gender: demographics.gender,
      age: demographics.age,
    },
  }
}
