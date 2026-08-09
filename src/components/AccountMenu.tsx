"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Check, LogOut, Plus } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

function userInitials(name: string | undefined, email: string): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length > 0) {
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }
  return email.slice(0, 2).toUpperCase();
}

export function AccountMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { data: organizations } = authClient.useListOrganizations();

  if (isPending) {
    return <Skeleton className="size-9 rounded-full" />;
  }

  if (!session) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  const organizationList = organizations ?? [];
  const activeOrganizationId = session.session.activeOrganizationId;
  const activeOrganization = organizationList.find(
    (organization) => organization.id === activeOrganizationId,
  );

  async function switchOrganization(organizationId: string) {
    const result = await authClient.organization.setActive({ organizationId });
    if (!result.error) {
      router.refresh();
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Open account menu"
        >
          <Avatar className="size-9">
            <AvatarImage src={session.user.image ?? undefined} alt="" />
            <AvatarFallback>{userInitials(session.user.name, session.user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate">{session.user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {session.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          {organizationList.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              onSelect={() => void switchOrganization(organization.id)}
            >
              <Building2 />
              <span className="truncate">{organization.name}</span>
              {organization.id === activeOrganizationId ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
          {activeOrganization ? (
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
              Active: {activeOrganization.name}
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href="/onboarding?create=1">
              <Plus />
              Create workspace
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
