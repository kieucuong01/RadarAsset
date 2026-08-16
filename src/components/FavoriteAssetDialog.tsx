"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { z } from "zod";

import { AssetIcon } from "@/components/AssetIcon";
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
import type { WatchlistItemResponse } from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";
import { addFavoriteAsset } from "@/lib/watchlist-client";

const instrumentSchema = z
  .object({
    id: z.string(),
    providerCode: z.string(),
    providerSymbol: z.string(),
    assetId: z.string(),
    symbol: z.string(),
    name: z.string(),
    market: z.enum(["vn_equity", "crypto_spot", "metal_spot"]),
    venue: z.string().nullable(),
    currency: z.string(),
    supportedTimeframes: z.array(z.enum(["1d", "1h"])),
  })
  .strict();

type Instrument = z.infer<typeof instrumentSchema>;

export function FavoriteAssetDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (items: WatchlistItemResponse[]) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/market/instruments?q=${encodeURIComponent(query.trim())}&limit=20`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(t("favorites.searchError"));
          const parsed = z
            .object({ items: z.array(instrumentSchema) })
            .strict()
            .safeParse(await response.json());
          if (!parsed.success) throw new Error(t("favorites.invalidCatalog"));
          setItems(parsed.data.items);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : t("favorites.searchError"));
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, t]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const favorites = await addFavoriteAsset({
        providerCode: selected.providerCode,
        providerSymbol: selected.providerSymbol,
        requestedTimeframes: selected.supportedTimeframes,
      });
      onSaved(favorites);
      onOpenChange(false);
      setQuery("");
      setSelected(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("favorites.addError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("favorites.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("favorites.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
              }}
              className="pl-9"
              placeholder="VNM, ETH, XAU…"
              aria-label={t("favorites.searchAria")}
            />
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" /> {t("favorites.searching")}
              </p>
            ) : null}
            {!loading && items.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{t("favorites.emptyCatalog")}</p>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                  selected?.id === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <AssetIcon symbol={item.symbol} name={item.name} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{item.symbol}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.name}
                    </span>
                  </span>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {item.providerCode}
                  <br />
                  {item.supportedTimeframes.join(" · ")}
                </span>
              </button>
            ))}
          </div>
          {error ? <p className="text-sm text-bear">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("favorites.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={!selected || saving}>
            {saving ? t("favorites.saving") : t("favorites.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
