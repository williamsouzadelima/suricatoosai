"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  Loader2,
  Search,
  UserPlus,
  Users,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TeamDialogs, ManageSeatsDialog } from "./TeamDialogs";
import { TeamMembersList } from "./TeamMembersList";
import { clientLogout } from "@/lib/utils/logout";

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: string;
  isCurrentUser: boolean;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invitedAt: string;
  expiresAt: string;
}

interface TeamInfo {
  teamId: string;
  teamName: string;
  currentSeats: number;
  totalSeats: number;
  availableSeats: number;
  billingPeriod: "monthly" | "yearly" | null;
}

const TeamTab = () => {
  const t = useTranslations("settingsAgents");
  const { subscription } = useGlobalState();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [inviteToRevoke, setInviteToRevoke] =
    useState<PendingInvitation | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "pending">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showManageSeatsDialog, setShowManageSeatsDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const hasFetchedRef = React.useRef(false);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/team/members");

      if (!response.ok) {
        throw new Error(t("team.failedFetchData"));
      }

      const data = await response.json();
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
      setTeamInfo(data.teamInfo || null);
      setIsAdmin(data.isAdmin || false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("team.failedLoadData"),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (subscription === "team" && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchMembers();
    }
  }, [subscription]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inviteEmail) {
      toast.error(t("team.enterEmail"));
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail)) {
      toast.error(t("team.enterValidEmail"));
      return;
    }

    try {
      setInviting(true);
      const response = await fetch("/api/team/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("team.failedInvite"));
      }

      toast.success(t("team.memberInvited"));
      setInviteEmail("");
      setShowInviteDialog(false);
      fetchMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("team.failedInvite"));
    } finally {
      setInviting(false);
    }
  };

  const filteredMembers = members.filter((member) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const firstName = member.firstName || "";
    const lastName = member.lastName || "";
    const name = `${firstName} ${lastName}`.trim().toLowerCase();
    const email = member.email.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const filteredInvitations = invitations.filter((invitation) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return invitation.email.toLowerCase().includes(query);
  });

  // Calculate total seats including pending invites
  const totalUsedSeats = members.length + invitations.length;
  const actualAvailableSeats = teamInfo
    ? teamInfo.totalSeats - totalUsedSeats
    : 0;

  const handleRemove = async () => {
    if (!memberToRemove) return;

    try {
      setRemoving(memberToRemove.id);
      const response = await fetch(
        `/api/team/members?id=${memberToRemove.id}`,
        {
          method: "DELETE",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("team.failedRemove"));
      }

      toast.success(t("team.memberRemoved"));
      setMemberToRemove(null);
      fetchMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("team.failedRemove"));
    } finally {
      setRemoving(null);
    }
  };

  const handleRevokeInvite = async () => {
    if (!inviteToRevoke) return;

    try {
      setRevokingInvite(inviteToRevoke.id);
      const response = await fetch(`/api/team/invite?id=${inviteToRevoke.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("team.failedRevoke"));
      }

      toast.success(t("team.invitationRevoked"));
      setInviteToRevoke(null);
      fetchMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("team.failedRevoke"));
    } finally {
      setRevokingInvite(null);
    }
  };

  const handleLeaveTeam = async () => {
    try {
      setLeaving(true);

      // Find current user's membership ID
      const currentUserMembership = members.find((m) => m.isCurrentUser);
      if (!currentUserMembership) {
        throw new Error(t("team.membershipNotFound"));
      }

      const response = await fetch(
        `/api/team/members?id=${currentUserMembership.id}`,
        {
          method: "DELETE",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("team.failedLeave"));
      }

      toast.success(t("team.leftTeam"));
      setShowLeaveDialog(false);

      // Log out the user to refresh their session
      clientLogout();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("team.failedLeave"));
      setLeaving(false);
    }
  };

  if (subscription !== "team") {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">{t("team.teamPlanOnly")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold">{t("team.members")}</h2>
              <p className="text-sm text-muted-foreground">
                {teamInfo ? (
                  <>
                    {t("team.teamLabel")} ·{" "}
                    {t("team.membersCount", { count: members.length })}
                    {invitations.length > 0 &&
                      ` · ${t("team.pendingCount", { count: invitations.length })}`}
                  </>
                ) : (
                  t("team.teamLabel")
                )}
              </p>
            </div>
            {!isAdmin && (
              <Button
                variant="outline"
                onClick={() => setShowLeaveDialog(true)}
                className="text-destructive hover:text-destructive"
              >
                {t("team.leaveTeam")}
              </Button>
            )}
          </div>

          {/* Tabs and Actions */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant={activeTab === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("all")}
                className="rounded-md"
              >
                {t("team.allMembers")}
              </Button>
              {isAdmin && (
                <Button
                  variant={activeTab === "pending" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("pending")}
                  className="rounded-md"
                >
                  {t("team.pendingInvitesTab")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t("team.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {isAdmin && (
                <>
                  <Button
                    onClick={() => setShowInviteDialog(true)}
                    disabled={actualAvailableSeats === 0}
                    className="gap-2"
                  >
                    <UserPlus className="h-4 w-4" />
                    {t("team.inviteMember")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setShowManageSeatsDialog(true)}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        {t("team.manageSeats")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>

          {/* Members and Invitations Lists */}
          <TeamMembersList
            activeTab={activeTab}
            filteredMembers={filteredMembers}
            filteredInvitations={filteredInvitations}
            searchQuery={searchQuery}
            removing={removing}
            revokingInvite={revokingInvite}
            actualAvailableSeats={actualAvailableSeats}
            isAdmin={isAdmin}
            setMemberToRemove={setMemberToRemove}
            setInviteToRevoke={setInviteToRevoke}
            setShowInviteDialog={setShowInviteDialog}
          />

          {/* Seat limit info */}
          {teamInfo && isAdmin && (
            <div className="text-sm text-muted-foreground">
              {actualAvailableSeats > 0 ? (
                <span>
                  {t("team.seatsAvailable", {
                    count: actualAvailableSeats,
                    total: teamInfo.totalSeats,
                  })}
                  {invitations.length > 0 &&
                    ` ${t("team.pendingInvites", { count: invitations.length })}`}
                </span>
              ) : (
                <span>
                  {t("team.seatsInUse", {
                    used: totalUsedSeats,
                    total: teamInfo.totalSeats,
                  })}
                </span>
              )}
            </div>
          )}
        </>
      )}

      <TeamDialogs
        showInviteDialog={showInviteDialog}
        setShowInviteDialog={setShowInviteDialog}
        inviteEmail={inviteEmail}
        setInviteEmail={setInviteEmail}
        inviting={inviting}
        handleInvite={handleInvite}
        memberToRemove={memberToRemove}
        setMemberToRemove={setMemberToRemove}
        removing={removing}
        handleRemove={handleRemove}
        inviteToRevoke={inviteToRevoke}
        setInviteToRevoke={setInviteToRevoke}
        revokingInvite={revokingInvite}
        handleRevokeInvite={handleRevokeInvite}
        showLeaveDialog={showLeaveDialog}
        setShowLeaveDialog={setShowLeaveDialog}
        leaving={leaving}
        handleLeaveTeam={handleLeaveTeam}
      />

      <ManageSeatsDialog
        open={showManageSeatsDialog}
        onOpenChange={setShowManageSeatsDialog}
        currentSeats={teamInfo?.totalSeats || 0}
        totalUsedSeats={totalUsedSeats}
        onSuccess={() => {
          toast.success(t("team.seatsUpdated"));
          fetchMembers();
        }}
      />
    </div>
  );
};

export { TeamTab };
