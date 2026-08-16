"use client";

import type { ComponentProps } from "react";

import { AssetOpinionDetailContent } from "./AssetOpinionModalContent";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export { AssetOpinionDetailContent } from "./AssetOpinionModalContent";

export function AssetOpinionDetail({
  open,
  onOpenChange,
  ...props
}: ComponentProps<typeof AssetOpinionDetailContent> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]"
        data-testid="asset-opinion-detail"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {props.opinion.symbol} · {props.opinion.assetName}
          </DialogTitle>
          <DialogDescription>
            {props.locale === "vi"
              ? "Phân tích định lượng theo tài sản"
              : "Quantitative asset analysis"}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[calc(100dvh-2rem)]">
          <AssetOpinionDetailContent {...props} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
