import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crosshair, Network, AlertTriangle, Radar, Shield, Globe2,
  Settings, Bell, Menu, ChevronLeft, ShieldAlert, Wifi, WifiOff,
  Send, CheckCircle, LogOut, User, Clock,
} from "lucide-react";
import { api, getAccessToken, getUserId, getDisplayName, clearAuthSession } from "@/lib/api";
import { useWSQueryInvalidation, useWebSocket } from "@/hooks/use-websocket";
import { toast } from "@/components/ui/sonner";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  const userId = getUserId();
  return {
    "Content-Type": "application/json",
    "X-User-Id": userId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const NAV_ITEMS = [
  { title: "Command", icon: Crosshair, path: "/dashboard", description: "Live briefing" },
  { title: "Network", icon: Network, path: "/dashboard/network", description: "Supplier graph" },
  { title: "AR View", icon: Globe2, path: "/dashboard/ar-view", description: "3D globe" },
  { title: "Incidents", icon: AlertTriangle, path: "/dashboard/incidents", description: "Auto-analyzed" },
  { title: "Intelligence", icon: Radar, path: "/dashboard/intelligence", description: "Signals & map" },
  { title: "Compliance", icon: Shield, path: "/dashboard/compliance", description: "Audit & export" },
];

interface DashboardNotification {
  id: string;
  title: string;
  description: string;
  type: string;
  timestamp: string;
  read: boolean;
  link?: string;
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case "incident":
      return AlertTriangle;
    case "checkpoint":
      return Shield;
    case "signal":
      return Radar;
    case "rfq":
      return Send;
    case "resolved":
      return CheckCircle;
    default:
      return AlertTriangle;
  }
};

const getNotificationIconColor = (type: string) => {
  switch (type) {
    case "incident":
      return "text-red-500";
    case "checkpoint":
      return "text-orange-500";
    case "signal":
      return "text-blue-500";
    case "rfq":
      return "text-indigo-500";
    case "resolved":
      return "text-green-500";
    default:
      return "text-slate-500";
  }
};

const formatTimeAgo = (timestampStr: string) => {
  try {
    const date = new Date(timestampStr);
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return "";
  }
};

const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ONBOARDING_CACHE_PREFIX = "onboarding_status:";

function readCachedOnboardingStatus(tenantId: string): { user_id: string; complete: boolean; updated_at?: string } | null {
  try {
    const raw = localStorage.getItem(`${ONBOARDING_CACHE_PREFIX}${tenantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user_id?: string; complete?: boolean; updated_at?: string };
    if (!parsed || typeof parsed !== "object") return null;
    return {
      user_id: String(parsed.user_id || tenantId),
      complete: Boolean(parsed.complete),
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
    };
  } catch {
    return null;
  }
}

function writeCachedOnboardingStatus(
  tenantId: string,
  status: { user_id: string; complete: boolean; updated_at?: string } | undefined,
): void {
  try {
    if (!status) return;
    localStorage.setItem(`${ONBOARDING_CACHE_PREFIX}${tenantId}`, JSON.stringify(status));
  } catch {
    // Best-effort cache only.
  }
}

const DashboardLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  void setCollapsed; // sidebar collapse reserved for future toggle
  const queryClient = useQueryClient();

  const tenantId = getUserId();
  useWSQueryInvalidation(tenantId, queryClient);
  const { lastEvent, isConnected: wsConnected } = useWebSocket(tenantId);
  const hasToken = Boolean(getAccessToken());

  const {
    data: onboardingStatus,
    isLoading: isOnboardingStatusLoading,
    isError: isOnboardingStatusError,
    refetch: refetchOnboardingStatus,
  } = useQuery({
    queryKey: ["onboarding-status", tenantId],
    queryFn: () => api.onboarding.status(tenantId),
    enabled: hasToken && !!tenantId,
    initialData: hasToken && tenantId ? readCachedOnboardingStatus(tenantId) ?? undefined : undefined,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (tenantId && onboardingStatus) {
      writeCachedOnboardingStatus(tenantId, onboardingStatus);
    }
  }, [tenantId, onboardingStatus]);

  useEffect(() => {
    if (!hasToken) {
      navigate("/login");
    }
  }, [hasToken, navigate]);

  useEffect(() => {
    if (hasToken && onboardingStatus && !onboardingStatus.complete) {
      navigate("/onboarding");
    }
  }, [hasToken, onboardingStatus, navigate]);

  // ── Notification State ──
  const [notifications, setNotifications] = useState<DashboardNotification[]>(() => {
    try {
      const stored = localStorage.getItem("dashboard_notifications");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const lastEventRef = useRef<string | null>(null);

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: incidentSummary } = useQuery({
    queryKey: ["incident-summary-nav"],
    queryFn: api.incidents.summary,
    staleTime: 15 * 60 * 1000,
    enabled: hasToken,
  });

  // Prefetch data for all main dashboard views in the background when signed in
  useEffect(() => {
    if (!hasToken) return;
    
    // Stagger prefetching by 5 seconds to avoid competing with critical Dashboard queries on startup
    const timer = setTimeout(() => {
      // Command Center
      queryClient.prefetchQuery({ queryKey: ["command"], queryFn: () => api.incidents.briefing() });
      
      // Network View
      queryClient.prefetchQuery({ queryKey: ["risks", "suppliers"], queryFn: () => api.risks.suppliers() });
      queryClient.prefetchQuery({ queryKey: ["risks", "events"], queryFn: () => api.risks.events() });
      
      // Intelligence
      queryClient.prefetchQuery({ queryKey: ["signals", "categorized"], queryFn: () => api.signals.categorized() });

      // Incidents & Compliance
      queryClient.prefetchQuery({
        queryKey: ["incidents", "ACTIVE"],
        queryFn: async () => {
          const r = await fetch(`${BASE}/incidents`, { headers: authHeaders() });
          if (!r.ok) throw new Error("Failed to fetch incidents");
          return r.json();
        }
      });

      queryClient.prefetchQuery({
        queryKey: ["governance-audit"],
        queryFn: async () => {
          const r = await fetch(`${BASE}/audit`, { headers: authHeaders() });
          if (!r.ok) return [];
          return r.json();
        }
      });

      queryClient.prefetchQuery({
        queryKey: ["governance-metrics"],
        queryFn: async () => {
          const r = await fetch(`${BASE}/governance/summary`, { headers: authHeaders() });
          if (!r.ok) return {};
          return r.json();
        }
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, [hasToken, queryClient]);

  const { data: checkpointData } = useQuery({
    queryKey: ["governance-checkpoints-nav"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/governance/checkpoints`, { headers: authHeaders() });
      if (!r.ok) return { count: 0, pending: [] };
      return r.json();
    },
    staleTime: 15 * 60 * 1000,
    enabled: hasToken,
  });

  const critCount = incidentSummary?.critical_count ?? 0;
  const totalNodes = incidentSummary?.total_nodes ?? 850;
  const pendingChkCount = checkpointData?.count ?? 0;
  const pendingChks: { checkpoint_id: string; incident_id: string; risk_level: string; risk_trigger: string }[] =
    checkpointData?.pending ?? [];

  // Seed notifications with pending checkpoints if list is empty
  useEffect(() => {
    if (pendingChks.length > 0 && notifications.length === 0) {
      const seeded = pendingChks.map((chk) => ({
        id: `seeded-${chk.checkpoint_id}`,
        title: `Pending Checkpoint — ${chk.risk_level}`,
        description: chk.risk_trigger,
        type: "checkpoint",
        timestamp: new Date().toISOString(),
        read: false,
        link: "/dashboard/compliance",
      }));
      setNotifications(seeded);
      localStorage.setItem("dashboard_notifications", JSON.stringify(seeded));
    }
  }, [pendingChks, notifications.length]);

  // Handle incoming WebSocket events
  useEffect(() => {
    if (!lastEvent) return;

    // Uniquely identify the event to prevent duplicate logic execution
    const eventKey = `${lastEvent.type}-${lastEvent.timestamp}`;
    if (lastEventRef.current === eventKey) return;
    lastEventRef.current = eventKey;

    const eventTime = new Date(lastEvent.timestamp).getTime();
    const nowTime = Date.now();
    const isRecent = nowTime - eventTime < 30_000;

    let notificationTitle = "";
    let notificationDesc = "";
    let notificationLink = "";
    let iconType = "incident";

    const payload = (lastEvent.payload || {}) as any;

    switch (lastEvent.type) {
      case "incident_created": {
        const severity = String(payload.severity || "LOW").toUpperCase();
        notificationTitle = "New Incident Detected";
        notificationDesc = `Incident ${payload.incident_id || ""} (${severity}) requires review.`;
        notificationLink = `/dashboard/incidents?id=${payload.incident_id || ""}`;
        iconType = "incident";
        break;
      }
      case "checkpoint_raised": {
        notificationTitle = "Governance Checkpoint Raised";
        notificationDesc = `Checkpoint: ${payload.checkpoint_id || "Action pending review"}`;
        notificationLink = "/dashboard/compliance";
        iconType = "checkpoint";
        break;
      }
      case "signal_detected": {
        const count = payload.count || 1;
        notificationTitle = "Intelligence Signals Polled";
        notificationDesc = `Detected ${count} active signal stream${count > 1 ? "s" : ""}.`;
        notificationLink = "/dashboard/intelligence";
        iconType = "signal";
        break;
      }
      case "rfq_sent": {
        notificationTitle = "RFQ Email Sent";
        notificationDesc = `RFQ sent to ${payload.recipient || "supplier"}.`;
        notificationLink = `/dashboard/incidents?id=${payload.incident_id || ""}`;
        iconType = "rfq";
        break;
      }
      case "incident_resolved": {
        notificationTitle = "Incident Resolved";
        notificationDesc = `Incident ${payload.incident_id || ""} has been resolved.`;
        notificationLink = `/dashboard/incidents?id=${payload.incident_id || ""}`;
        iconType = "resolved";
        break;
      }
      case "incident_updated": {
        notificationTitle = "Incident Updated";
        notificationDesc = `Incident ${payload.incident_id || ""} status updated to ${payload.status || ""}.`;
        notificationLink = `/dashboard/incidents?id=${payload.incident_id || ""}`;
        iconType = "updated";
        break;
      }
      case "threshold_tuned": {
        notificationTitle = "Thresholds Auto-Tuned";
        notificationDesc = `Scoring sensitivity thresholds have been updated.`;
        notificationLink = "/dashboard/compliance";
        iconType = "checkpoint";
        break;
      }
      default:
        return;
    }

    if (notificationTitle) {
      const newNotification: DashboardNotification = {
        id: `${lastEvent.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: notificationTitle,
        description: notificationDesc,
        type: iconType,
        timestamp: new Date().toISOString(),
        read: false,
        link: notificationLink,
      };

      setNotifications((prev) => {
        const updated = [newNotification, ...prev].slice(0, 100);
        localStorage.setItem("dashboard_notifications", JSON.stringify(updated));
        return updated;
      });

      if (isRecent) {
        toast(notificationTitle, {
          description: notificationDesc,
          action: notificationLink ? {
            label: "View",
            onClick: () => {
              navigate(notificationLink);
            }
          } : undefined
        });
      }
    }
  }, [lastEvent, navigate]);

  const markAllAsRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      localStorage.setItem("dashboard_notifications", JSON.stringify(updated));
      return updated;
    });
  };

  const clearNotifications = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications([]);
    localStorage.removeItem("dashboard_notifications");
  };

  const handleNotificationClick = (notification: DashboardNotification) => {
    setNotifications((prev) => {
      const updated = prev.map((n) =>
        n.id === notification.id ? { ...n, read: true } : n
      );
      localStorage.setItem("dashboard_notifications", JSON.stringify(updated));
      return updated;
    });
    setPopoverOpen(false);
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Logout ────────────────────────────────────────────────────────────────
  function handleLogout() {
    clearAuthSession();
    navigate("/login");
  }

  const userId = getUserId();
  const displayName = getDisplayName() || userId;
  const userInitial = displayName ? displayName.charAt(0).toUpperCase() : "U";

  if (!hasToken) return null;

  if (isOnboardingStatusError) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm gap-4 px-6">
        <p className="text-sm text-slate-600 text-center max-w-md">
          Could not verify onboarding status. Check that the backend is running and try again.
        </p>
        <button
          type="button"
          onClick={() => refetchOnboardingStatus()}
          className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-mono text-xs uppercase tracking-wider rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isOnboardingStatusLoading || !onboardingStatus) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-[3px] border-muted/80 border-t-red-500 animate-spin" />
          <div className="absolute w-6 h-6 rounded-full bg-red-500/10 animate-pulse-subtle" />
        </div>
        <span className="text-[10px] font-headline font-bold uppercase tracking-[0.2em] text-slate-500 mt-4 animate-pulse">
          Verifying security authorization...
        </span>
      </div>
    );
  }

  if (!onboardingStatus.complete) return null;

  return (
    <div className="min-h-screen flex bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`${collapsed ? "w-14" : "w-56"
          } shrink-0 bg-card flex flex-col transition-all duration-150 sticky top-0 h-screen border-r border-border`}
      >
        <div className="px-4 py-4 flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-3">
              <img src="/Praecantator.png" alt="Logo" className="w-8 h-8 object-contain" />
              <span className="font-headline text-xl font-bold text-foreground tracking-tight">
                Praecantator
              </span>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="px-4 pb-3 border-b border-border">
            <p className="text-[10px] font-headline font-bold uppercase tracking-[0.15em] text-slate-600">
              Autonomous SCRM
            </p>
          </div>
        )}

        <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.path === "/dashboard"
                ? location.pathname === "/dashboard"
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150 relative group ${isActive
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-red-500" />
                )}
                <item.icon size={16} className={isActive ? "text-red-500" : ""} />
                {!collapsed && (
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-headline font-bold tracking-wide">{item.title}</span>
                    <span className="text-[10px] font-headline font-semibold text-slate-500 uppercase tracking-wider">
                      {item.description}
                    </span>
                  </div>
                )}
                {item.title === "Incidents" && !collapsed && critCount > 0 && (
                  <span className="ml-auto text-[10px] font-headline font-bold bg-red-500 text-white px-1.5 py-0.5 min-w-[1.25rem] text-center">
                    {critCount}
                  </span>
                )}
                {item.title === "Compliance" && !collapsed && pendingChkCount > 0 && (
                  <span className="ml-auto text-[10px] font-headline font-bold bg-orange-500 text-white px-1.5 py-0.5 min-w-[1.25rem] text-center animate-pulse">
                    {pendingChkCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 py-2 border-t border-border">
          <Link
            to="/dashboard/settings"
            className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-150 ${location.pathname === "/dashboard/settings"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            <Settings size={14} />
            {!collapsed && <span className="text-xs font-headline">Settings</span>}
          </Link>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Top bar */}
        <header className="h-12 flex items-center justify-between px-6 bg-card shrink-0 sticky top-0 z-30 border-b border-border">
          {/* Left: live status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 ${wsConnected ? "bg-green-500" : "bg-amber-500"} animate-pulse`} />
              <span className="text-[10px] font-headline font-bold uppercase tracking-[0.1em] text-slate-600">
                {wsConnected ? "Live" : "Cached"} · {totalNodes.toLocaleString()} nodes
              </span>
              {wsConnected && <Wifi size={10} className="text-green-500" />}
            </div>
            {pendingChkCount > 0 && (
              <Link
                to="/dashboard/compliance"
                className="flex items-center gap-1.5 text-[10px] font-headline font-bold text-orange-500 hover:text-orange-400 transition-colors"
              >
                <ShieldAlert size={12} className="animate-pulse" />
                {pendingChkCount} checkpoint{pendingChkCount > 1 ? "s" : ""} pending
              </Link>
            )}
          </div>

          {/* Right: notification bell + user menu */}
          <div className="flex items-center gap-3">

            {/* ── Notification bell ── */}
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label="Notifications"
                  className="relative text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer p-1"
                >
                  <Bell size={16} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full border border-card flex items-center justify-center">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-xs font-headline font-bold uppercase tracking-widest text-foreground">
                    Notifications ({unreadCount})
                  </p>
                  <div className="flex gap-2">
                    {notifications.length > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[9px] font-mono font-bold text-red-500 hover:text-red-600 transition-colors uppercase tracking-wider cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        onClick={clearNotifications}
                        className="text-[9px] font-mono font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-wider cursor-pointer"
                        title="Clear all"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-border custom-scrollbar">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <Bell size={20} className="mx-auto mb-2 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground font-mono">No new notifications</p>
                    </div>
                  ) : (
                    notifications.map((chk) => {
                      const Icon = getNotificationIcon(chk.type);
                      const iconColor = getNotificationIconColor(chk.type);
                      return (
                        <div
                          key={chk.id}
                          onClick={() => handleNotificationClick(chk)}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer relative ${!chk.read ? "bg-red-500/[0.02]" : ""
                            }`}
                        >
                          {!chk.read && (
                            <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-red-500 rounded-full" />
                          )}
                          <div className={`p-1.5 rounded bg-muted border border-border mt-0.5 shrink-0 ${iconColor}`}>
                            <Icon size={12} />
                          </div>
                          <div className="min-w-0 flex-1 pl-1">
                            <p className={`text-xs truncate ${!chk.read ? "font-bold text-foreground" : "font-semibold text-slate-500"}`}>
                              {chk.title}
                            </p>
                            <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
                              {chk.description}
                            </p>
                            <span className="text-[9px] font-mono text-slate-400/80 mt-1 block">
                              {formatTimeAgo(chk.timestamp)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="px-4 py-2 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Clock size={10} className="text-muted-foreground/50" />
                    <span className="text-[10px] text-muted-foreground/50 font-headline font-bold uppercase tracking-wider">
                      {wsConnected ? "Live updates on" : "Auto refresh on demand"}
                    </span>
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                </div>
              </PopoverContent>
            </Popover>

            {/* ── User menu / logout ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="User menu"
                  className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center text-[11px] font-headline font-bold text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                >
                  {userInitial}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-3 py-2">
                  <p className="text-[10px] font-headline text-muted-foreground uppercase tracking-widest">
                    Signed in as
                  </p>
                  <p className="text-xs font-medium text-foreground truncate">{displayName || "—"}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/dashboard/settings" className="flex items-center gap-2 cursor-pointer">
                    <User size={13} />
                    <span className="text-xs">Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-red-500 focus:text-red-500 cursor-pointer"
                >
                  <LogOut size={13} />
                  <span className="text-xs">Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>

        <footer className="px-6 py-4 border-t border-border bg-card flex items-center justify-between">
          <div className="flex items-center gap-2 opacity-60">
            <span className="w-1 h-1 bg-red-500 animate-pulse" />
            <span className="text-[10px] font-headline font-bold tracking-widest text-slate-500 uppercase">
              Autonomous Pipeline Active
            </span>
          </div>
          <span className="text-[10px] font-headline font-bold text-slate-500 uppercase tracking-widest">
            © 2026 Praecantator
          </span>
        </footer>
      </div>
    </div>
  );
};

export default DashboardLayout;
