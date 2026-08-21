# Garden Inventory — UX Review & Suggestions

*Prepared April 2026. Based on a full read-through of the codebase and a conversation about how the site is actually used.*

---

## Context

The site has multiple users across different roles (viewer / editor / admin), accessed on a mix of mobile and desktop. The most-used pages are **Tasks**, **Areas**, and **Plants**. My Garden is opened infrequently because in its current form it doesn't add much over what the other pages already offer.

---

## 1. Navigation order and default landing page

**The problem.** The bottom nav reads: Plants → Areas → My Garden → Tasks → Admin. Tasks is buried at position four, despite being the most-used page. Worse, the app defaults to My Garden on every fresh load — the page you said you rarely visit.

**The suggestion.** Reorder the nav so the most-used pages are closest to the right thumb on mobile, and make Tasks the default landing page:

> Tasks → Areas → Plants → Dashboard → Admin

Rationale: Tasks is where you go to see what needs doing right now, so it earns the first slot. Areas and Plants follow because they're used almost as often. Dashboard (the renamed My Garden — see section 3) sits further right since it's a secondary "overview" destination. Admin stays at the far end since it's not a routine destination for most users.

Changing the default is a one-line fix in `main.js` (`currentView = 'tasks'` instead of `'garden'`).

---

## 2. Tasks page — two things worth improving

**2a. Default to the By Status view.**
You told me your primary reason for opening Tasks is to see what's due and what's in progress. The By Status view — which groups tasks by In Progress / To-Do / Completed and now sorts them by due date — is the better view for that. But the app currently defaults to By Area on every visit. Switching the default (a one-line change to the `activeView` variable) would mean you land directly in the most useful layout.

**2b. Add an Overdue filter chip or section.**
The overdue styling (red date text) exists already, but there's no way to quickly isolate overdue tasks. A simple "Overdue" chip alongside the existing To-Do / In Progress / Completed chips, or a dedicated "Overdue" section that appears at the top of the By Status view when there are overdue items, would make it much faster to spot what's slipped. This matters especially when there are multiple users contributing to tasks across areas.

---

## 3. My Garden → Dashboard

**The problem.** My Garden currently shows three summary numbers (plant types, specimens, areas) and then an accordion list of areas with their plants. The accordion is structurally identical to what you get from the Areas page, just with less functionality. There's no reason to visit it over Areas.

**The suggestion.** Rename it "Dashboard" and rebuild it as a genuine overview that surfaces information you can't easily see elsewhere:

**Overdue & due soon.** A compact list of the top 5 tasks ordered by due date — overdue ones flagged clearly — with a "View all" link to the Tasks page. This is the most valuable addition: when you open the app fresh, you'd immediately see whether anything is urgent without having to navigate anywhere.

**Garden summary stats.** Keep the three numbers (plant types, specimens, areas). They're a nice at-a-glance sanity check and don't hurt.

**Recent additions.** A small section showing the last 3–4 plants added to the inventory. Useful for a multi-user household where your wife or another contributor may have added something you haven't seen yet.

**Quick links to areas.** Rather than the full accordion (which duplicates Areas), show a simple row of area name chips that each jump straight to that area's detail page. Faster navigation, less duplication.

This makes Dashboard genuinely different from the other pages: it's the "what's happening right now" view, whereas Tasks is for managing work and Areas/Plants are for browsing the inventory.

---

## 4. Areas list — add a task count to each card

**The problem.** The Areas list shows each area as a card, but the only information on the card is the area name. You have to tap in to find out whether an area has any active tasks.

**The suggestion.** Add a small badge or subtitle to each area card showing its active task count, e.g. "3 active tasks" or a subtle chip. This lets you spot at a glance which areas need attention without drilling into each one. If an area has overdue tasks, the badge could use the overdue color. This is especially useful in the multi-user scenario, since a contributor might have added tasks to an area you haven't looked at recently.

---

## 5. Plants list — show location context on cards

**The problem.** Plant cards currently show the botanical name, common name, genus badge, date acquired, and whether there are photos. They don't tell you where in the garden the plant actually is. To find that out you have to tap into the plant detail and scroll to Garden Locations.

**The suggestion.** Add a subtle location line to each card, e.g. "Front border, Raised bed 2" or simply "2 locations". For plants that haven't been placed in an area yet, a muted "Not placed" label would prompt action. This doesn't require a layout change — it fits naturally as a second line of metadata in the existing card structure.

---

## 6. Admin tab visibility

**The problem.** The Admin tab is currently shown to editors as well as admins. Editors can access one section of Admin (the Wishlist). But for any user who isn't an admin, seeing "Admin" in the nav can be confusing — it implies more control than they actually have.

**The suggestion.** Two options, in order of preference:

Option A: Hide the Admin tab for editors entirely, and instead surface the Wishlist inside the Plants page (e.g. as a tab or filter alongside the main plant list). This keeps the nav clean and puts the Wishlist where it's contextually relevant.

Option B: Keep the Admin tab for editors but rename it "Wishlist" for that role. This is a smaller change and avoids the nav looking broken to editors who can't do much in Admin.

---

## 7. Mobile-specific: make the user chip dropdown less fiddly

**The problem.** The user initials chip in the top-right corner opens a small dropdown for sign-out. On mobile this is a very small tap target, and the dropdown closes if you tap anywhere else — which on a small screen happens easily by accident.

**The suggestion.** Either increase the tap target area of the chip, or move sign-out into a simple bottom sheet / modal that's easier to dismiss intentionally. This is a small change but particularly noticeable when multiple people share the same device and occasionally need to switch accounts.

---

## Summary table

| Suggestion | Effort | Impact |
|---|---|---|
| Change default landing page to Tasks | Trivial (1 line) | High |
| Reorder nav tabs | Small | Medium |
| Default Tasks to By Status view | Trivial (1 line) | Medium |
| Add Overdue chip / section to Tasks | Small | High |
| Rebuild My Garden as Dashboard | Medium | High |
| Add active task count to area cards | Small | Medium |
| Show plant location on plant cards | Small | Medium |
| Fix Admin tab visibility for editors | Small–Medium | Low–Medium |
| Improve mobile user chip tap target | Trivial | Low |

The two highest-value, lowest-effort changes are the default landing page and the overdue task visibility. I'd suggest doing those first and then tackling the Dashboard rebuild as a slightly larger piece of work.
