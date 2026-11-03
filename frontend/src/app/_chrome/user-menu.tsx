import { LogOut, UserCircle2 } from "lucide-react"
import { auth, signOut } from "@/gateways/server/auth"

export async function UserMenu() {
  const session = await auth()
  if (!session?.user) return null

  return (
    // No fill at rest — the fleet's header controls are an outline and nothing
    // else, the same box shipyard's ⌘K trigger draws.
    <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1">
      <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-meta text-muted-foreground">{session.user.name}</span>
      <form
        action={async () => {
          "use server"
          await signOut({ redirectTo: "/login" })
        }}
      >
        <button
          type="submit"
          title="Sign out"
          className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
