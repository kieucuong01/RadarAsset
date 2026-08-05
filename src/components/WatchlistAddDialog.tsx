"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WatchlistItemResponse } from "@/lib/backend/types";
import { saveWatchlistItem } from "@/lib/watchlist-client";

export function WatchlistAddDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (items: WatchlistItemResponse[]) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [alert, setAlert] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSymbol("");
    setAlert("");
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      setError("Vui lòng nhập mã tài sản.");
      return;
    }

    const numericAlert = alert.trim() ? Number(alert) : null;
    if (numericAlert !== null && (!Number.isFinite(numericAlert) || numericAlert <= 0)) {
      setError("Mức cảnh báo phải là số lớn hơn 0.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const items = await saveWatchlistItem({ symbol: normalizedSymbol, alert: numericAlert });
      onSaved(items);
      toast.success(`Đã thêm ${normalizedSymbol} vào watchlist.`);
      reset();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể thêm tài sản vào watchlist.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="[&>button]:grid [&>button]:size-11 [&>button]:place-items-center">
        <DialogHeader>
          <DialogTitle>Thêm tài sản vào watchlist</DialogTitle>
          <DialogDescription>
            Nhập mã đã có trong hệ thống. Mức cảnh báo là tùy chọn và chưa thể chỉnh sửa sau khi lưu
            trong sprint này.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="watchlist-symbol">Mã tài sản</Label>
            <Input
              id="watchlist-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="BTC"
              autoComplete="off"
              aria-invalid={Boolean(error && !symbol.trim())}
              className="min-h-11"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="watchlist-alert">Mức cảnh báo (tùy chọn)</Label>
            <Input
              id="watchlist-alert"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={alert}
              onChange={(event) => setAlert(event.target.value)}
              placeholder="70000"
              className="min-h-11"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-bear">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="min-h-11"
            >
              Hủy
            </Button>
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {pending ? "Đang lưu…" : "Thêm tài sản"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
