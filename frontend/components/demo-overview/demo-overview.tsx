"use client"

import * as React from "react"
import { BookOpen, ExternalLink, Github, Presentation } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"

const RESOURCES = [
  {
    icon: Github,
    title: "GitHub Repository",
    description: "Explore the source code and implementation details of this demo.",
    linkLabel: "View the repo →",
    href: "#",
  },
  {
    icon: Presentation,
    title: "Slide Deck",
    description: "Discover how MongoDB Atlas powers real-time clinical decision support.",
    linkLabel: "View the deck →",
    href: "#",
  },
  {
    icon: BookOpen,
    title: "Blog Post",
    description: "Learn more about the dual-layer persistence architecture for healthcare.",
    linkLabel: "Read the blog →",
    href: "#",
  },
]

export function DemoOverview() {
  return (
    <div className="flex flex-col items-center gap-12 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Healthcare Clinical Platform</h1>
        <p className="max-w-xl text-base text-muted-foreground">
          A demonstration of MongoDB Atlas powering real-time clinical decision support — combining FHIR
          interoperability with sub-millisecond operational queries.
        </p>
      </div>

      {/* Process diagram placeholder */}
      <div className="w-full max-w-4xl rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <p className="text-sm font-medium text-muted-foreground">Process diagram coming soon</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          The platform architecture flow will be illustrated here.
        </p>
      </div>

      {/* Related resources */}
      <div className="w-full max-w-4xl">
        <h2 className="mb-6 text-center text-xl font-semibold">Related Resources</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {RESOURCES.map((resource) => (
            <Card
              key={resource.title}
              className="flex flex-col items-center gap-3 border-border/60 p-6 text-center shadow-sm transition-shadow hover:shadow-md"
            >
              <CardContent className="flex flex-col items-center gap-3 p-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <resource.icon className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-base font-semibold">{resource.title}</p>
                <p className="text-sm text-muted-foreground">{resource.description}</p>
                <a
                  href={resource.href}
                  className="mt-1 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {resource.linkLabel}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
