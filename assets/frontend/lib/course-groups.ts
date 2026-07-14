/** Client-side organization layer for the course shelf: nestable groups + tag membership.
 *
 * Groups are a pure frontend concept, persisted per-user via /api/user-settings
 * (with a one-time import from the legacy localStorage store). A course can belong
 * to multiple groups at once (`membership[courseId] = groupId[]`), and groups nest
 * arbitrarily via `parentId`.
 */

export type CourseGroup = {
  id: string
  name: string
  parentId: string | null
}

export type GroupsState = {
  groups: CourseGroup[]
  /** courseId → groupId[] (a course may be tagged into several groups). */
  membership: Record<string, string[]>
}

export type GroupTreeNode = {
  group: CourseGroup
  children: GroupTreeNode[]
}

const STORAGE_KEY = "learnhub_course_groups"

export const EMPTY_GROUPS_STATE: GroupsState = { groups: [], membership: {} }

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try {
      return crypto.randomUUID()
    } catch {
      // fall through to manual generation
    }
  }
  return "gxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function normalizeGroupsState(raw: unknown): GroupsState {
  const parsed = (raw ?? {}) as Partial<GroupsState>
  return {
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    membership:
      parsed.membership && typeof parsed.membership === "object" ? parsed.membership : {},
  }
}

/** Server state, or null when the user has never saved groups (allows legacy import). */
export async function fetchGroupsState(): Promise<GroupsState | null> {
  try {
    const res = await fetch("/api/user-settings")
    if (!res.ok) return null
    const data = await res.json()
    const raw = data?.settings?.courseGroups
    if (!raw || typeof raw !== "object") return null
    return normalizeGroupsState(raw)
  } catch {
    return null
  }
}

export async function persistGroupsState(state: GroupsState): Promise<void> {
  try {
    await fetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseGroups: state }),
    })
  } catch {
    // groups are non-critical, so swallow
  }
}

/** Read the legacy localStorage store and clear it (one-time migration). */
export function takeLegacyGroupsState(): GroupsState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    localStorage.removeItem(STORAGE_KEY)
    return normalizeGroupsState(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Assemble a forest from the flat group list. Orphaned parents are treated as roots. */
export function buildGroupTree(groups: CourseGroup[]): GroupTreeNode[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const nodes = new Map<string, GroupTreeNode>(
    groups.map((g) => [g.id, { group: g, children: [] }]),
  )
  const roots: GroupTreeNode[] = []
  for (const g of groups) {
    const node = nodes.get(g.id)!
    const parent = g.parentId && byId.has(g.parentId) ? nodes.get(g.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortRec = (list: GroupTreeNode[]) => {
    list.sort((a, b) => a.group.name.localeCompare(b.group.name))
    list.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

/** A group's id plus all of its descendant group ids. */
export function descendantGroupIds(groupId: string, groups: CourseGroup[]): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const g of groups) {
    if (g.parentId) {
      const arr = childrenOf.get(g.parentId) ?? []
      arr.push(g.id)
      childrenOf.set(g.parentId, arr)
    }
  }
  const result: string[] = []
  const stack = [groupId]
  while (stack.length) {
    const id = stack.pop()!
    result.push(id)
    const kids = childrenOf.get(id)
    if (kids) stack.push(...kids)
  }
  return result
}

/** Course ids tagged into a group or any of its descendants. */
export function coursesInGroup(
  groupId: string,
  membership: Record<string, string[]>,
  groups: CourseGroup[],
): Set<string> {
  const scope = new Set(descendantGroupIds(groupId, groups))
  const result = new Set<string>()
  for (const [courseId, groupIds] of Object.entries(membership)) {
    if (groupIds.some((g) => scope.has(g))) result.add(courseId)
  }
  return result
}

export function addGroup(
  state: GroupsState,
  name: string,
  parentId: string | null,
): { state: GroupsState; id: string } {
  const id = generateId()
  const group: CourseGroup = { id, name: name.trim() || "Untitled group", parentId }
  return { state: { ...state, groups: [...state.groups, group] }, id }
}

export function renameGroup(state: GroupsState, groupId: string, name: string): GroupsState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, name: name.trim() || g.name } : g,
    ),
  }
}

/** Remove a group: re-parent its children to the deleted group's parent and strip the tag. */
export function deleteGroup(state: GroupsState, groupId: string): GroupsState {
  const target = state.groups.find((g) => g.id === groupId)
  const newParent = target ? target.parentId : null
  const groups = state.groups
    .filter((g) => g.id !== groupId)
    .map((g) => (g.parentId === groupId ? { ...g, parentId: newParent } : g))
  const membership: Record<string, string[]> = {}
  for (const [courseId, groupIds] of Object.entries(state.membership)) {
    const kept = groupIds.filter((g) => g !== groupId)
    if (kept.length) membership[courseId] = kept
  }
  return { groups, membership }
}

export function toggleMembership(
  state: GroupsState,
  courseId: string,
  groupId: string,
): GroupsState {
  const current = state.membership[courseId] ?? []
  const next = current.includes(groupId)
    ? current.filter((g) => g !== groupId)
    : [...current, groupId]
  const membership = { ...state.membership }
  if (next.length) membership[courseId] = next
  else delete membership[courseId]
  return { ...state, membership }
}
