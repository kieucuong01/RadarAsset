import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, BookOpenCheck, ShieldCheck, WalletCards } from "lucide-react";

import { DataVestLogo } from "@/components/DataVestLogo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Giới thiệu và phương pháp",
  description:
    "DataVest.vn hỗ trợ nhà đầu tư cá nhân Việt Nam sử dụng dữ liệu định lượng, quản lý danh mục và kiểm định chiến lược với giới hạn được trình bày rõ.",
  alternates: { canonical: "/gioi-thieu" },
};

const capabilities = [
  {
    href: "/",
    title: "Hiểu bối cảnh thị trường",
    description:
      "Theo dõi tín hiệu định lượng, sự kiện, nguồn dữ liệu và mức độ sẵn sàng của bằng chứng.",
    icon: BookOpenCheck,
  },
  {
    href: "/portfolio",
    title: "Quản lý danh mục mô phỏng",
    description:
      "Theo dõi phân bổ, giao dịch, hiệu suất và rủi ro mà không giả định đây là tài khoản môi giới.",
    icon: WalletCards,
  },
  {
    href: "/quant-lab",
    title: "Kiểm định chiến lược",
    description:
      "Tối ưu phân bổ và backtest trên dữ liệu lịch sử trước khi cân nhắc sử dụng vốn thật.",
    icon: BarChart3,
  },
] as const;

const dataStates = [
  {
    title: "Dữ liệu hệ thống",
    description: "Được tải từ API hoặc cơ sở dữ liệu hiện có.",
  },
  {
    title: "Dữ liệu mẫu",
    description: "Nội dung seed hoặc fallback, không được trình bày như dữ liệu live.",
  },
  {
    title: "Mô phỏng",
    description: "Kết quả minh họa, không phải giao dịch hoặc dự báo thực.",
  },
  {
    title: "Dữ liệu chưa khả dụng",
    description: "Chưa có dữ liệu hệ thống đã xác thực để đưa ra kết luận.",
  },
] as const;

export default function IntroductionPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <article className="space-y-12">
        <header className="max-w-4xl">
          <DataVestLogo lockup decorative={false} markClassName="size-12" />
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            Giới thiệu &amp; phương pháp
          </p>
          <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Đầu tư có căn cứ, bắt đầu từ dữ liệu
          </h1>
          <p className="mt-5 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground">
            {BRAND.positioning} Nền tảng giúp người dùng nhìn thấy cả kết quả, nguồn dữ liệu
            và giới hạn phương pháp thay vì dựa vào nhận định cảm tính.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            <time dateTime="2026-08-16">Cập nhật: 16/08/2026</time>
          </p>
        </header>

        <section aria-labelledby="capabilities-heading">
          <div className="max-w-3xl">
            <h2 id="capabilities-heading" className="text-2xl font-bold tracking-tight">
              DataVest hỗ trợ việc gì?
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Sản phẩm kết nối ba công việc thường bị tách rời trong quy trình của nhà đầu tư cá
              nhân.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {capabilities.map(({ href, title, description, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-colors hover:border-primary/50"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section id="phuong-phap" aria-labelledby="method-heading" className="scroll-mt-24">
          <div className="max-w-3xl">
            <h2 id="method-heading" className="text-2xl font-bold tracking-tight">
              Phương pháp minh bạch trạng thái dữ liệu
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Mỗi kết luận chỉ có ý nghĩa khi người dùng biết dữ liệu đến từ đâu và có thể sử dụng
              đến mức nào. DataVest dùng bốn trạng thái nhất quán:
            </p>
          </div>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            {dataStates.map((state) => (
              <div key={state.title} className="rounded-2xl border border-border bg-card p-5">
                <dt className="font-semibold">{state.title}</dt>
                <dd className="mt-2 text-sm leading-6 text-muted-foreground">
                  {state.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="limits-heading"
          className="rounded-3xl border border-[#f2b84b]/40 bg-accent/60 p-6 sm:p-8"
        >
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="limits-heading" className="text-xl font-bold tracking-tight">
                Giới hạn cần hiểu trước khi sử dụng
              </h2>
              <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
                DataVest cung cấp thông tin và công cụ phân tích, không phải tư vấn tài chính cá
                nhân hóa. Backtest và mô phỏng mô tả dữ liệu lịch sử dưới các giả định cụ thể;
                hiệu quả trong quá khứ không đảm bảo kết quả tương lai. Người dùng chịu trách nhiệm
                cho quyết định và mức rủi ro của mình.
              </p>
            </div>
          </div>
        </section>
      </article>
    </main>
  );
}
