import { useCallback, useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { biOrders } from "../../../../../lib/api";
import { LoadingState, ErrorState, EmptyState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { KpiCard, fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function OrdersPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof biOrders>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await biOrders(90));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your orders…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-primary" /> Orders</h1>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total Orders (90d)" value={data.total_orders} icon={<ShoppingCart className="w-4 h-4" />} />
        <KpiCard label="Total Amount" value={fmtInr(data.total_amount)} icon={<ShoppingCart className="w-4 h-4" />} />
        <KpiCard label="Avg Order Value" value={fmtInr(data.avg_order_value)} icon={<ShoppingCart className="w-4 h-4" />} />
      </div>

      <AiMiniCard
        title="AI Order Insights"
        prompts={["Which product sells best for me?", "Which customers order most frequently?"]}
      />

      {data.orders.length === 0 ? (
        <EmptyState title="No orders in the last 90 days. Orders appear here as soon as a customer purchase is recorded." />
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-accent/30 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Product</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o, i) => (
                  <tr key={i} className="border-t border-border hover:bg-accent/20">
                    <td className="px-3 py-2">{new Date(String(o.purchase_date || o.created_at)).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{String(o.customer_name || "—")}</td>
                    <td className="px-3 py-2">{String(o.product_name || "—")}</td>
                    <td className="px-3 py-2 text-right">{String(o.quantity || 1)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtInr(Number(o.amount || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
