/**
 * Auth-aware booking action, shared by the stay/tour/eat detail sidebar
 * (ListingPage.tsx) and the tour-specific detail layout (TourDetail.tsx),
 * each in both their sticky desktop sidebar and mobile bottom bar.
 *
 * Milestone A ships accounts but not payments (see the marketplace plan —
 * Stripe checkout is Milestone B), so this deliberately never claims a
 * booking succeeded the way the old "noted" toast did: a signed-out visitor
 * is sent to sign in (and back to this listing afterward — see Login.tsx's
 * `redirect` param); a signed-in visitor sees a plainly disabled
 * "Payments coming soon" control instead of a silent fake confirmation.
 */
import { Link } from "wouter";
import { LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BookingCta({
  slug,
  variant = "full",
  className,
}: {
  slug: string;
  variant?: "full" | "compact";
  className?: string;
}) {
  const { user, loading } = useAuth();
  const sizing = variant === "full" ? "h-12 w-full" : "h-11 px-5";

  if (loading) {
    return (
      <Button disabled className={cn(sizing, "rounded-none bg-basalt/10 text-basalt/40", className)}>
        …
      </Button>
    );
  }

  if (!user) {
    return (
      <Button asChild className={cn(sizing, "rounded-none bg-apricot text-white hover:bg-apricot/90", className)}>
        <Link href={`/login?redirect=${encodeURIComponent(`/listing/${slug}`)}`}>
          <LogIn className="mr-2 h-4 w-4" /> Sign in to book
        </Link>
      </Button>
    );
  }

  return (
    <Button
      disabled
      title="Online booking and payment are launching soon."
      className={cn(sizing, "cursor-not-allowed rounded-none bg-basalt/10 text-basalt/45 hover:bg-basalt/10", className)}
    >
      Payments coming soon
    </Button>
  );
}
