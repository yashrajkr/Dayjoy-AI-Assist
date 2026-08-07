import { Package, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../ui/button";
import { Section } from "../../BusinessIntelligence";

/**
 * Dayjoy currently has a shared product catalog (no per-distributor
 * inventory/stock table) — so both "Products" and "Inventory" route here.
 * This is an honest state, not a placeholder: it links to the real catalog
 * rather than fabricating stock numbers that don't exist in the schema.
 */
export function ProductsInventoryPage() {
  const navigate = useNavigate();
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> Products & Inventory</h1>
      <Section title="Product Catalog" icon={<Package className="w-4 h-4 text-primary" />}>
        <p className="text-sm text-muted-foreground mb-4">
          Dayjoy uses a shared product catalog rather than per-distributor stock — browse the full catalog,
          usage guidance, and recommendations to share with customers.
        </p>
        <Button onClick={() => navigate("/products")}>
          Browse Product Catalog <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </Section>
    </div>
  );
}
