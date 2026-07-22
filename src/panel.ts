export interface PanelAction {
  verb: string;
  label: string;
  kind: "reversible" | "confirm";
}

export interface PanelItem {
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  badge?: string;
}

export interface Panel {
  title: string;
  items: PanelItem[];
  staleAt: number; // epoch ms after which the data is considered stale
  actions: PanelAction[];
}
