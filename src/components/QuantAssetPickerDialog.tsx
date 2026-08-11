"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { AlertCircle, Plus, Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getQuantAssets, type QuantAssetCatalogItem } from "@/lib/backtest/asset-client";

type QuantAssetPickerDialogProps = {
  timeframe: "1d" | "1h";
  from: string;
  to: string;
  selectedSymbols: string[];
  disabled?: boolean;
  onAdd: (asset: QuantAssetCatalogItem) => void;
};

export function QuantAssetPickerDialog({
  timeframe,
  from,
  to,
  selectedSymbols,
  disabled,
  onAdd,
}: QuantAssetPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [items, setItems] = useState<QuantAssetCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void getQuantAssets({ q: deferredQuery, timeframe, from, to }, (input, init) =>
        fetch(input, { ...init, signal: controller.signal }),
      )
        .then((catalog) => setItems(catalog.items))
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError("Không thể tải danh mục tài sản lúc này.");
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deferredQuery, from, open, timeframe, to]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <Plus data-icon="inline-start" />
          Thêm mã
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chọn tài sản để backtest</DialogTitle>
          <DialogDescription>
            Tìm trong toàn bộ mã hệ thống có dataset {timeframe} phủ đủ khoảng đã chọn.
          </DialogDescription>
        </DialogHeader>

        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="quant-asset-search">Mã hoặc tên tài sản</FieldLabel>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="quant-asset-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ví dụ: FPT, BTC, XAU"
              className="pl-9"
              aria-invalid={Boolean(error)}
              autoComplete="off"
            />
          </div>
          <FieldDescription>Tối đa 10 mã trong một portfolio backtest.</FieldDescription>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>

        <ScrollArea className="h-[360px] pr-3">
          <div className="flex flex-col gap-2" aria-live="polite" aria-busy={loading}>
            {loading ? (
              <Alert>
                <AlertCircle />
                <AlertTitle>Đang kiểm tra dataset</AlertTitle>
                <AlertDescription>
                  Danh sách sẽ cập nhật sau khi tìm kiếm hoàn tất.
                </AlertDescription>
              </Alert>
            ) : null}
            {!loading && !error && items.length === 0 ? (
              <Alert>
                <Search />
                <AlertTitle>Không tìm thấy mã phù hợp</AlertTitle>
                <AlertDescription>
                  Thử từ khóa khác hoặc điều chỉnh khoảng thời gian.
                </AlertDescription>
              </Alert>
            ) : null}
            {items.map((item) => {
              const selected = selectedSymbols.includes(item.symbol);
              const unavailable = !item.backtestable;
              return (
                <Button
                  key={item.symbol}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-16 justify-between gap-3 px-4 py-3 text-left"
                  disabled={selected || unavailable}
                  onClick={() => {
                    onAdd(item);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{item.symbol}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {item.name} · {item.market} · {item.currency}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={item.backtestable ? "secondary" : "outline"}>
                      {selected ? "Đã thêm" : item.backtestable ? "Sẵn sàng" : "Thiếu dữ liệu"}
                    </Badge>
                    <span className="text-xs font-normal text-muted-foreground">
                      {item.rowCount.toLocaleString()} bars
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
