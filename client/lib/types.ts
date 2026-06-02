export type Priority = 1 | 2 | 3;
export type RegionType = "state" | "district" | "territory" | "country";

export interface SponsorContact {
  name: string;
  title: string;
  email?: string;
  linkedin_url?: string;
  contact_url?: string;
  phone?: string;
  location?: string;
  political_leaning?: string;
  notes?: string;
}

export interface SponsorProspect {
  id: string;
  name: string;
  prospect_type: string;
  description: string;
  website_url?: string;
  contact_url?: string;
  location?: string;
  political_leaning?: string;
  sponsor_fit?: string;
  sponsorship_history?: string;
  prior_poll_sponsorship?: string;
  estimated_budget?: string;
  notes?: string;
  contacts: SponsorContact[];
}

export interface SponsorMarket {
  id: string;
  name: string;
  region_type: RegionType;
  country: string;
  region: string;
  priority: Priority;
  description: string;
  poll_topics: string[];
  sponsor_search_url: string;
  prospect_notes?: string;
  prospects: SponsorProspect[];
}

export interface SponsorData {
  meta: {
    version: string;
    last_updated: string;
    total_markets: number;
    total_prospects: number;
    total_contacts: number;
    notes?: string;
    [key: string]: unknown;
  };
  markets: SponsorMarket[];
}
