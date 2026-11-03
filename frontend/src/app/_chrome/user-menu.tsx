import { LogOut, UserCircle2 } from "lucide-react"
import { auth, signOut } from "@/gateways/server/auth"
import { Button } from "@/kit/ui/button"

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
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          title="Sign out"
          aria-label="Sign out"
          className="h-6 w-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
