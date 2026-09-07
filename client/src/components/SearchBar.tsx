/** Revamp brandbook: use rounded white search surfaces, concise labels, and one unmistakable orange primary action. */
import { FormEvent, useState } from "react";
import { CalendarDays, MapPin, Search } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function SearchBar({ compact = false, initialQuery = "", initialType = "all" }: { compact?: boolean; initialQuery?: string; initialType?: string }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState(initialType || "all");
  const [date, setDate] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (type !== "all") params.set("type", type);
    if (date) params.set("date", date);
    navigate(`/explore${params.toString() ? `?${params}` : ""}`);
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "search-desk grid bg-chalk text-basalt shadow-[0_22px_60px_rgba(35,35,33,0.14)]",
        compact ? "gap-px border border-basalt/10 md:grid-cols-[1.6fr_1fr_auto]" : "gap-px border border-basalt/10 lg:grid-cols-[1.5fr_0.85fr_0.9fr_auto]",
      )}
    >
      <label className="flex min-h-[78px] items-center gap-3 bg-chalk px-5 py-3">
        <MapPin className="h-5 w-5 shrink-0 text-tuff" />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-basalt/45">Where</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Yerevan, Dilijan, wine…"
            className="h-auto border-0 bg-transparent px-0 py-1 text-[15px] font-semibold shadow-none placeholder:text-basalt/35 focus-visible:ring-0"
          />
        </span>
      </label>
      <div className="flex min-h-[78px] items-center bg-chalk px-5 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-basalt/45">Explore</span>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-auto w-full border-0 bg-transparent px-0 py-1 text-[15px] font-semibold shadow-none focus:ring-0">
              <SelectValue placeholder="Everything" />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-chalk">
              <SelectItem value="all">Everything</SelectItem>
              <SelectItem value="stay">Places to stay</SelectItem>
              <SelectItem value="eat">Restaurants</SelectItem>
              <SelectItem value="tour">Tours & experiences</SelectItem>
            </SelectContent>
          </Select>
        </span>
      </div>
      {!compact && (
        <label className="flex min-h-[78px] items-center gap-3 bg-chalk px-5 py-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-sevan" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-basalt/45">When</span>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-auto border-0 bg-transparent px-0 py-1 text-[15px] font-semibold shadow-none focus-visible:ring-0"
            />
          </span>
        </label>
      )}
      <Button type="submit" className="min-h-[78px] rounded-none bg-apricot px-7 text-white hover:bg-apricot/90">
        <Search className="mr-2 h-4 w-4" /> Search
      </Button>
    </form>
  );
}
