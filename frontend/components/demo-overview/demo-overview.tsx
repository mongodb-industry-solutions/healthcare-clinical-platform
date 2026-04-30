"use client"

import * as React from "react"

import { Card, CardContent } from "@/components/ui/card"

const RESOURCES = [
  {
    logo: "/github.webp",
    title: "GitHub Repository",
    description: "Explore the source code and implementation details of this demo.",
    linkLabel: "View the repo →",
    href: "https://github.com/mongodb-industry-solutions/healthcare-clinical-platform",
  },
  {
    logo: "/deck.webp",
    title: "Slide Deck",
    description: "Discover how MongoDB Atlas powers real-time clinical decision support.",
    linkLabel: "View the deck →",
    href: "https://docs.google.com/presentation/d/18e_bq8wn5XoZBHu13IYnDMO3TX2DtJy-pGXOVf9kxFI/edit?usp=sharing",
  },
  {
    logo: "/read.webp",
    title: "Blog Post",
    description: "Learn more about the dual-layer persistence architecture for healthcare.",
    linkLabel: "Coming Soon",
    href: null,
  },
]

export function DemoOverview() {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-12 bg-white h-full overflow-hidden">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl sm:text-4xl md:text-5xl tracking-tight" style={{ fontFamily: "Times New Roman, serif", color: "rgb(0, 104, 74)" }}>Clinical Operations Platform</h1>
      </div>

      {/* Process diagram */}
      <div className="w-full max-w-4xl">
        <img
          src="/process-diagram.png"
          alt="Platform process diagram"
          className="w-1/2 rounded-xl mx-auto"
        />
      </div>

      {/* Related resources */}
      <div className="w-full max-w-4xl">
        <h2 className="mb-6 text-center text-xl font-semibold">Related Resources</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {RESOURCES.map((resource) => (
            <Card
              key={resource.title}
              className="flex flex-col items-center gap-3 border-border/60 p-6 text-center shadow-lg transition-shadow hover:shadow-xl"
            >
              <CardContent className="flex flex-col items-center gap-2 p-0">
                <div className="flex h-8 w-8 items-center justify-center">
                  <img src={resource.logo} alt={resource.title} className="h-8 w-8 object-contain" />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xl font-semibold">{resource.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{resource.description}</p>
                </div>
                {resource.href ? (
                  <a
                    href={resource.href}
                    className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {resource.linkLabel}
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">{resource.linkLabel}</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
