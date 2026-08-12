"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getNotifications,
  markNotificationReadClient,
  type NotificationPage,
} from "@/lib/strategy-forward/client";

export function NotificationCenter() {
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [disabled, setDisabled] = useState(false);
  const load = useCallback(async () => {
    if (disabled) return;
    try {
      setPage(await getNotifications());
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_REQUIRED") setDisabled(true);
    }
  }, [disabled]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (disabled) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 rounded-full bg-muted/60"
          aria-label="Thông báo chiến lược"
        >
          <Bell />
          {!!page?.unreadCount && (
            <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-bear px-1 text-[10px] text-white">
              {Math.min(99, page.unreadCount)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(23rem,calc(100vw-2rem))] p-0">
        <div className="border-b p-4 font-semibold">Thông báo chiến lược</div>
        <div className="max-h-80 overflow-y-auto">
          {!page?.items.length && (
            <p className="p-4 text-sm text-muted-foreground">Chưa có tín hiệu mới.</p>
          )}
          {page?.items.map((item) => (
            <Link
              key={item.id}
              href={`/portfolio?signal=${item.signalId}`}
              onClick={() => {
                if (!item.readAt) {
                  void markNotificationReadClient(item.id).then(load);
                }
              }}
              className="block border-b p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className={item.type === "strategy_buy" ? "text-bull" : "text-bear"}>
                  {item.type === "strategy_buy" ? "MUA" : "BÁN"}
                </span>
                {item.title}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
