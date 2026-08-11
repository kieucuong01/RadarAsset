"use client";

import { FavoriteAssetDialog } from "@/components/FavoriteAssetDialog";
import type { WatchlistItemResponse } from "@/lib/backend/types";

/** Compatibility wrapper for the existing Insights entry point. */
export function WatchlistAddDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (items: WatchlistItemResponse[]) => void;
}) {
  return <FavoriteAssetDialog open={open} onOpenChange={onOpenChange} onSaved={onSaved} />;
}
