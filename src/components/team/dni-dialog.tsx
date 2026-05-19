"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DniSection } from "@/components/team/dni-section";

interface DniDialogProps {
  children: React.ReactNode;
  userId: string;
  memberName: string;
  canEdit: boolean;
}

export function DniDialog({ children, userId, memberName, canEdit }: DniDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>DNI de {memberName}</DialogTitle>
        </DialogHeader>
        {/* Solo se monta cuando se abre, así no hace fetch innecesario. */}
        {open && <DniSection userId={userId} canEdit={canEdit} />}
      </DialogContent>
    </Dialog>
  );
}
