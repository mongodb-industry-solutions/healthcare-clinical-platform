"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Wand2 } from "lucide-react";
import { TALK_TRACK } from "@/lib/const/talkTrack";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const InfoWizard = ({ sections = TALK_TRACK }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-2"
        onClick={() => setOpen(true)}
      >
        <Wand2 className="h-4 w-4" />
        Tell me more!
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl !bg-white p-0 pb-6">
          <DialogTitle className="sr-only">Platform Guide</DialogTitle>
          <Tabs defaultValue="0" className="px-6 pb-10 pt-4 overflow-y-auto max-h-[500px]">
            <TabsList className="mb-4">
              {sections.map((tab, i) => (
                <TabsTrigger key={i} value={String(i)}>
                  {tab.heading}
                </TabsTrigger>
              ))}
            </TabsList>

            {sections.map((tab, tabIndex) => (
              <TabsContent
                key={tabIndex}
                value={String(tabIndex)}
                className="space-y-6 pr-1"
              >
                {tab.content.map((section, sectionIndex) => (
                  <div key={sectionIndex}>
                    {section.heading && (
                      <h3 className="text-2xl font-semibold mb-2">
                        {section.heading}
                      </h3>
                    )}
                    {section.body &&
                      (Array.isArray(section.body) ? (
                        section.ordered ? (
                          <ol className="list-decimal pl-5 space-y-2 text-base text-black">
                            {section.body.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ol>
                        ) : (
                        <ul className="list-disc pl-5 space-y-1 text-base text-black">
                          {section.body.map((item, idx) =>
                            typeof item === "object" ? (
                              <li key={idx}>
                                {item.heading}
                                <ul className="list-disc pl-5 mt-1 space-y-1">
                                  {item.body?.map((subItem, subIdx) => (
                                    <li key={subIdx}>{subItem}</li>
                                  ))}
                                </ul>
                              </li>
                            ) : (
                              <li key={idx}>{item}</li>
                            )
                          )}
                        </ul>
                        )
                      ) : (
                        <p className="text-base text-black">
                          {section.body}
                        </p>
                      ))}
                    {section.image && (
                      <div className={`relative w-full flex justify-center items-center mt-4`} style={{ height: section.image.height ?? 250 }}>
                        <Image
                          src={section.image.src}
                          alt={section.image.alt}
                          fill
                          sizes="(max-width: 768px) 90vw, 700px"
                          style={{ objectFit: "contain", objectPosition: "center" }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InfoWizard;
