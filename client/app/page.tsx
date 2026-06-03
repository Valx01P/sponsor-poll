"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Moon,
  Search,
  Sun,
  Users,
  X,
} from "lucide-react";
import { gsap } from "gsap";
import { toast } from "sonner";

import type { SponsorContact, SponsorData, SponsorMarket, SponsorProspect } from "../lib/types";
import rawData from "../data/sponsors.json";

type OutreachFilter = "all" | "contacted" | "incomplete" | "untouched";
type ViewMode = "compact" | "cards";
type SearchTerm = { token: string; alternatives: string[] };
type SearchScope = {
  marketOnly: boolean;
  prospectIds: Set<string>;
  fullProspectIds: Set<string>;
  contactKeys: Set<string>;
};

const data = rawData as SponsorData;
const allMarkets = data.markets;
const CONTACTED_KEY = "sp-contacted-v1";
const VIEW_KEY = "sp-view-v1";
const SIM_KEY = "sp-sim-threshold-v1";
const SEARCH_ALIASES: Record<string, string[]> = {
  lgbt: ["lgbt", "lgbtq", "lgbtqia"],
  lgbtq: ["lgbtq", "lgbt", "lgbtqia"],
  lgbtqia: ["lgbtqia", "lgbtq", "lgbt"],
  lgtb: ["lgbtq", "lgbt", "lgbtqia"],
  lgtbq: ["lgbtq", "lgbt", "lgbtqia"],
};

const keyPart = (value?: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");

const firstKeyPart = (...values: Array<string | undefined>) => values.map(keyPart).find(Boolean) || "";
const prospectKeyPart = (prospect: SponsorProspect) => firstKeyPart(prospect.id, prospect.name);
const contactIdentityPart = (contact: SponsorContact, index: number) =>
  firstKeyPart(
    contact.email,
    contact.linkedin_url,
    contact.contact_url,
    contact.phone,
    `${contact.name || ""}-${contact.title || ""}-${contact.location || ""}`,
    String(index),
  );

const legacyContactKey = (marketId: string, prospect: SponsorProspect, contact: SponsorContact, index: number) =>
  `${marketId}#${keyPart(prospect.name)}#${keyPart(contact.name) || index}`;

const contactKey = (marketId: string, prospect: SponsorProspect, contact: SponsorContact, index: number) =>
  `${marketId}#${prospectKeyPart(prospect)}#${contactIdentityPart(contact, index)}`;

function migrateContactedKeys(saved: Set<string>) {
  const next = new Set(saved);
  let changed = false;

  for (const market of allMarkets) {
    let index = 0;
    for (const prospect of market.prospects || []) {
      for (const contact of prospect.contacts || []) {
        const legacy = legacyContactKey(market.id, prospect, contact, index);
        const current = contactKey(market.id, prospect, contact, index);
        index++;
        if (legacy === current || !next.has(legacy)) continue;
        next.add(current);
        next.delete(legacy);
        changed = true;
      }
    }
  }

  return { keys: next, changed };
}

const prospectRenderKey = (marketId: string, prospect: SponsorProspect, index: number) =>
  `${marketId}#${prospectKeyPart(prospect) || index}`;

const prospectIdentity = (prospect: SponsorProspect) => prospect.id || prospect.name;
const prospectCount = (market: SponsorMarket) => market.prospects?.length || 0;
const contactCount = (market: SponsorMarket) =>
  (market.prospects || []).reduce((sum, prospect) => sum + (prospect.contacts?.length || 0), 0);

function normalizeSearchText(value: unknown) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return text ? ` ${text} ` : " ";
}

function searchText(parts: unknown[]) {
  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

function searchTerms(query: string): SearchTerm[] {
  const seen = new Set<string>();
  return normalizeSearchText(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({ token, alternatives: SEARCH_ALIASES[token] || [token] }))
    .filter((term) => {
      if (seen.has(term.token)) return false;
      seen.add(term.token);
      return true;
    });
}

function hasSearchTerm(hay: string, term: SearchTerm) {
  return term.alternatives.some((alternative) => {
    const normalized = normalizeSearchText(alternative).trim();
    if (!normalized) return false;
    return normalized.length <= 3 ? hay.includes(` ${normalized} `) : hay.includes(normalized);
  });
}

function matchesSearchTerms(hay: string, terms: SearchTerm[]) {
  return !terms.length || terms.every((term) => hasSearchTerm(hay, term));
}

function createSearchScope(marketOnly = false): SearchScope {
  return {
    marketOnly,
    prospectIds: new Set<string>(),
    fullProspectIds: new Set<string>(),
    contactKeys: new Set<string>(),
  };
}

function scopeIsFiltering(scope?: SearchScope) {
  return Boolean(scope && !scope.marketOnly);
}

function shouldShowProspect(prospect: SponsorProspect, scope?: SearchScope) {
  return !scopeIsFiltering(scope) || scope!.prospectIds.has(prospectIdentity(prospect));
}

function shouldShowContact(marketId: string, prospect: SponsorProspect, contact: SponsorContact, index: number, scope?: SearchScope) {
  if (!scopeIsFiltering(scope)) return true;
  const prospectId = prospectIdentity(prospect);
  return scope!.fullProspectIds.has(prospectId) || scope!.contactKeys.has(contactKey(marketId, prospect, contact, index));
}

function flattenContacts(market: SponsorMarket, scope?: SearchScope) {
  const rows: { prospect: SponsorProspect; contact: SponsorContact; index: number }[] = [];
  let index = 0;
  for (const prospect of market.prospects || []) {
    for (const contact of prospect.contacts || []) {
      if (shouldShowContact(market.id, prospect, contact, index, scope)) rows.push({ prospect, contact, index });
      index++;
    }
  }
  return rows;
}

function visibleProspectCount(market: SponsorMarket, scope?: SearchScope) {
  return scopeIsFiltering(scope) ? (market.prospects || []).filter((prospect) => shouldShowProspect(prospect, scope)).length : prospectCount(market);
}

function visibleContactCount(market: SponsorMarket, scope?: SearchScope) {
  return flattenContacts(market, scope).length;
}

export default function SponsorPollDirectory() {
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPriorities, setSelectedPriorities] = useState<Set<number>>(new Set([1, 2, 3]));
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<"priority" | "prospects" | "name">("priority");
  const [sortReversed, setSortReversed] = useState(false);
  const [outreachFilter, setOutreachFilter] = useState<OutreachFilter>("all");
  const [hideContacted, setHideContacted] = useState(false);
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>("compact");
  const [contacted, setContacted] = useState<Set<string>>(new Set());
  const [activeContactKey, setActiveContactKey] = useState<string | null>(null);
  const contactedRef = useRef(contacted);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "compact" || saved === "cards") setView(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONTACTED_KEY);
      if (raw) {
        const migrated = migrateContactedKeys(new Set(JSON.parse(raw)));
        setContacted(migrated.keys);
        if (migrated.changed) localStorage.setItem(CONTACTED_KEY, JSON.stringify([...migrated.keys]));
      }
    } catch {}
  }, []);

  useEffect(() => {
    contactedRef.current = contacted;
  }, [contacted]);

  const persist = (set: Set<string>) => {
    try {
      localStorage.setItem(CONTACTED_KEY, JSON.stringify([...set]));
    } catch {}
  };

  const toggleContact = useCallback((key: string) => {
    const nowOn = !contactedRef.current.has(key);
    setContacted((prev) => {
      const next = new Set(prev);
      if (nowOn) next.add(key);
      else next.delete(key);
      persist(next);
      return next;
    });
  }, []);

  const markContacted = useCallback((key: string) => {
    if (contactedRef.current.has(key)) return;
    setContacted((prev) => {
      const next = new Set(prev);
      next.add(key);
      persist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (searchInput === "") {
      setSearchQuery("");
      return;
    }
    const timer = setTimeout(() => setSearchQuery(searchInput), 180);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const indexed = useMemo(
    () =>
      allMarkets.map((market) => {
        const marketParts = [
          market.name,
          market.region_type,
          market.country,
          market.region,
          market.description,
          market.prospect_notes || "",
          ...(market.poll_topics || []),
        ];
        const marketHay = searchText(marketParts);
        let contactIndex = 0;
        const prospects = (market.prospects || []).map((prospect) => {
          const prospectHay = searchText([
            prospect.name,
            prospect.prospect_type,
            prospect.description,
            prospect.location || "",
            prospect.political_leaning || "",
            prospect.sponsor_fit || "",
            prospect.sponsorship_history || "",
            prospect.prior_poll_sponsorship || "",
            prospect.estimated_budget || "",
            prospect.notes || "",
          ]);
          const contacts = (prospect.contacts || []).map((contact) => ({
            contact,
            index: contactIndex++,
            hay: searchText([contact.name, contact.title, contact.email || "", contact.location || "", contact.political_leaning || "", contact.notes || ""]),
          }));
          const hay = `${prospectHay} ${contacts.map((contact) => contact.hay).join(" ")}`;
          return { prospect, hay, prospectHay, contacts };
        });
        return { market, marketHay, hay: `${marketHay} ${prospects.map((prospect) => prospect.hay).join(" ")}`, prospects };
      }),
    [],
  );

  const rollup = useMemo(() => {
    const map = new Map<string, { contacted: number; total: number }>();
    for (const market of allMarkets) {
      let total = 0;
      let count = 0;
      for (const prospect of market.prospects || []) {
        for (const contact of prospect.contacts || []) {
          if (contacted.has(contactKey(market.id, prospect, contact, total))) count++;
          total++;
        }
      }
      map.set(market.id, { contacted: count, total });
    }
    return map;
  }, [contacted]);

  const typeChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const market of allMarkets) counts.set(market.region_type, (counts.get(market.region_type) || 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key[0].toUpperCase() + key.slice(1), count }));
  }, []);

  const totalProspects = useMemo(() => allMarkets.reduce((sum, market) => sum + prospectCount(market), 0), []);
  const totalContacts = useMemo(() => allMarkets.reduce((sum, market) => sum + contactCount(market), 0), []);
  const populatedMarkets = useMemo(() => allMarkets.filter((market) => prospectCount(market) > 0).length, []);
  const contactedCount = useMemo(() => [...rollup.values()].reduce((sum, value) => sum + value.contacted, 0), [rollup]);

  const keywordResults = useMemo(() => {
    const terms = searchTerms(searchQuery);
    const scopes = new Map<string, SearchScope>();
    let result = indexed
      .filter((entry) => {
        const { market, hay, marketHay, prospects } = entry;
        if (!selectedPriorities.has(market.priority)) return false;
        if (selectedTypes.size && !selectedTypes.has(market.region_type)) return false;
        const status = rollup.get(market.id)!;
        if (outreachFilter === "contacted" && status.contacted === 0) return false;
        if (outreachFilter === "incomplete" && status.total > 0 && status.contacted >= status.total) return false;
        if (outreachFilter === "untouched" && status.contacted !== 0) return false;
        if (hideContacted && status.total > 0 && status.contacted >= status.total) return false;
        if (terms.length && !matchesSearchTerms(hay, terms)) return false;
        if (terms.length) {
          const scope = createSearchScope(matchesSearchTerms(marketHay, terms));
          if (!scope.marketOnly) {
            for (const prospectEntry of prospects) {
              const prospectHay = `${marketHay} ${prospectEntry.prospectHay}`;
              const prospectMatches = matchesSearchTerms(prospectHay, terms);
              const matchingContacts = prospectEntry.contacts.filter((contactEntry) => matchesSearchTerms(`${prospectHay} ${contactEntry.hay}`, terms));
              if (!prospectMatches && matchingContacts.length === 0) continue;

              const prospectId = prospectIdentity(prospectEntry.prospect);
              scope.prospectIds.add(prospectId);
              if (prospectMatches) scope.fullProspectIds.add(prospectId);
              else {
                for (const { contact, index } of matchingContacts) {
                  scope.contactKeys.add(contactKey(market.id, prospectEntry.prospect, contact, index));
                }
              }
            }
          }
          scopes.set(market.id, scope.prospectIds.size || scope.marketOnly ? scope : createSearchScope(true));
        }
        return true;
      })
      .map(({ market }) => market);

    result = result.sort((a, b) => {
      if (sortMode === "prospects") return prospectCount(b) - prospectCount(a) || a.name.localeCompare(b.name);
      if (sortMode === "priority") return a.priority - b.priority || prospectCount(b) - prospectCount(a) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    if (sortReversed) result.reverse();
    return { markets: result, scopes };
  }, [indexed, selectedPriorities, selectedTypes, rollup, outreachFilter, hideContacted, searchQuery, sortMode, sortReversed]);

  const filteredMarkets = keywordResults.markets;
  const keywordScopes = keywordResults.scopes;
  const PAGE = 80;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [searchQuery, selectedPriorities, selectedTypes, outreachFilter, hideContacted, sortMode, sortReversed]);

  const visibleMarkets = filteredMarkets.slice(0, visibleCount);
  const visibleProspects = filteredMarkets.reduce((sum, market) => sum + visibleProspectCount(market, keywordScopes.get(market.id)), 0);
  const visibleContacts = filteredMarkets.reduce((sum, market) => sum + visibleContactCount(market, keywordScopes.get(market.id)), 0);

  type Suggestion = { market: SponsorMarket; similarity: number; scope?: SearchScope };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [semanticError, setSemanticError] = useState(false);
  const [simThreshold, setSimThreshold] = useState(0.74);
  const marketById = useMemo(() => new Map(allMarkets.map((market) => [market.id, market])), []);
  const noKeywordResults = filteredMarkets.length === 0 && searchQuery.trim().length >= 2;

  useEffect(() => {
    try {
      const saved = parseFloat(localStorage.getItem(SIM_KEY) || "");
      if (saved >= 0.5 && saved <= 0.95) setSimThreshold(saved);
    } catch {}
  }, []);

  useEffect(() => {
    if (!noKeywordResults) {
      setSuggestions([]);
      setSuggesting(false);
      setSemanticError(false);
      return;
    }
    let cancelled = false;
    setSuggesting(true);
    setSemanticError(false);
    import("../lib/semantic-client")
      .then(({ semanticSearch }) => semanticSearch(searchQuery.trim(), 100))
      .then((matches) => {
        if (cancelled) return;
        const byMarket = new Map<string, Suggestion>();
        for (const match of matches) {
          const marketId = match.market_id || match.id;
          const market = marketById.get(marketId);
          if (!market) continue;

          const existing = byMarket.get(marketId);
          const suggestion = existing || { market, similarity: match.similarity, scope: createSearchScope(false) };
          suggestion.similarity = Math.max(suggestion.similarity, match.similarity);
          if (match.prospect_id) {
            suggestion.scope!.prospectIds.add(match.prospect_id);
            suggestion.scope!.fullProspectIds.add(match.prospect_id);
          } else {
            suggestion.scope = createSearchScope(true);
          }
          byMarket.set(marketId, suggestion);
        }

        setSuggestions(
          [...byMarket.values()]
            .map((suggestion) => (suggestion.scope && !suggestion.scope.marketOnly && suggestion.scope.prospectIds.size === 0 ? { ...suggestion, scope: undefined } : suggestion))
            .sort((a, b) => b.similarity - a.similarity),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([]);
          setSemanticError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSuggesting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noKeywordResults, searchQuery, marketById]);

  const shownSuggestions = useMemo(() => suggestions.filter((suggestion) => suggestion.similarity >= simThreshold), [suggestions, simThreshold]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".sp-row",
        { opacity: 0, y: view === "compact" ? 4 : 10 },
        { opacity: 1, y: 0, duration: view === "compact" ? 0.2 : 0.28, stagger: view === "compact" ? 0.004 : 0.01, ease: "power2.out", overwrite: "auto" },
      );
    }, listRef);
    return () => ctx.revert();
  }, [visibleCount, view]);

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setSelectedPriorities(new Set([1, 2, 3]));
    setSelectedTypes(new Set());
    setSortMode("priority");
    setSortReversed(false);
    setOutreachFilter("all");
    setHideContacted(false);
    setExpandedMarkets(new Set());
    setActiveContactKey(null);
  };

  const toggleMarket = useCallback((id: string) => {
    setActiveContactKey(null);
    setExpandedMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const togglePriority = (priority: number) => {
    const next = new Set(selectedPriorities);
    if (next.has(priority)) next.delete(priority);
    else next.add(priority);
    if (!next.size) next.add(1);
    setSelectedPriorities(next);
  };

  const toggleType = (type: string) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setSelectedTypes(next);
  };

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Failed to copy");
    }
  }, []);

  const open = useCallback((url?: string) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const exportCSV = () => {
    const rows = [
      ["Market", "Region Type", "Country", "Priority", "Prospect", "Type", "Description", "Political Leaning", "Sponsor Fit", "Sponsorship History", "Estimated Budget", "Contact Name", "Title", "Email", "LinkedIn", "Contact URL", "Contacted", "Notes"],
    ];
    for (const market of allMarkets) {
      let contactIndex = 0;
      for (const prospect of market.prospects || []) {
        if (!prospect.contacts?.length) {
          rows.push([market.name, market.region_type, market.country, String(market.priority), prospect.name, prospect.prospect_type, prospect.description, prospect.political_leaning || "", prospect.sponsor_fit || "", prospect.sponsorship_history || "", prospect.estimated_budget || "", "", "", "", "", "", "", prospect.notes || ""]);
        }
        prospect.contacts?.forEach((contact) => {
          rows.push([market.name, market.region_type, market.country, String(market.priority), prospect.name, prospect.prospect_type, prospect.description, prospect.political_leaning || "", prospect.sponsor_fit || "", prospect.sponsorship_history || "", prospect.estimated_budget || "", contact.name, contact.title, contact.email || "", contact.linkedin_url || "", contact.contact_url || "", contacted.has(contactKey(market.id, prospect, contact, contactIndex)) ? "yes" : "", contact.notes || ""]);
          contactIndex++;
        });
      }
    }

    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sponsor-poll-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length - 1} rows`);
  };

  const [exportArmed, setExportArmed] = useState(false);
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleExport = () => {
    if (!exportArmed) {
      setExportArmed(true);
      exportTimer.current = setTimeout(() => setExportArmed(false), 3500);
      return;
    }
    if (exportTimer.current) clearTimeout(exportTimer.current);
    setExportArmed(false);
    exportCSV();
  };

  useEffect(() => () => {
    if (exportTimer.current) clearTimeout(exportTimer.current);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black text-white dark:bg-white dark:text-black">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tighter">Sponsor Poll Lead Directory</h1>
                <p className="text-xs text-zinc-500 -mt-0.5">Polling sponsors, funders, and civic outreach prospects</p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <div className="hidden md:flex items-center gap-4 px-4 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
                <div><span className="font-semibold text-zinc-900 dark:text-white">{allMarkets.length}</span> markets</div>
                <div className="h-3 w-px bg-zinc-300 dark:bg-zinc-700" />
                <div><span className="font-semibold text-emerald-600 dark:text-emerald-400">{populatedMarkets}</span> populated</div>
                <div className="h-3 w-px bg-zinc-300 dark:bg-zinc-700" />
                <div><span className="font-semibold text-blue-600 dark:text-blue-400">{totalProspects}</span> prospects</div>
                <div className="h-3 w-px bg-zinc-300 dark:bg-zinc-700" />
                <div><span className="font-semibold text-emerald-600 dark:text-emerald-400">{contactedCount}</span> contacted</div>
              </div>

              <button
                onClick={handleExport}
                title={exportArmed ? "Confirm CSV export" : "Export leads as CSV"}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium border transition-colors ${exportArmed ? "bg-emerald-600 border-emerald-600 text-white" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                {exportArmed ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                {exportArmed ? "Confirm export" : "Export CSV"}
              </button>

              <ThemeToggle />
            </div>
          </div>

          <div className="mt-3 text-[11px] text-zinc-500 flex items-center gap-2">
            <Calendar className="h-3 w-3" />
            Data last updated {data.meta.last_updated} - {totalProspects} prospects and {totalContacts} contacts across {allMarkets.length} markets
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full px-6 pt-6 pb-4">
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-2 h-4 w-4 text-zinc-400" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search market, sponsor type, political leaning, issue, donor, chamber, PAC, media, or business association..."
              className="w-full pl-9 pr-9 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-black/5 dark:focus:ring-white/10"
            />
            {searchInput && (
              <button onClick={() => setSearchInput("")} className="absolute right-3 top-2 text-zinc-400 hover:text-zinc-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 mr-2">
              <span className="text-xs uppercase tracking-widest text-zinc-500 mr-1">Priority</span>
              {[1, 2, 3].map((priority) => (
                <button
                  key={priority}
                  onClick={() => togglePriority(priority)}
                  className={`badge px-3 py-1 text-xs ${selectedPriorities.has(priority) ? `priority-${priority}` : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 line-through"}`}
                >
                  P{priority}
                </button>
              ))}
            </div>

            <button
              onClick={() => setHideContacted(!hideContacted)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium border ${hideContacted ? "bg-blue-100 dark:bg-blue-950 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400" : "border-zinc-200 dark:border-zinc-800"}`}
            >
              Only uncontacted people
            </button>

            <select value={outreachFilter} onChange={(event) => setOutreachFilter(event.target.value as OutreachFilter)} className="h-8 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 text-xs font-medium">
              <option value="all">Outreach: all</option>
              <option value="contacted">Has contacted people</option>
              <option value="incomplete">Not fully contacted</option>
              <option value="untouched">None contacted</option>
            </select>

            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)} className="h-8 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 text-xs font-medium">
              <option value="priority">Priority</option>
              <option value="prospects">Most prospects</option>
              <option value="name">Market name</option>
            </select>

            <button onClick={() => setSortReversed((value) => !value)} className={`inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium border ${sortReversed ? "bg-zinc-900 text-white dark:bg-white dark:text-black border-transparent" : "border-zinc-200 dark:border-zinc-800"}`}>
              <ArrowUpDown className="h-3.5 w-3.5" /> Reverse
            </button>

            <button onClick={clearFilters} className="ml-auto text-xs px-3 h-8 rounded-full border border-transparent text-zinc-500 hover:text-zinc-700 flex items-center gap-1">
              <X className="h-3.5 w-3.5" /> Reset filters
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs uppercase tracking-widest text-zinc-500 mr-1">Market</span>
            {typeChips.map((type) => (
              <button
                key={type.key}
                onClick={() => toggleType(type.key)}
                className={`text-[10px] px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1 ${selectedTypes.has(type.key) ? "bg-zinc-900 text-white dark:bg-white dark:text-black border-transparent" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                {type.label}
                <span className={selectedTypes.has(type.key) ? "opacity-70" : "text-zinc-400"}>{type.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 mb-3 flex items-center justify-between gap-3 text-sm">
          <div>
            Showing <span className="font-semibold">{filteredMarkets.length}</span> markets
            {searchQuery && <span className="text-zinc-500"> matching "{searchQuery}"</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-zinc-500">{visibleProspects} prospects / {visibleContacts} contacts visible</span>
            <button onClick={() => { setActiveContactKey(null); setExpandedMarkets(new Set(visibleMarkets.map((market) => market.id))); }} className="hidden sm:inline-flex h-7 items-center rounded-full border border-zinc-200 dark:border-zinc-800 px-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Expand visible
            </button>
            <button onClick={() => { setActiveContactKey(null); setExpandedMarkets(new Set()); }} className="hidden sm:inline-flex h-7 items-center rounded-full border border-zinc-200 dark:border-zinc-800 px-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Collapse all
            </button>
            <div className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 p-0.5 text-xs font-medium">
              <button onClick={() => changeView("cards")} className={`px-3 h-7 rounded-full ${view === "cards" ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "text-zinc-500"}`}>Cards</button>
              <button onClick={() => changeView("compact")} className={`px-3 h-7 rounded-full ${view === "compact" ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "text-zinc-500"}`}>Compact</button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto w-full px-6 pb-16 flex-1">
        {filteredMarkets.length === 0 && (
          <div className="py-12 text-center text-zinc-500">
            {noKeywordResults ? (
              <div className="space-y-5">
                <div>
                  No exact matches for <span className="font-medium text-zinc-700 dark:text-zinc-300">"{searchQuery.trim()}"</span>.
                  {suggesting && <span className="ml-2 text-xs text-zinc-400">finding closest markets...</span>}
                </div>
                {shownSuggestions.length > 0 && (
                  <div className="max-w-3xl mx-auto text-left">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs uppercase tracking-widest text-zinc-500">Closest matches by meaning - {shownSuggestions.length}</div>
                      <label className="flex items-center gap-2 text-xs text-zinc-500">
                        <span>Min match</span>
                        <input
                          type="range"
                          min={50}
                          max={95}
                          value={Math.round(simThreshold * 100)}
                          onChange={(event) => {
                            const next = Number(event.target.value) / 100;
                            setSimThreshold(next);
                            try {
                              localStorage.setItem(SIM_KEY, String(next));
                            } catch {}
                          }}
                        />
                      </label>
                    </div>
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-visible">
                      {shownSuggestions.map(({ market, similarity, scope }) => (
                        <div key={market.id} className="relative">
                          <span className="absolute right-3 top-2 z-10 text-[10px] font-mono text-zinc-400">{Math.round(similarity * 100)}%</span>
                          <CompactRow market={market} matchScope={scope} status={rollup.get(market.id)!} contacted={contacted} hideContacted={hideContacted} expanded={expandedMarkets.has(market.id)} activeContactKey={activeContactKey} onShowContact={setActiveContactKey} onCloseContact={() => setActiveContactKey(null)} onToggleMarket={toggleMarket} onToggle={toggleContact} onMark={markContacted} onCopy={copy} onOpen={open} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!suggesting && semanticError && (
                  <div className="max-w-md mx-auto text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl px-4 py-3">
                    Smart search is offline. Try a keyword or reset filters.
                  </div>
                )}
              </div>
            ) : (
              <>
                No markets match your filters. <button onClick={clearFilters} className="underline">Clear filters</button>
              </>
            )}
          </div>
        )}

        {filteredMarkets.length > 0 && (
          view === "compact" ? (
            <div ref={listRef} className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-visible">
              {visibleMarkets.map((market) => (
                <CompactRow key={market.id} market={market} matchScope={keywordScopes.get(market.id)} status={rollup.get(market.id)!} contacted={contacted} hideContacted={hideContacted} expanded={expandedMarkets.has(market.id)} activeContactKey={activeContactKey} onShowContact={setActiveContactKey} onCloseContact={() => setActiveContactKey(null)} onToggleMarket={toggleMarket} onToggle={toggleContact} onMark={markContacted} onCopy={copy} onOpen={open} />
              ))}
            </div>
          ) : (
            <div ref={listRef} className="space-y-3">
              {visibleMarkets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  matchScope={keywordScopes.get(market.id)}
                  status={rollup.get(market.id)!}
                  contacted={contacted}
                  hideContacted={hideContacted}
                  expanded={expandedMarkets.has(market.id)}
                  activeContactKey={activeContactKey}
                  onShowContact={setActiveContactKey}
                  onCloseContact={() => setActiveContactKey(null)}
                  onToggleMarket={toggleMarket}
                  onToggle={toggleContact}
                  onMark={markContacted}
                  onCopy={copy}
                  onOpen={open}
                />
              ))}
            </div>
          )
        )}

        {filteredMarkets.length > visibleCount && (
          <div className="text-center mt-8">
            <button onClick={() => setVisibleCount((count) => count + PAGE)} className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 px-5 h-10 text-sm font-medium">
              Show {Math.min(PAGE, filteredMarkets.length - visibleCount)} more
              <span className="text-zinc-500">({filteredMarkets.length - visibleCount} hidden)</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const flip = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sp-theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  return (
    <button onClick={flip} aria-label="Toggle theme" className="inline-flex items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 w-8 h-8 text-zinc-600 dark:text-zinc-400">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function ContactCheckbox({ checked, onChange, title, size = 14 }: { checked: boolean; onChange: () => void; title: string; size?: number }) {
  return <input type="checkbox" checked={checked} onChange={onChange} title={title} aria-label={title} style={{ width: size, height: size, accentColor: "#16a34a" }} className="shrink-0 cursor-pointer" />;
}

function CompactRow({
  market,
  matchScope,
  status,
  contacted,
  hideContacted,
  expanded,
  activeContactKey,
  onShowContact,
  onCloseContact,
  onToggleMarket,
  onToggle,
  onMark,
  onCopy,
  onOpen,
}: {
  market: SponsorMarket;
  matchScope?: SearchScope;
  status: { contacted: number; total: number };
  contacted: Set<string>;
  hideContacted: boolean;
  expanded: boolean;
  activeContactKey: string | null;
  onShowContact: (key: string | null) => void;
  onCloseContact: () => void;
  onToggleMarket: (id: string) => void;
  onToggle: (key: string) => void;
  onMark: (key: string) => void;
  onCopy: (text: string, label: string) => void;
  onOpen: (url?: string) => void;
}) {
  const rows = flattenContacts(market, matchScope).filter(({ prospect, contact, index }) => !hideContacted || !contacted.has(contactKey(market.id, prospect, contact, index)));
  const shownProspects = visibleProspectCount(market, matchScope);
  const scoped = scopeIsFiltering(matchScope);
  return (
    <div className="sp-row px-3 py-1.5 bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={() => onToggleMarket(market.id)} aria-label={expanded ? `Collapse ${market.name}` : `Expand ${market.name}`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-200 dark:border-zinc-800 text-zinc-500">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <span className={`badge priority-${market.priority}`}>P{market.priority}</span>
        <button onClick={() => onOpen(market.sponsor_search_url)} className="font-semibold text-sm truncate hover:underline inline-flex items-center gap-1" title={market.description}>
          {market.name}
          <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
        </button>
        <span className="text-[11px] text-zinc-400 shrink-0">{market.region_type} / {market.region}</span>
        <span className="text-[10px] text-zinc-400 shrink-0">{scoped ? `${shownProspects}/${prospectCount(market)} matched` : `${prospectCount(market)} prospects`}</span>
        <span className="text-[10px] text-zinc-400 shrink-0">{status.contacted}/{status.total}</span>
      </div>
      {expanded && (rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 pl-8 text-xs">
          {rows.map(({ prospect, contact, index }) => {
            const key = contactKey(market.id, prospect, contact, index);
            const on = contacted.has(key);
            return (
              <ContactChip
                key={key}
                market={market}
                prospect={prospect}
                contact={contact}
                contactKeyValue={key}
                contacted={on}
                open={activeContactKey === key}
                showProspectName
                onToggle={() => onToggle(key)}
                onOpenDetails={() => onShowContact(activeContactKey === key ? null : key)}
                onClose={onCloseContact}
                onMark={() => onMark(key)}
                onCopy={onCopy}
                onOpenUrl={onOpen}
              />
            );
          })}
        </div>
      ) : (
        <div className="pl-8 mt-0.5 text-xs text-zinc-400">{scoped ? "No matching contacts for this search." : "No contacts yet. Use the search link or swarm workflow to populate sponsor leads."}</div>
      ))}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value?: string }) {
  if (!String(value || "").trim()) return null;
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <span className="text-zinc-400">{label}</span>
      <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-zinc-700 dark:text-zinc-200">{value}</span>
    </div>
  );
}

function RouteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 px-2 h-7 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
      {label}
      <ExternalLink className="h-3 w-3 opacity-60" />
    </button>
  );
}

function ContactDetailPopover({
  market,
  prospect,
  contact,
  onClose,
  onMark,
  onCopy,
  onOpenUrl,
}: {
  market: SponsorMarket;
  prospect: SponsorProspect;
  contact: SponsorContact;
  onClose: () => void;
  onMark: () => void;
  onCopy: (text: string, label: string) => void;
  onOpenUrl: (url?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const politicalStanding = contact.political_leaning || prospect.political_leaning;

  useEffect(() => {
    const closeIfOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const openAndMark = (url?: string) => {
    if (!url) return;
    onMark();
    onOpenUrl(url);
  };

  return (
    <div ref={ref} className="absolute left-0 top-full z-50 mt-1 w-[34rem] max-w-[calc(100vw-2rem)] max-h-[min(34rem,calc(100vh-8rem))] overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl p-3 text-left text-xs text-zinc-600 dark:text-zinc-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-zinc-950 dark:text-zinc-50 truncate">{contact.name || prospect.name}</div>
          <div className="text-[11px] text-zinc-500 truncate">{contact.title || prospect.prospect_type}</div>
        </div>
        <button onClick={onClose} aria-label="Close contact details" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 space-y-1">
        <DetailLine label="Market" value={market.name} />
        <DetailLine label="Prospect" value={prospect.name} />
        <DetailLine label="Type" value={prospect.prospect_type} />
        <DetailLine label="Standing" value={politicalStanding} />
        <DetailLine label="Location" value={contact.location || prospect.location} />
        <DetailLine label="Phone" value={contact.phone} />
        <DetailLine label="Email" value={contact.email} />
        <DetailLine label="LinkedIn" value={contact.linkedin_url} />
        <DetailLine label="URL" value={contact.contact_url || prospect.contact_url || prospect.website_url} />
      </div>

      {(prospect.description || prospect.sponsor_fit || prospect.estimated_budget || prospect.sponsorship_history || contact.notes || prospect.notes) && (
        <div className="mt-3 space-y-1.5 border-t border-zinc-100 dark:border-zinc-800 pt-2">
          <DetailLine label="Budget" value={prospect.estimated_budget} />
          <DetailLine label="Fit" value={prospect.sponsor_fit} />
          <DetailLine label="History" value={prospect.sponsorship_history || prospect.prior_poll_sponsorship} />
          <DetailLine label="Notes" value={contact.notes || prospect.notes} />
          <DetailLine label="About" value={prospect.description} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {contact.email && (
          <button onClick={() => { onCopy(contact.email || "", "email"); onMark(); }} className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 px-2 h-7 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Copy email
            <Copy className="h-3 w-3 opacity-60" />
          </button>
        )}
        {contact.phone && <RouteButton label="Call" onClick={() => openAndMark(`tel:${contact.phone}`)} />}
        {contact.linkedin_url && <RouteButton label="LinkedIn" onClick={() => openAndMark(contact.linkedin_url)} />}
        {contact.contact_url && <RouteButton label="Contact URL" onClick={() => openAndMark(contact.contact_url)} />}
        {!contact.contact_url && prospect.contact_url && <RouteButton label="Prospect URL" onClick={() => openAndMark(prospect.contact_url)} />}
        {prospect.website_url && <RouteButton label="Website" onClick={() => openAndMark(prospect.website_url)} />}
      </div>
    </div>
  );
}

function ContactChip({
  market,
  prospect,
  contact,
  contactKeyValue,
  contacted,
  open,
  showProspectName = false,
  onToggle,
  onOpenDetails,
  onClose,
  onMark,
  onCopy,
  onOpenUrl,
}: {
  market: SponsorMarket;
  prospect: SponsorProspect;
  contact: SponsorContact;
  contactKeyValue: string;
  contacted: boolean;
  open: boolean;
  showProspectName?: boolean;
  onToggle: () => void;
  onOpenDetails: () => void;
  onClose: () => void;
  onMark: () => void;
  onCopy: (text: string, label: string) => void;
  onOpenUrl: (url?: string) => void;
}) {
  return (
    <span className="relative inline-flex items-center gap-1 min-w-0">
      <ContactCheckbox checked={contacted} onChange={onToggle} title={contacted ? "Contacted - click to undo" : "Mark contacted"} size={13} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`detail-${keyPart(contactKeyValue)}`}
        onClick={onOpenDetails}
        className={`inline-flex items-center gap-0.5 hover:underline truncate text-left ${contacted ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-300"}`}
        title={`${contact.name || prospect.name} - ${contact.title || prospect.prospect_type}`}
      >
        {contact.name || prospect.name}
        <ChevronDown className={`h-3 w-3 opacity-50 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {showProspectName && <span className="text-zinc-400">{prospect.name}</span>}
      {!showProspectName && contact.title && <span className="text-zinc-400">{contact.title}</span>}
      {open && (
        <ContactDetailPopover
          market={market}
          prospect={prospect}
          contact={contact}
          onClose={onClose}
          onMark={onMark}
          onCopy={onCopy}
          onOpenUrl={onOpenUrl}
        />
      )}
    </span>
  );
}

function MarketCard({
  market,
  matchScope,
  status,
  contacted,
  hideContacted,
  expanded,
  activeContactKey,
  onShowContact,
  onCloseContact,
  onToggleMarket,
  onToggle,
  onMark,
  onCopy,
  onOpen,
}: {
  market: SponsorMarket;
  matchScope?: SearchScope;
  status: { contacted: number; total: number };
  contacted: Set<string>;
  hideContacted: boolean;
  expanded: boolean;
  activeContactKey: string | null;
  onShowContact: (key: string | null) => void;
  onCloseContact: () => void;
  onToggleMarket: (id: string) => void;
  onToggle: (key: string) => void;
  onMark: (key: string) => void;
  onCopy: (text: string, label: string) => void;
  onOpen: (url?: string) => void;
}) {
  const scoped = scopeIsFiltering(matchScope);
  const prospects = expanded ? (market.prospects || []).filter((prospect) => shouldShowProspect(prospect, matchScope)) : [];
  const shownProspects = visibleProspectCount(market, matchScope);
  return (
    <div className="sp-row border border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900 overflow-visible">
      <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-lg tracking-tight">{market.name}</span>
            <span className={`badge priority-${market.priority}`}>P{market.priority}</span>
            <span className="text-[10px] font-mono text-zinc-400">{market.id}</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">{status.contacted}/{status.total} contacted</span>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5 flex flex-wrap gap-x-3">
            <span>{market.region_type}</span>
            <span>{market.region}</span>
            <span>{scoped ? `${shownProspects}/${prospectCount(market)} matched prospects` : `${prospectCount(market)} prospects`}</span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 max-w-3xl leading-relaxed">{market.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onOpen(market.sponsor_search_url)} className="link-btn bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300">
            Find sponsor leads <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onToggleMarket(market.id)} className="link-btn text-xs">
            {expanded ? "Collapse" : "Expand"}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
          {prospects.length === 0 && <div className="px-5 py-3 text-xs text-zinc-500">No sponsor prospects populated yet.</div>}
          {prospects.map((prospect, index) => (
            <div key={prospectRenderKey(market.id, prospect, index)} className="px-5 py-3">
              <div className="flex flex-col md:flex-row md:items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{prospect.name}</span>
                    <span className="text-zinc-400">-</span>
                    <span className="text-zinc-600 dark:text-zinc-400">{prospect.prospect_type}</span>
                    {prospect.political_leaning && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{prospect.political_leaning}</span>}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{prospect.description}</p>
                  {prospect.sponsor_fit && <p className="text-[11px] text-zinc-500 mt-1"><span className="font-medium">Fit:</span> {prospect.sponsor_fit}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {prospect.website_url && <button onClick={() => onOpen(prospect.website_url)} className="link-btn">Website <ExternalLink className="h-3.5 w-3.5" /></button>}
                  {prospect.contact_url && <button onClick={() => onOpen(prospect.contact_url)} className="link-btn">Contact <ExternalLink className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {flattenContacts(market, matchScope)
                  .filter((row) => row.prospect === prospect)
                  .filter(({ prospect, contact, index }) => !hideContacted || !contacted.has(contactKey(market.id, prospect, contact, index)))
                  .map(({ contact, index }) => {
                    const key = contactKey(market.id, prospect, contact, index);
                    const on = contacted.has(key);
                    return (
                      <ContactChip
                        key={key}
                        market={market}
                        prospect={prospect}
                        contact={contact}
                        contactKeyValue={key}
                        contacted={on}
                        open={activeContactKey === key}
                        onToggle={() => onToggle(key)}
                        onOpenDetails={() => onShowContact(activeContactKey === key ? null : key)}
                        onClose={onCloseContact}
                        onMark={() => onMark(key)}
                        onCopy={onCopy}
                        onOpenUrl={onOpen}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
