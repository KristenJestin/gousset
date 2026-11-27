/**
 * The screen an address shows, which keys the frame's fade (`ScreenTransition`): the address
 * itself, but that the subjects' screen is one screen whatever subject it shows. Its index sends
 * `/subjects` on to `/subjects/<first id>`, and choosing or making a subject moves inside it: the
 * tree stays (docs/wireframes), so neither fades again nor is drawn anew, and the focus the tree
 * holds stays where it was put.
 */
export function screenOf(pathname: string): string {
  return pathname === "/subjects" || pathname.startsWith("/subjects/") ? "/subjects" : pathname;
}
