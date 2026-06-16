"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Square product thumbnail in the table; click to view the full image. */
export function ProductThumb({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div className="grid size-11 place-items-center rounded-lg bg-muted text-muted-foreground">
        <ImageOff className="size-4" />
      </div>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          onError={() => setBroken(true)}
          className="size-11 cursor-zoom-in rounded-lg border object-cover transition hover:ring-2 hover:ring-primary/40"
        />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-base">{name}</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="max-h-[70vh] w-full rounded-xl object-contain" />
      </DialogContent>
    </Dialog>
  );
}
