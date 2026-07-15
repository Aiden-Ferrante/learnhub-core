import { LogOut, UserCircle2 } from "lucide-react"
import { auth, signOut } from "@/lib/server/auth"

export async function UserMenu() {
  const session = await auth()
  if (!session?.user) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
      <UserCircle2 className="h-4 w-4 text-brand" />
      <span className="text-sm font-medium">{session.user.name}</span>
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
