import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { DataVestLogo } from "@/components/DataVestLogo";
import { BRAND } from "@/lib/brand";
import { APP_ROUTES } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/context";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-16 border-t border-border bg-card/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Link href="/" aria-label={BRAND.name} className="inline-flex items-center">
            <DataVestLogo lockup />
          </Link>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            {BRAND.descriptor}. {BRAND.tagline}
          </p>
        </div>

        <div className="min-w-0 md:justify-self-end">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {t("footer.product")}
          </h3>
          <ul className="flex flex-col gap-2 text-sm">
            {APP_ROUTES.map((route) => (
              <li key={route.id}>
                <Link href={route.href} className="transition-colors hover:text-primary">
                  {t(`routes.${route.id}`)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/gioi-thieu" className="transition-colors hover:text-primary">
                Giới thiệu &amp; phương pháp
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-3xl items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-bear" />
            <p>
              <span className="font-semibold text-foreground">{t("footer.disclaimerTitle")}</span>{" "}
              DataVest cung cấp thông tin và công cụ phân tích cho mục đích giáo dục, không phải tư
              vấn tài chính cá nhân hóa. Thị trường luôn có rủi ro; hiệu quả trong quá khứ không đảm
              bảo kết quả tương lai.
            </p>
          </div>
          <p className="shrink-0">© {new Date().getFullYear()} DataVest.vn.</p>
        </div>
      </div>
    </footer>
  );
}
