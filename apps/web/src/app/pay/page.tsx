import type { Metadata } from "next";
import { parsePaymentRequest } from "@gta/core/pay";
import { PayPage } from "@/components/PayPage";

export const metadata: Metadata = {
  title: "Payment request · Grand Transfer Agent",
  description: "Review a payment request and sign it with your own wallet.",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const request = parsePaymentRequest({
    get: (name) => {
      const v = raw[name];
      return typeof v === "string" ? v : null;
    },
  });
  return <PayPage request={request} />;
}
